/**
 * Framework-agnostic scene model.
 *
 * Nothing in this file may import from React, Pixi, or Yjs — the scene
 * graph is plain data so the renderer and sync layer stay swappable.
 */

import { geoOutline, pointInPolygon, type GeoKind } from './geo'

export type ShapeId = string

export type Tool =
  | 'select'
  | 'hand'
  | 'pen'
  | 'sticky'
  | 'shape'
  | 'connector'

export interface Point {
  x: number
  y: number
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** Visual style, editable per shape from the context popup. */
export interface StyleProps {
  fillColor: number
  fillOpacity: number
  strokeColor: number
  strokeOpacity: number
  strokeWidth: number
  /** Border/stroke line style; absent means solid (pre-existing shapes). */
  dash?: LineDash
}

interface ShapeBase extends StyleProps {
  id: ShapeId
  type: string
  x: number
  y: number
  width: number
  height: number
  z: number
  /** Radians, clockwise around the shape's center. Connectors ignore it. */
  rotation?: number
}

export type TextAlign = 'left' | 'center' | 'right'
export type TextVAlign = 'top' | 'middle' | 'bottom'

export interface TextStyleProps {
  fontSize: number
  bold: boolean
  textAlign: TextAlign
  textVAlign: TextVAlign
}

export interface StickyShape extends ShapeBase, Partial<TextStyleProps> {
  type: 'sticky'
  text: string
}

/** Any shape from the shape library (rectangle, ellipse, triangle, star,
 *  …). Legacy 'rect'/'ellipse' shapes normalize into this on read. */
export interface GeoShape extends ShapeBase, Partial<TextStyleProps> {
  type: 'geo'
  geo: GeoKind
  text: string
}

/** Pen-lift marker between two strokes packed into one DrawShape: rendering
 *  and hit-testing start a fresh sub-path here instead of connecting across
 *  the gap, so handwriting drawn in one burst stays a single item. Stored as
 *  a NaN x,y pair (NaN survives bounds normalization untouched). */
export const STROKE_BREAK = NaN

/** Freehand stroke. `points` are x,y pairs normalized to the shape bounds
 *  (0..1), so resizing the bounds resizes the stroke for free. A single shape
 *  may hold several strokes separated by {@link STROKE_BREAK} markers. */
export interface DrawShape extends ShapeBase {
  type: 'draw'
  points: number[]
}

/** Pasted/dropped bitmap or SVG, stored as a data URL. */
export interface ImageShape extends ShapeBase {
  type: 'image'
  src: string
}

export type ConnectorRoute = 'straight' | 'elbow' | 'curve'
export type LineDash = 'solid' | 'dashed' | 'dotted'
export type ArrowHead = 'none' | 'arrow' | 'dot'

export interface ConnectorStyleProps {
  route: ConnectorRoute
  dash: LineDash
  startHead: ArrowHead
  endHead: ArrowHead
}

/** Arrow. Each end is either attached to a shape (id) or a free point.
 *  When attached, an anchor stores WHERE on the shape (normalized 0..1
 *  coords). A center anchor — or none — floats: the arrow leaves from
 *  whichever edge faces the other end. Any other anchor is pinned. */
export interface ConnectorShape extends ShapeBase, Partial<ConnectorStyleProps> {
  type: 'connector'
  startId: ShapeId | null
  endId: ShapeId | null
  startPoint: Point | null
  endPoint: Point | null
  startAnchor?: Point | null
  endAnchor?: Point | null
  /** Manual bow set by dragging the bend handle: signed perpendicular
   *  offset (world px) of the curve's midpoint from the straight chord.
   *  Absent/null = automatic (tangent-derived) curvature. */
  curvature?: number | null
}

export type Shape =
  | StickyShape
  | GeoShape
  | DrawShape
  | ConnectorShape
  | ImageShape

export type ShapeResolver = (id: ShapeId) => Shape | undefined

export const PALETTE = [
  0xffffff, 0x000000, 0xfbbf24, 0xf87171, 0x34d399, 0x60a5fa, 0xa78bfa,
  0xf472b6, 0x475569,
]

export const MIN_SIZE = 16

export function canHaveText(s: Shape): s is StickyShape | GeoShape {
  return s.type === 'sticky' || s.type === 'geo'
}

export function isResizable(s: Shape): boolean {
  return s.type !== 'connector'
}

export function center(s: Shape): Point {
  return { x: s.x + s.width / 2, y: s.y + s.height / 2 }
}

export function rotatePoint(p: Point, c: Point, angle: number): Point {
  if (!angle) return p
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = p.x - c.x
  const dy = p.y - c.y
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}

/** Point on the shape's edge along the ray from its center toward `towards`. */
export function anchorPoint(shape: Shape, towards: Point): Point {
  const c = center(shape)
  const rot = shape.rotation ?? 0
  if (rot) {
    // Solve in the shape's local (unrotated) frame, rotate the result back.
    const local = anchorPoint(
      { ...shape, rotation: 0 },
      rotatePoint(towards, c, -rot),
    )
    return rotatePoint(local, c, rot)
  }
  const dx = towards.x - c.x
  const dy = towards.y - c.y
  if (dx === 0 && dy === 0) return c

  let t: number
  if (shape.type === 'geo' && shape.geo === 'ellipse') {
    const rx = shape.width / 2 || 1
    const ry = shape.height / 2 || 1
    t = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2)
  } else {
    const hx = shape.width / 2 || 1
    const hy = shape.height / 2 || 1
    t = Math.min(
      dx === 0 ? Infinity : hx / Math.abs(dx),
      dy === 0 ? Infinity : hy / Math.abs(dy),
    )
  }
  t = Math.min(t, 1) // never overshoot the target
  return { x: c.x + dx * t, y: c.y + dy * t }
}

