/**
 * Framework-agnostic scene model.
 *
 * Nothing in this file may import from React, Pixi, or Yjs — the scene
 * graph is plain data so the renderer and sync layer stay swappable.
 */

export type ShapeId = string

export type Tool =
  | 'select'
  | 'hand'
  | 'pen'
  | 'sticky'
  | 'rect'
  | 'ellipse'
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
}

interface ShapeBase extends StyleProps {
  id: ShapeId
  type: string
  x: number
  y: number
  width: number
  height: number
  z: number
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

export interface RectShape extends ShapeBase, Partial<TextStyleProps> {
  type: 'rect'
  text: string
}

export interface EllipseShape extends ShapeBase, Partial<TextStyleProps> {
  type: 'ellipse'
  text: string
}

/** Freehand stroke. `points` are x,y pairs normalized to the shape bounds
 *  (0..1), so resizing the bounds resizes the stroke for free. */
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
}

export type Shape =
  | StickyShape
  | RectShape
  | EllipseShape
  | DrawShape
  | ConnectorShape
  | ImageShape

export type ShapeResolver = (id: ShapeId) => Shape | undefined

export const PALETTE = [
  0xffffff, 0xfbbf24, 0xf87171, 0x34d399, 0x60a5fa, 0xa78bfa, 0xf472b6,
  0x475569,
]

export const MIN_SIZE = 16

export function canHaveText(
  s: Shape,
): s is StickyShape | RectShape | EllipseShape {
  return s.type === 'sticky' || s.type === 'rect' || s.type === 'ellipse'
}

export function isResizable(s: Shape): boolean {
  return s.type !== 'connector'
}

export function center(s: Shape): Point {
  return { x: s.x + s.width / 2, y: s.y + s.height / 2 }
}

/** Point on the shape's edge along the ray from its center toward `towards`. */
export function anchorPoint(shape: Shape, towards: Point): Point {
  const c = center(shape)
  const dx = towards.x - c.x
  const dy = towards.y - c.y
  if (dx === 0 && dy === 0) return c

  let t: number
  if (shape.type === 'ellipse') {
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
  return { x: s.x + anchor.x * s.width, y: s.y + anchor.y * s.height }
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

export function connectorEndpoints(
  c: ConnectorShape,
  get: ShapeResolver,
): { a: Point; b: Point } {
  const startShape = c.startId ? get(c.startId) : undefined
  const endShape = c.endId ? get(c.endId) : undefined
  const fixedA =
    startShape && !isCenterAnchor(c.startAnchor)
      ? pointOnShape(startShape, c.startAnchor!)
      : null
  const fixedB =
    endShape && !isCenterAnchor(c.endAnchor)
      ? pointOnShape(endShape, c.endAnchor!)
      : null
  const rawA =
    fixedA ?? (startShape ? center(startShape) : (c.startPoint ?? { x: c.x, y: c.y }))
  const rawB = fixedB ?? (endShape ? center(endShape) : (c.endPoint ?? rawA))
  return {
    a: fixedA ?? (startShape ? anchorPoint(startShape, rawB) : rawA),
    b: fixedB ?? (endShape ? anchorPoint(endShape, rawA) : rawB),
  }
}

/** The polyline a connector is drawn (and hit-tested) along. Straight is
 *  two points; elbow inserts orthogonal bends; curve samples a quadratic. */
export function connectorPath(c: ConnectorShape, get: ShapeResolver): Point[] {
  const { a, b } = connectorEndpoints(c, get)
  const route = c.route ?? 'straight'
  if (route === 'elbow') {
    if (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) return [a, b]
    if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
      const mx = (a.x + b.x) / 2
      return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]
    }
    const my = (a.y + b.y) / 2
    return [a, { x: a.x, y: my }, { x: b.x, y: my }, b]
  }
  if (route === 'curve') {
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 2) return [a, b]
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const px = -(b.y - a.y) / len
    const py = (b.x - a.x) / len
    const off = Math.min(60, len * 0.2)
    const cp = { x: mid.x + px * off, y: mid.y + py * off }
    const pts: Point[] = []
    const STEPS = 24
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS
      const mt = 1 - t
      pts.push({
        x: mt * mt * a.x + 2 * mt * t * cp.x + t * t * b.x,
        y: mt * mt * a.y + 2 * mt * t * cp.y + t * t * b.y,
      })
    }
    return pts
  }
  return [a, b]
}

export function denormalizedPoints(d: DrawShape): number[] {
  const out: number[] = []
  for (let i = 0; i < d.points.length; i += 2) {
    out.push(d.x + d.points[i] * d.width, d.y + d.points[i + 1] * d.height)
  }
  return out
}

export function boundsOf(shape: Shape, get: ShapeResolver): Bounds {
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
  switch (shape.type) {
    case 'sticky':
    case 'rect':
    case 'image':
      return (
        p.x >= shape.x &&
        p.x <= shape.x + shape.width &&
        p.y >= shape.y &&
        p.y <= shape.y + shape.height
      )
    case 'ellipse': {
      const c = center(shape)
      const rx = shape.width / 2 || 1
      const ry = shape.height / 2 || 1
      return ((p.x - c.x) / rx) ** 2 + ((p.y - c.y) / ry) ** 2 <= 1
    }
    case 'draw': {
      const pts = denormalizedPoints(shape)
      const hit = (shape.strokeWidth ?? 4) / 2 + tolerance
      for (let i = 0; i + 3 < pts.length; i += 2) {
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