/** The 9 magnetic anchor spots: corners, edge midpoints, center. */
export const ANCHOR_POSITIONS: Point[] = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 0.5 },
  { x: 1, y: 1 },
  { x: 0.5, y: 1 },
  { x: 0, y: 1 },
  { x: 0, y: 0.5 },
  { x: 0.5, y: 0.5 },
]

export function pointOnShape(s: Shape, anchor: Point): Point {
  const p = { x: s.x + anchor.x * s.width, y: s.y + anchor.y * s.height }
  return s.rotation ? rotatePoint(p, center(s), s.rotation) : p
}

export function isCenterAnchor(a: Point | null | undefined): boolean {
  return !a || (a.x === 0.5 && a.y === 0.5)
}

/** Anchor for pointer `p` on `shape`: clicks into the nearest of the 9
 *  candidates within `tol`, otherwise the exact (normalized) position. */
export function anchorAt(
  shape: Shape,
  p: Point,
  tol: number,
): { anchor: Point; snapped: boolean } {
  let best: { anchor: Point; d: number } | null = null
  for (const a of ANCHOR_POSITIONS) {
    const w = pointOnShape(shape, a)
    const d = Math.hypot(p.x - w.x, p.y - w.y)
    if (d <= tol && (!best || d < best.d)) best = { anchor: a, d }
  }
  if (best) return { anchor: best.anchor, snapped: true }
  return {
    anchor: {
      x: shape.width ? Math.min(1, Math.max(0, (p.x - shape.x) / shape.width)) : 0.5,
      y: shape.height ? Math.min(1, Math.max(0, (p.y - shape.y) / shape.height)) : 0.5,
    },
    snapped: false,
  }
}

type Side = 'n' | 'e' | 's' | 'w'
const SIDE_ANCHOR: Record<Side, Point> = {
  n: { x: 0.5, y: 0 },
  e: { x: 1, y: 0.5 },
  s: { x: 0.5, y: 1 },
  w: { x: 0, y: 0.5 },
}
const SIDE_NORMAL: Record<Side, Point> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
}

function rotateVec(v: Point, angle: number): Point {
  if (!angle) return v
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos }
}

function normalize(v: Point): Point {
  const len = Math.hypot(v.x, v.y) || 1
  return { x: v.x / len, y: v.y / len }
}

/** Floating attachment: exit from the midpoint of whichever side faces
 *  `towards`. A stable contact point keeps arrows calm while shapes are
 *  dragged around — no sliding along the perimeter. */
function floatingAttach(
  shape: Shape,
  towards: Point,
): { point: Point; normal: Point } {
  const c = center(shape)
  const rot = shape.rotation ?? 0
  const local = rotatePoint(towards, c, -rot)
  const rx = (local.x - c.x) / (shape.width / 2 || 1)
  const ry = (local.y - c.y) / (shape.height / 2 || 1)
  const side: Side =
    Math.abs(rx) >= Math.abs(ry) ? (rx > 0 ? 'e' : 'w') : (ry > 0 ? 's' : 'n')
  return {
    point: pointOnShape(shape, SIDE_ANCHOR[side]),
    normal: rotateVec(SIDE_NORMAL[side], rot),
  }
}

/** Outward direction at a pinned anchor (used as the curve tangent). */
function pinnedNormal(shape: Shape, anchor: Point): Point {
  const v = { x: anchor.x - 0.5, y: anchor.y - 0.5 }
  const len = Math.hypot(v.x, v.y)
  const n = len < 1e-6 ? { x: 0, y: -1 } : { x: v.x / len, y: v.y / len }
  return rotateVec(n, shape.rotation ?? 0)
}

/** Endpoints plus outward tangents for both ends of a connector. */
export function connectorGeometry(
  c: ConnectorShape,
  get: ShapeResolver,
): { a: Point; b: Point; ta: Point; tb: Point } {
  const startShape = c.startId ? get(c.startId) : undefined
  const endShape = c.endId ? get(c.endId) : undefined
  const towardsB = endShape
    ? center(endShape)
    : (c.endPoint ?? { x: c.x, y: c.y })
  const towardsA = startShape
    ? center(startShape)
    : (c.startPoint ?? { x: c.x, y: c.y })

  let a: Point
  let ta: Point | null = null
  if (startShape && !isCenterAnchor(c.startAnchor)) {
    a = pointOnShape(startShape, c.startAnchor!)
    ta = pinnedNormal(startShape, c.startAnchor!)
  } else if (startShape) {
    const f = floatingAttach(startShape, towardsB)
    a = f.point
    ta = f.normal
  } else {
    a = c.startPoint ?? { x: c.x, y: c.y }
  }

  let b: Point
  let tb: Point | null = null
  if (endShape && !isCenterAnchor(c.endAnchor)) {
    b = pointOnShape(endShape, c.endAnchor!)
    tb = pinnedNormal(endShape, c.endAnchor!)
  } else if (endShape) {
    const f = floatingAttach(endShape, towardsA)
    b = f.point
    tb = f.normal
  } else {
    b = c.endPoint ?? a
  }

  // Free endpoints aim along the direct line.
  ta ??= normalize({ x: b.x - a.x, y: b.y - a.y })
  tb ??= normalize({ x: a.x - b.x, y: a.y - b.y })
  return { a, b, ta, tb }
}

export function connectorEndpoints(
  c: ConnectorShape,
  get: ShapeResolver,
): { a: Point; b: Point } {
  const g = connectorGeometry(c, get)
  return { a: g.a, b: g.b }
}

/** The polyline a connector is drawn (and hit-tested) along. Straight is
 *  two points; elbow inserts orthogonal bends; curve samples a quadratic. */
export function connectorPath(c: ConnectorShape, get: ShapeResolver): Point[] {
  const { a, b, ta, tb } = connectorGeometry(c, get)
  const route = c.route ?? 'straight'
  if (route === 'elbow') {
    if (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) return [a, b]
    // First leg follows the exit direction of the start attachment.
    const horizontalFirst = Math.abs(ta.x) >= Math.abs(ta.y)
    if (horizontalFirst) {
      const mx = (a.x + b.x) / 2
      return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]
    }
    const my = (a.y + b.y) / 2
    return [a, { x: a.x, y: my }, { x: b.x, y: my }, b]
  }
  if (route === 'curve') {
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 2) return [a, b]
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
    const manual = c.curvature ?? null
    // How much each end must turn away from the direct line (0 = aligned).
    const misA = (1 - (ta.x * d.x + ta.y * d.y)) / 2
    const misB = (1 - (tb.x * -d.x + tb.y * -d.y)) / 2
    // Straight already looks right — asking for "curvy" shouldn't bend a
    // line that has no reason to bend. A hand-flattened curve stays flat.
    if (manual === null && Math.max(misA, misB) < 0.02) return [a, b]
    if (manual !== null && Math.abs(manual) < 2 && Math.max(misA, misB) < 0.02)
      return [a, b]
    const reach = Math.min(len * 0.5, 180)
    const ha = reach * (0.2 + 0.8 * misA)
    const hb = reach * (0.2 + 0.8 * misB)
    let p1 = { x: a.x + ta.x * ha, y: a.y + ta.y * ha }
    let p2 = { x: b.x + tb.x * hb, y: b.y + tb.y * hb }
    if (manual !== null) {
      // Both controls shift by v so the curve midpoint lands `manual` px
      // off the chord: B(1/2) moves by 3/4 of the control displacement.
      const perp = { x: -d.y, y: d.x }
      const auto =
        (perp.x * (p1.x + p2.x - a.x - b.x) + perp.y * (p1.y + p2.y - a.y - b.y)) *
        (3 / 8)
      const v = (manual - auto) / 0.75
      p1 = { x: p1.x + perp.x * v, y: p1.y + perp.y * v }
      p2 = { x: p2.x + perp.x * v, y: p2.y + perp.y * v }
    }
    const pts: Point[] = []
    const STEPS = 32
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS
      const mt = 1 - t
      pts.push({
        x: mt ** 3 * a.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t ** 3 * b.x,
        y: mt ** 3 * a.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t ** 3 * b.y,
      })
    }
    return pts
  }
  return [a, b]
}

/** Midpoint of a connector's drawn path (where the bend handle sits). */
export function connectorMidpoint(c: ConnectorShape, get: ShapeResolver): Point {
  const pts = connectorPath(c, get)
  if (pts.length === 2) {
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
  }
  return pts[Math.floor(pts.length / 2)]
}

export function denormalizedPoints(d: DrawShape): number[] {
  const out: number[] = []
  for (let i = 0; i < d.points.length; i += 2) {
    out.push(d.x + d.points[i] * d.width, d.y + d.points[i + 1] * d.height)
  }
  return out
}

export function boundsOf(shape: Shape, get: ShapeResolver): Bounds {
  if (shape.type !== 'connector' && shape.rotation) {
    // AABB of the rotated frame.
    const c = center(shape)
    const corners = [
      { x: shape.x, y: shape.y },
      { x: shape.x + shape.width, y: shape.y },
      { x: shape.x + shape.width, y: shape.y + shape.height },
      { x: shape.x, y: shape.y + shape.height },
    ].map((p) => rotatePoint(p, c, shape.rotation!))
    const xs = corners.map((p) => p.x)
    const ys = corners.map((p) => p.y)
    const x0 = Math.min(...xs)
    const y0 = Math.min(...ys)
    return { x: x0, y: y0, width: Math.max(...xs) - x0, height: Math.max(...ys) - y0 }
  }
  if (shape.type === 'connector') {
    const pts = connectorPath(shape, get)
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const p of pts) {
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x)
      y1 = Math.max(y1, p.y)
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  }
  return { x: shape.x, y: shape.y, width: shape.width, height: shape.height }
}

export function boundsUnion(list: Bounds[]): Bounds | null {
  if (list.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const b of list) {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.width)
    y1 = Math.max(y1, b.y + b.height)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  )
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lenSq = abx * abx + aby * aby
  const t =
    lenSq === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq),
        )
  const cx = a.x + t * abx
  const cy = a.y + t * aby
  return Math.hypot(p.x - cx, p.y - cy)
}

export function hitTest(
  shape: Shape,
  p: Point,
  get: ShapeResolver,
  tolerance: number,
): boolean {
  // Rotated shapes: test in their local (unrotated) frame.
  if (shape.type !== 'connector' && shape.rotation) {
    p = rotatePoint(p, center(shape), -shape.rotation)
  }
  switch (shape.type) {
    case 'sticky':
    case 'image':
      return (
        p.x >= shape.x &&
        p.x <= shape.x + shape.width &&
        p.y >= shape.y &&
        p.y <= shape.y + shape.height
      )
    case 'geo': {
      const inBounds =
        p.x >= shape.x &&
        p.x <= shape.x + shape.width &&
        p.y >= shape.y &&
        p.y <= shape.y + shape.height
      if (!inBounds) return false
      if (shape.geo === 'ellipse') {
        const c = center(shape)
        const rx = shape.width / 2 || 1
        const ry = shape.height / 2 || 1
        return ((p.x - c.x) / rx) ** 2 + ((p.y - c.y) / ry) ** 2 <= 1
      }
      const outline = geoOutline(shape.geo, shape.width, shape.height)
      if (!outline) return true // rect, cylinder: the box is the shape
      return pointInPolygon(p.x - shape.x, p.y - shape.y, outline)
    }
    case 'draw': {
      const pts = denormalizedPoints(shape)
      const hit = (shape.strokeWidth ?? 4) / 2 + tolerance
      for (let i = 0; i + 3 < pts.length; i += 2) {
        // Skip the gap across a pen-lift: the two strokes it joins never
        // touched, so there is nothing to hit between them.
        if (Number.isNaN(pts[i]) || Number.isNaN(pts[i + 2])) continue
        const a = { x: pts[i], y: pts[i + 1] }
        const b = { x: pts[i + 2], y: pts[i + 3] }
        if (distToSegment(p, a, b) <= hit) return true
      }
      return false
    }
    case 'connector': {
      const pts = connectorPath(shape, get)
      for (let i = 0; i + 1 < pts.length; i++) {
        if (distToSegment(p, pts[i], pts[i + 1]) <= tolerance) return true
      }
      return false
    }
  }
}
