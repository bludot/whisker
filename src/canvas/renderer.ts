import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from 'pixi.js'
import { Camera } from './camera'
import { geoOutline, type GeoKind } from '../scene/geo'
import {
  CANVAS_COLORS,
  effectiveTheme,
  labelColor,
  subscribeTheme,
  themedColor,
} from '../ui/theme'
import type { Editor } from '../editor/Editor'
import {
  boundsOf,
  boundsUnion,
  bendPointOnChord,
  connectorEndpoints,
  connectorMidpoint,
  connectorPath,
  denormalizedPoints,
  isResizable,
  rotatePoint,
  type Bounds,
  type ConnectorShape,
  type GeoShape,
  type LineDash,
  type Point,
  type Shape,
  type ShapeResolver,
  type StickyShape,
} from '../scene/types'

const GRID_SPACING = 32
const ACCENT = 0x6366f1
export const HANDLE_IDS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type HandleId = (typeof HANDLE_IDS)[number]

/**
 * WebGL board renderer. Owns the Pixi application and the camera; reads
 * shapes from the store and session state from the Editor, and redraws
 * when either changes. Knows nothing about React or input handling.
 */
export class BoardRenderer {
  readonly app = new Application()
  readonly camera = new Camera()

  private grid = new Graphics()
  private world = new Container()
  private overlay = new Graphics()

  marquee: Bounds | null = null
  drawPreview: { points: number[]; color: number; width: number } | null = null
  connectPreview: { a: Point; b: Point } | null = null
  snapGuides: { v: number[]; h: number[] } | null = null
  /** Equal-spacing indicators shown while a drag snaps to distribution. */
  spacingGuides: { a: Point; b: Point }[] | null = null
  anchorDots: { candidates: Point[]; active: Point | null } | null = null
  /** Drag-out arrow handles shown while hovering a shape with the select
   *  tool. Only the shape id and active anchor are stored; positions are
   *  recomputed on every redraw so the dots track the live shape. */
  arrowHandles: { shapeId: string; active: Point | null } | null = null
  createPreview: {
    type: 'sticky' | GeoKind
    bounds: Bounds
    color: number
  } | null = null

  private editor: Editor
  private unsubscribers: (() => void)[] = []
  private cameraListeners = new Set<() => void>()

  constructor(editor: Editor) {
    this.editor = editor
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      background: CANVAS_COLORS[effectiveTheme()].background,
      resizeTo: host,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })
    host.appendChild(this.app.canvas)
    this.app.stage.addChild(this.grid, this.world, this.overlay)

    this.unsubscribers = [
      this.editor.store.subscribe(() => {
        this.drawShapes()
        this.drawOverlay()
      }),
      this.editor.subscribe(() => {
        this.drawShapes()
        this.drawOverlay()
      }),
      subscribeTheme(() => {
        this.app.renderer.background.color =
          CANVAS_COLORS[effectiveTheme()].background
        this.drawGrid()
        this.drawShapes() // label colors depend on the canvas background
      }),
    ]
    this.app.renderer.on('resize', () => this.applyCamera())
    this.drawShapes()
    this.applyCamera()
  }

  /** Call after any camera mutation. */
  applyCamera(): void {
    const { zoom } = this.camera
    for (const c of [this.world, this.overlay]) {
      c.scale.set(zoom)
      c.position.set(-this.camera.x * zoom, -this.camera.y * zoom)
    }
    this.drawGrid()
    this.drawOverlay()
    this.cameraListeners.forEach((fn) => fn())
  }

  subscribeCamera(fn: () => void): () => void {
    this.cameraListeners.add(fn)
    return () => this.cameraListeners.delete(fn)
  }

  zoomStep(factor: number): void {
    const { width, height } = this.app.screen
    this.camera.zoomAt(width / 2, height / 2, factor)
    this.applyCamera()
  }

  resetZoom(): void {
    const { width, height } = this.app.screen
    const c = this.camera.screenToWorld(width / 2, height / 2)
    this.camera.zoom = 1
    this.camera.x = c.x - width / 2
    this.camera.y = c.y - height / 2
    this.applyCamera()
  }

  zoomToFit(): void {
    const get: ShapeResolver = (id) => this.editor.store.get(id)
    const all = this.editor.store.getAll()
    const bounds = boundsUnion(all.map((s) => boundsOf(s, get)))
    if (!bounds) return
    const { width, height } = this.app.screen
    const PAD = 80
    this.camera.zoom = Math.min(
      Camera.MAX_ZOOM,
      Math.max(
        Camera.MIN_ZOOM,
        Math.min(
          width / (bounds.width + PAD * 2),
          height / (bounds.height + PAD * 2),
        ),
      ),
    )
    this.camera.x = bounds.x + bounds.width / 2 - width / 2 / this.camera.zoom
    this.camera.y = bounds.y + bounds.height / 2 - height / 2 / this.camera.zoom
    this.applyCamera()
  }

  /** Entry view when opening a board: center the content, zooming OUT to
   *  fit if it overflows the screen but never zooming IN past 100% (a lone
   *  sticky should not fill the viewport). Empty boards keep the default
   *  origin view. */
  centerContent(): void {
    const get: ShapeResolver = (id) => this.editor.store.get(id)
    const all = this.editor.store.getAll()
    const bounds = boundsUnion(all.map((s) => boundsOf(s, get)))
    if (!bounds) return
    const { width, height } = this.app.screen
    const PAD = 80
    this.camera.zoom = Math.min(
      1,
      Math.max(
        Camera.MIN_ZOOM,
        Math.min(
          width / (bounds.width + PAD * 2),
          height / (bounds.height + PAD * 2),
        ),
      ),
    )
    this.camera.x = bounds.x + bounds.width / 2 - width / 2 / this.camera.zoom
    this.camera.y = bounds.y + bounds.height / 2 - height / 2 / this.camera.zoom
    this.applyCamera()
  }

  /** Render the board's content (shapes only — no grid, no selection UI)
   *  into a canvas for export. Returns null on an empty board. */
  exportCanvas(maxScale = 2): HTMLCanvasElement | null {
    const get: ShapeResolver = (id) => this.editor.store.get(id)
    const all = this.editor.store.getAll()
    const bounds = boundsUnion(all.map((s) => boundsOf(s, get)))
    if (!bounds) return null
    const PAD = 40
    const w = bounds.width + PAD * 2
    const h = bounds.height + PAD * 2
    // Cap the output so giant boards can't blow GPU texture limits.
    const scale = Math.min(maxScale, 4096 / Math.max(w, h))
    const background = `#${CANVAS_COLORS[effectiveTheme()].background
      .toString(16)
      .padStart(6, '0')}`
    return this.app.renderer.extract.canvas({
      target: this.world,
      frame: new Rectangle(bounds.x - PAD, bounds.y - PAD, w, h),
      resolution: scale,
      clearColor: background,
    }) as HTMLCanvasElement
  }

  /** Screen-constant sizes expressed in world units. */
  worldPx(px: number): number {
    return px / this.camera.zoom
  }

  handlePositions(b: Bounds): Record<HandleId, Point> {
    const mx = b.x + b.width / 2
    const my = b.y + b.height / 2
    return {
      nw: { x: b.x, y: b.y },
      n: { x: mx, y: b.y },
      ne: { x: b.x + b.width, y: b.y },
      e: { x: b.x + b.width, y: my },
      se: { x: b.x + b.width, y: b.y + b.height },
      s: { x: mx, y: b.y + b.height },
      sw: { x: b.x, y: b.y + b.height },
      w: { x: b.x, y: my },
    }
  }

  /** The four drag-out arrow handles floating just outside a shape,
   *  computed from its current bounds. */
  arrowHandlePositions(shape: Shape): { anchor: Point; world: Point }[] {
    const gap = this.worldPx(18)
    const b = boundsOf(shape, (id) => this.editor.store.get(id))
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    return [
      { anchor: { x: 0.5, y: 0 }, world: { x: cx, y: b.y - gap } },
      { anchor: { x: 1, y: 0.5 }, world: { x: b.x + b.width + gap, y: cy } },
      { anchor: { x: 0.5, y: 1 }, world: { x: cx, y: b.y + b.height + gap } },
      { anchor: { x: 0, y: 0.5 }, world: { x: b.x - gap, y: cy } },
    ]
  }

  /** Bend handles on a lone selected straight or curved connector. The
   *  middle handle always shows; once it has been dragged, two more
   *  appear at the quarter points for finer bending. Empty when hidden. */
  bendHandlePositions(): { which: 'q1' | 'mid' | 'q3'; p: Point }[] {
    const selected = this.editor.getSelectedShapes()
    if (selected.length !== 1 || selected[0].type !== 'connector') return []
    const conn = selected[0]
    if ((conn.route ?? 'straight') === 'elbow') return []
    const get: ShapeResolver = (id) => this.editor.store.get(id)
    const manual = conn.curvature ?? null
    if (manual === null) {
      return [{ which: 'mid', p: connectorMidpoint(conn, get) }]
    }
    const { a, b } = connectorEndpoints(conn, get)
    const path = connectorPath(conn, get)
    const sample = (f: number) => path[Math.round((path.length - 1) * f)]
    return [
      {
        which: 'q1',
        p: conn.bendQ1 != null ? bendPointOnChord(a, b, 0.25, conn.bendQ1) : sample(0.25),
      },
      { which: 'mid', p: bendPointOnChord(a, b, 0.5, manual) },
      {
        which: 'q3',
        p: conn.bendQ3 != null ? bendPointOnChord(a, b, 0.75, conn.bendQ3) : sample(0.75),
      },
    ]
  }

  /** World position of the rotation handle: floats diagonally off the
   *  bottom-right corner of a lone selected shape (rotating with it), or
   *  null. Bottom-right stays clear of the style popup (above), the
   *  arrow-out edge dots and the corner resize handles. */
  rotationHandlePosition(): Point | null {
    const selected = this.editor.getSelectedShapes()
    if (selected.length !== 1 || selected[0].type === 'connector') return null
    const s = selected[0]
    const c = { x: s.x + s.width / 2, y: s.y + s.height / 2 }
    const off = this.worldPx(18)
    return rotatePoint(
      { x: s.x + s.width + off, y: s.y + s.height + off },
      c,
      s.rotation ?? 0,
    )
  }

  /** Bounds of the resizable part of the selection, or null. */
  selectionBounds(): Bounds | null {
    const get: ShapeResolver = (id) => this.editor.store.get(id)
    const resizable = this.editor.getSelectedShapes().filter(isResizable)
    return boundsUnion(resizable.map((s) => boundsOf(s, get)))
  }

  destroy(): void {
    this.unsubscribers.forEach((fn) => fn())
    this.cameraListeners.clear()
    this.app.destroy(true, { children: true })
  }

  private drawShapes(): void {
    // Scaffold-simple: rebuild the whole scene on every document change.
    // Swap for keyed incremental updates once boards get large.
    const get: ShapeResolver = (id) => this.editor.store.get(id)
    this.world.removeChildren().forEach((c) => c.destroy({ children: true }))
    const onTextureReady = () => {
      if (this.app.renderer) {
        this.drawShapes()
        this.drawOverlay()
      }
    }
    for (const shape of this.editor.store.getAll()) {
      this.world.addChild(
        buildShape(shape, get, this.editor.editingId, onTextureReady),
      )
    }
  }

  private drawOverlay(): void {
    const o = this.overlay
    o.clear()
    const get: ShapeResolver = (id) => this.editor.store.get(id)
    const thin = this.worldPx(1.5)

    const selected = this.editor.getSelectedShapes()
    for (const s of selected) {
      if (s.type === 'connector') {
        // Highlight the line itself; a bounds box around a diagonal
        // arrow reads as noise.
        const pts = connectorPath(s, get)
        o.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) o.lineTo(pts[i].x, pts[i].y)
        o.stroke({ color: ACCENT, width: thin, alpha: 0.6 })
        continue
      }
      if (s.rotation) {
        // Outline follows the rotated frame, not the AABB.
        const c = { x: s.x + s.width / 2, y: s.y + s.height / 2 }
        const corners = [
          { x: s.x, y: s.y },
          { x: s.x + s.width, y: s.y },
          { x: s.x + s.width, y: s.y + s.height },
          { x: s.x, y: s.y + s.height },
        ].map((p) => rotatePoint(p, c, s.rotation!))
        o.poly(corners.flatMap((p) => [p.x, p.y])).stroke({
          color: ACCENT,
          width: thin,
        })
        continue
      }
      const b = boundsOf(s, get)
      o.rect(b.x, b.y, b.width, b.height).stroke({
        color: ACCENT,
        width: thin,
      })
    }

    // Draggable endpoint handles on a lone selected connector, plus a
    // bend handle at the midpoint (straight and curve routes).
    if (selected.length === 1 && selected[0].type === 'connector') {
      const conn = selected[0]
      const { a, b } = connectorEndpoints(conn, get)
      const r = this.worldPx(5)
      for (const p of [a, b]) {
        o.circle(p.x, p.y, r)
          .fill(0xffffff)
          .stroke({ color: ACCENT, width: thin })
      }
      for (const { which, p } of this.bendHandlePositions()) {
        o.circle(p.x, p.y, this.worldPx(which === 'mid' ? 4.5 : 3.5))
          .fill(ACCENT)
          .stroke({ color: 0xffffff, width: thin })
      }
    }

    // Resize handles only for unrotated selections: resizing a rotated
    // frame through axis-aligned handles distorts unpredictably.
    const rb = this.selectionBounds()
    if (rb && !selected.some((s) => s.type !== 'connector' && s.rotation)) {
      const size = this.worldPx(10)
      for (const p of Object.values(this.handlePositions(rb))) {
        o.rect(p.x - size / 2, p.y - size / 2, size, size)
          .fill(0xffffff)
          .stroke({ color: ACCENT, width: thin })
      }
    }

    // Rotation handle on a lone selected shape.
    const rp = this.rotationHandlePosition()
    if (rp) {
      const s = selected[0]
      const c = { x: s.x + s.width / 2, y: s.y + s.height / 2 }
      const corner = rotatePoint(
        { x: s.x + s.width, y: s.y + s.height },
        c,
        s.rotation ?? 0,
      )
      o.moveTo(corner.x, corner.y).lineTo(rp.x, rp.y).stroke({
        color: ACCENT,
        width: this.worldPx(1),
        alpha: 0.6,
      })
      o.circle(rp.x, rp.y, this.worldPx(5.5))
        .fill(0xffffff)
        .stroke({ color: ACCENT, width: thin })
    }

    if (this.marquee) {
      const m = this.marquee
      o.rect(m.x, m.y, m.width, m.height)
        .fill({ color: ACCENT, alpha: 0.08 })
        .stroke({ color: ACCENT, width: this.worldPx(1) })
    }

    if (this.drawPreview && this.drawPreview.points.length >= 4) {
      const pts = this.drawPreview.points
      o.moveTo(pts[0], pts[1])
      for (let i = 2; i < pts.length; i += 2) o.lineTo(pts[i], pts[i + 1])
      o.stroke({
        color: themedColor(this.drawPreview.color),
        width: this.drawPreview.width,
        cap: 'round',
        join: 'round',
      })
    }

    if (this.connectPreview) {
      drawArrow(o, this.connectPreview.a, this.connectPreview.b, ACCENT, 1, 3)
    }

    if (this.createPreview) {
      const { type, bounds: b } = this.createPreview
      const color = themedColor(this.createPreview.color)
      const alpha = type === 'sticky' ? 0.5 : 0.15
      const outline =
        type !== 'sticky' ? geoOutline(type, b.width, b.height) : null
      if (type === 'ellipse') {
        o.ellipse(b.x + b.width / 2, b.y + b.height / 2, b.width / 2, b.height / 2)
          .fill({ color, alpha })
          .stroke({ color, width: 2 })
      } else if (outline) {
        o.moveTo(b.x + outline[0], b.y + outline[1])
        for (let i = 2; i < outline.length; i += 2) {
          o.lineTo(b.x + outline[i], b.y + outline[i + 1])
        }
        o.closePath().fill({ color, alpha }).stroke({ color, width: 2 })
      } else {
        o.rect(b.x, b.y, b.width, b.height)
          .fill({ color, alpha })
          .stroke({ color, width: 2 })
      }
    }

    if (this.anchorDots) {
      const r = this.worldPx(4)
      for (const p of this.anchorDots.candidates) {
        o.circle(p.x, p.y, r)
          .fill({ color: 0xffffff, alpha: 0.9 })
          .stroke({ color: ACCENT, width: thin })
      }
      if (this.anchorDots.active) {
        o.circle(this.anchorDots.active.x, this.anchorDots.active.y, this.worldPx(6))
          .fill(ACCENT)
      }
    }

    if (this.arrowHandles) {
      const shape = get(this.arrowHandles.shapeId)
      if (shape && shape.type !== 'connector') {
        const active = this.arrowHandles.active
        const r = this.worldPx(5)
        for (const h of this.arrowHandlePositions(shape)) {
          if (active && h.anchor.x === active.x && h.anchor.y === active.y) {
            o.circle(h.world.x, h.world.y, this.worldPx(6.5)).fill(ACCENT)
          } else {
            o.circle(h.world.x, h.world.y, r)
              .fill({ color: 0xffffff, alpha: 0.9 })
              .stroke({ color: ACCENT, width: thin, alpha: 0.7 })
          }
        }
      }
    }

    if (this.snapGuides) {
      const view = {
        x: this.camera.x,
        y: this.camera.y,
        w: this.app.screen.width / this.camera.zoom,
        h: this.app.screen.height / this.camera.zoom,
      }
      const w = this.worldPx(1)
      for (const x of this.snapGuides.v) {
        o.moveTo(x, view.y)
          .lineTo(x, view.y + view.h)
          .stroke({ color: 0xec4899, width: w })
      }
      for (const y of this.snapGuides.h) {
        o.moveTo(view.x, y)
          .lineTo(view.x + view.w, y)
          .stroke({ color: 0xec4899, width: w })
      }
    }

    if (this.spacingGuides) {
      const w = this.worldPx(1.5)
      const tick = this.worldPx(5)
      for (const s of this.spacingGuides) {
        o.moveTo(s.a.x, s.a.y).lineTo(s.b.x, s.b.y)
        const horizontal = Math.abs(s.b.y - s.a.y) < 0.01
        for (const p of [s.a, s.b]) {
          if (horizontal) o.moveTo(p.x, p.y - tick).lineTo(p.x, p.y + tick)
          else o.moveTo(p.x - tick, p.y).lineTo(p.x + tick, p.y)
        }
      }
      o.stroke({ color: 0xec4899, width: w })
    }
  }

  redrawOverlay(): void {
    this.drawOverlay()
  }

  private drawGrid(): void {
    this.grid.clear()
    if (this.camera.zoom < 0.4) return // dots would be sub-pixel noise

    const { width, height } = this.app.screen
    const spacing = GRID_SPACING * this.camera.zoom
    const offsetX = -((this.camera.x * this.camera.zoom) % spacing)
    const offsetY = -((this.camera.y * this.camera.zoom) % spacing)

    for (let x = offsetX; x < width; x += spacing) {
      for (let y = offsetY; y < height; y += spacing) {
        this.grid.circle(x, y, 1.5)
      }
    }
    this.grid.fill(CANVAS_COLORS[effectiveTheme()].grid)
  }
}

function drawArrow(
  g: Graphics,
  a: Point,
  b: Point,
  color: number,
  alpha: number,
  width: number,
): void {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1) return
  const ux = dx / len
  const uy = dy / len
  const head = Math.min(14, len / 2)
  const base = { x: b.x - ux * head, y: b.y - uy * head }
  const px = -uy
  const py = ux
  g.moveTo(a.x, a.y)
    .lineTo(base.x, base.y)
    .stroke({ color, alpha, width, cap: 'round' })
  g.poly([
    b.x,
    b.y,
    base.x + px * (head / 2),
    base.y + py * (head / 2),
    base.x - px * (head / 2),
    base.y - py * (head / 2),
  ]).fill({ color, alpha })
}

/** Textures for image shapes, keyed by data URL. `null` = loading. */
const textureCache = new Map<string, Texture | null>()

function buildShape(
  shape: Shape,
  get: ShapeResolver,
  editingId: string | null,
  onTextureReady: () => void,
): Container {
  const node = new Container()
  const g = new Graphics()
  node.addChild(g)
  if (shape.type !== 'connector') {
    if (shape.rotation) {
      // Rotate around the shape's center.
      node.pivot.set(shape.width / 2, shape.height / 2)
      node.position.set(shape.x + shape.width / 2, shape.y + shape.height / 2)
      node.rotation = shape.rotation
    } else {
      node.position.set(shape.x, shape.y)
    }
  }

  const addLabel = (s: StickyShape | GeoShape) => {
    if (!s.text || s.id === editingId) return
    const alignH = s.textAlign ?? 'center'
    const alignV = s.textVAlign ?? 'middle'
    const fontSize = s.fontSize ?? 16
    const label = new Text({
      text: s.text,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize,
        // Match the text editor's line-height so entering/leaving edit
        // mode doesn't shift the text.
        lineHeight: fontSize * 1.3,
        fontWeight: s.bold ? '700' : '400',
        fill: labelColor(s.fillColor, s.fillOpacity),
        wordWrap: true,
        wordWrapWidth: Math.max(16, s.width - 24),
        align: alignH,
      },
    })
    const ax = alignH === 'left' ? 0 : alignH === 'center' ? 0.5 : 1
    const ay = alignV === 'top' ? 0 : alignV === 'middle' ? 0.5 : 1
    label.anchor.set(ax, ay)
    label.position.set(
      alignH === 'left' ? 12 : alignH === 'center' ? s.width / 2 : s.width - 12,
      alignV === 'top' ? 12 : alignV === 'middle' ? s.height / 2 : s.height - 12,
    )
    node.addChild(label)
  }

  const fill = { color: themedColor(shape.fillColor), alpha: shape.fillOpacity }
  const stroke = {
    color: themedColor(shape.strokeColor),
    alpha: shape.strokeOpacity,
    width: shape.strokeWidth,
  }

  const dash = shape.dash ?? 'solid'

  switch (shape.type) {
    case 'sticky': {
      g.rect(0, 0, shape.width, shape.height).fill(fill)
      if (stroke.width > 0) {
        if (dash === 'solid') {
          g.rect(0, 0, shape.width, shape.height).stroke(stroke)
        } else {
          strokeSubpaths(g, [rectOutline(shape.width, shape.height)], stroke, dash)
        }
      }
      addLabel(shape)
      break
    }
    case 'geo': {
      drawGeo(g, shape, fill, stroke, dash)
      addLabel(shape)
      break
    }
    case 'draw': {
      const pts = denormalizedPoints(shape)
      // One shape can carry several strokes: a NaN pair marks a pen-lift, so
      // the next point starts a new sub-path instead of connecting across it.
      const subs: Point[][] = []
      let current: Point[] = []
      for (let i = 0; i + 1 < pts.length; i += 2) {
        if (Number.isNaN(pts[i])) {
          if (current.length) subs.push(current)
          current = []
          continue
        }
        current.push({ x: pts[i] - shape.x, y: pts[i + 1] - shape.y })
      }
      if (current.length) subs.push(current)
      strokeSubpaths(g, subs, stroke, dash)
      break
    }
    case 'connector': {
      drawConnector(g, connectorPath(shape, get), shape)
      break
    }
    case 'image': {
      const cached = textureCache.get(shape.src)
      if (cached) {
        const sprite = new Sprite(cached)
        sprite.width = shape.width
        sprite.height = shape.height
        node.addChild(sprite)
      } else {
        // Loading placeholder; redraw once the texture arrives.
        g.rect(0, 0, shape.width, shape.height).fill({
          color: 0x94a3b8,
          alpha: 0.15,
        })
        if (!textureCache.has(shape.src)) {
          textureCache.set(shape.src, null)
          Assets.load<Texture>(shape.src)
            .then((tex) => {
              textureCache.set(shape.src, tex)
              onTextureReady()
            })
            .catch(() => textureCache.delete(shape.src))
        }
      }
      if (stroke.width > 0) {
        const border = new Graphics()
        if (dash === 'solid') {
          border.rect(0, 0, shape.width, shape.height).stroke(stroke)
        } else {
          strokeSubpaths(
            border,
            [rectOutline(shape.width, shape.height)],
            stroke,
            dash,
          )
        }
        node.addChild(border)
      }
      break
    }
  }
  return node
}

/** Stroke polylines in the given line style. Solid strokes pass through
 *  untouched; dashed/dotted reuse the connector dash machinery, so pen
 *  strokes and shape borders share one look. */
function strokeSubpaths(
  g: Graphics,
  subs: Point[][],
  stroke: { color: number; alpha: number; width: number },
  dash: LineDash,
): void {
  const width = Math.max(1, stroke.width)
  if (dash === 'dotted') {
    const r = Math.max(1.5, width * 0.75)
    for (const sub of subs) {
      for (const p of sampleAlong(sub, Math.max(8, width * 3.5))) {
        g.circle(p.x, p.y, r)
      }
    }
    g.fill({ color: stroke.color, alpha: stroke.alpha })
    return
  }
  const drawn =
    dash === 'dashed'
      ? subs.flatMap((sub) =>
          dashedSubpaths(sub, Math.max(9, width * 3), Math.max(6, width * 2)),
        )
      : subs
  for (const sub of drawn) {
    if (sub.length < 2) continue
    g.moveTo(sub[0].x, sub[0].y)
    for (let i = 1; i < sub.length; i++) g.lineTo(sub[i].x, sub[i].y)
  }
  g.stroke({ ...stroke, width: stroke.width || 1, cap: 'round', join: 'round' })
}

/** Closed rectangle outline as a polyline (for dashed/dotted borders). */
/** Render any shape-library kind: polygon kinds from their outline, plus
 *  the specially-drawn rect / ellipse / cylinder. */
function drawGeo(
  g: Graphics,
  shape: GeoShape,
  fill: { color: number; alpha: number },
  stroke: { color: number; alpha: number; width: number },
  dash: LineDash,
): void {
  const w = shape.width
  const h = shape.height
  const strokePath = (path: Point[]) => {
    if (stroke.width <= 0) return
    if (dash === 'solid') {
      g.moveTo(path[0].x, path[0].y)
      for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y)
      g.stroke(stroke)
    } else {
      strokeSubpaths(g, [path], stroke, dash)
    }
  }

  if (shape.geo === 'rect') {
    g.rect(0, 0, w, h).fill(fill)
    strokePath(rectOutline(w, h))
    return
  }
  if (shape.geo === 'ellipse') {
    g.ellipse(w / 2, h / 2, w / 2, h / 2).fill(fill)
    strokePath(ellipseOutline(w, h))
    return
  }
  if (shape.geo === 'cylinder') {
    const capH = Math.min(h * 0.18, w * 0.35)
    // Fill: top cap ellipse + body + bottom cap ellipse.
    g.ellipse(w / 2, h - capH / 2, w / 2, capH / 2)
    g.rect(0, capH / 2, w, h - capH)
    g.ellipse(w / 2, capH / 2, w / 2, capH / 2)
    g.fill(fill)
    if (stroke.width > 0) {
      const top = ellipseCap(w, capH, 0)
      const bottomHalf = ellipseCap(w, capH, h - capH, true)
      const walls: Point[][] = [
        [{ x: 0, y: capH / 2 }, { x: 0, y: h - capH / 2 }],
        [{ x: w, y: capH / 2 }, { x: w, y: h - capH / 2 }],
      ]
      for (const p of [top, bottomHalf, ...walls]) {
        if (dash === 'solid') {
          g.moveTo(p[0].x, p[0].y)
          for (let i = 1; i < p.length; i++) g.lineTo(p[i].x, p[i].y)
          g.stroke(stroke)
        } else {
          strokeSubpaths(g, [p], stroke, dash)
        }
      }
    }
    return
  }

  if (shape.geo === 'pipe') {
    // A cylinder on its side: full cap ellipse on the right, bulge arc on
    // the left, straight walls between.
    const capW = Math.min(w * 0.18, h * 0.35)
    g.ellipse(capW / 2, h / 2, capW / 2, h / 2)
    g.rect(capW / 2, 0, w - capW, h)
    g.ellipse(w - capW / 2, h / 2, capW / 2, h / 2)
    g.fill(fill)
    if (stroke.width > 0) {
      const right = ellipseSideCap(capW, h, w - capW, false)
      const leftHalf = ellipseSideCap(capW, h, 0, true)
      const walls: Point[][] = [
        [{ x: capW / 2, y: 0 }, { x: w - capW / 2, y: 0 }],
        [{ x: capW / 2, y: h }, { x: w - capW / 2, y: h }],
      ]
      for (const p of [right, leftHalf, ...walls]) {
        if (dash === 'solid') {
          g.moveTo(p[0].x, p[0].y)
          for (let i = 1; i < p.length; i++) g.lineTo(p[i].x, p[i].y)
          g.stroke(stroke)
        } else {
          strokeSubpaths(g, [p], stroke, dash)
        }
      }
    }
    return
  }

  const outline = geoOutline(shape.geo, w, h)
  if (!outline) {
    g.rect(0, 0, w, h).fill(fill)
    strokePath(rectOutline(w, h))
    return
  }
  const path: Point[] = []
  for (let i = 0; i < outline.length; i += 2) {
    path.push({ x: outline[i], y: outline[i + 1] })
  }
  g.poly(outline).fill(fill)
  path.push(path[0]) // close the stroke
  strokePath(path)
}

/** Full or left-half vertical ellipse outline for the pipe caps. */
function ellipseSideCap(capW: number, h: number, left: number, leftHalf: boolean): Point[] {
  const cx = left + capW / 2
  const cy = h / 2
  const steps = 32
  const from = leftHalf ? Math.PI / 2 : 0
  const to = leftHalf ? (3 * Math.PI) / 2 : 2 * Math.PI
  const out: Point[] = []
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps
    out.push({ x: cx + (capW / 2) * Math.cos(a), y: cy + (h / 2) * Math.sin(a) })
  }
  return out
}

/** Full or lower-half ellipse outline for the cylinder caps. */
function ellipseCap(w: number, capH: number, top: number, lowerHalf = false): Point[] {
  const cx = w / 2
  const cy = top + capH / 2
  const steps = 32
  const from = lowerHalf ? 0 : 0
  const to = lowerHalf ? Math.PI : 2 * Math.PI
  const out: Point[] = []
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps
    out.push({ x: cx + (w / 2) * Math.cos(a), y: cy + (capH / 2) * Math.sin(a) })
  }
  return out
}

function rectOutline(w: number, h: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
    { x: 0, y: 0 },
  ]
}

/** Closed ellipse outline sampled as a polyline (for dashed/dotted borders). */
function ellipseOutline(w: number, h: number): Point[] {
  const cx = w / 2
  const cy = h / 2
  const steps = 64
  const out: Point[] = []
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    out.push({ x: cx + cx * Math.cos(t), y: cy + cy * Math.sin(t) })
  }
  return out
}

/** Split a polyline into drawn sub-paths following a dash pattern. */
function dashedSubpaths(
  pts: Point[],
  dashLen: number,
  gapLen: number,
): Point[][] {
  const out: Point[][] = []
  let current: Point[] = []
  let draw = true
  let remaining = dashLen
  for (let i = 0; i + 1 < pts.length; i++) {
    let p = pts[i]
    const q = pts[i + 1]
    let segLen = Math.hypot(q.x - p.x, q.y - p.y)
    if (segLen < 1e-6) continue
    const ux = (q.x - p.x) / segLen
    const uy = (q.y - p.y) / segLen
    while (segLen > 1e-6) {
      const step = Math.min(remaining, segLen)
      const np = { x: p.x + ux * step, y: p.y + uy * step }
      if (draw) {
        if (current.length === 0) current.push(p)
        current.push(np)
      }
      p = np
      segLen -= step
      remaining -= step
      if (remaining <= 1e-6) {
        if (draw && current.length > 1) out.push(current)
        current = []
        draw = !draw
        remaining = draw ? dashLen : gapLen
      }
    }
  }
  if (draw && current.length > 1) out.push(current)
  return out
}

/** Points spaced `gap` apart along a polyline (for dotted lines). */
function sampleAlong(pts: Point[], gap: number): Point[] {
  const out: Point[] = []
  let remaining = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    let p = pts[i]
    const q = pts[i + 1]
    let segLen = Math.hypot(q.x - p.x, q.y - p.y)
    if (segLen < 1e-6) continue
    const ux = (q.x - p.x) / segLen
    const uy = (q.y - p.y) / segLen
    while (segLen >= remaining) {
      const np = { x: p.x + ux * remaining, y: p.y + uy * remaining }
      out.push(np)
      segLen -= remaining
      p = np
      remaining = gap
    }
    remaining -= segLen
  }
  return out
}

function unitVec(a: Point, b: Point): Point {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
}

function drawConnector(g: Graphics, path: Point[], c: ConnectorShape): void {
  if (path.length < 2) return
  const color = themedColor(c.strokeColor)
  const alpha = c.strokeOpacity
  const width = Math.max(1, c.strokeWidth)
  const startHead = c.startHead ?? 'none'
  const endHead = c.endHead ?? 'arrow'
  const dash = c.dash ?? 'solid'
  const headLen = Math.max(10, width * 3.5)

  const tStart = unitVec(path[0], path[1])
  const tEnd = unitVec(path[path.length - 2], path[path.length - 1])

  // Trim the line under triangular heads so it doesn't poke through.
  const pts = path.map((p) => ({ ...p }))
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (endHead === 'arrow') {
    last.x -= tEnd.x * headLen * 0.8
    last.y -= tEnd.y * headLen * 0.8
  }
  if (startHead === 'arrow') {
    first.x += tStart.x * headLen * 0.8
    first.y += tStart.y * headLen * 0.8
  }

  if (dash === 'dotted') {
    const r = Math.max(1.5, width * 0.75)
    for (const p of sampleAlong(pts, Math.max(8, width * 3.5))) {
      g.circle(p.x, p.y, r)
    }
    g.fill({ color, alpha })
  } else {
    const subpaths =
      dash === 'dashed'
        ? dashedSubpaths(pts, Math.max(9, width * 3), Math.max(6, width * 2))
        : [pts]
    for (const sp of subpaths) {
      g.moveTo(sp[0].x, sp[0].y)
      for (let i = 1; i < sp.length; i++) g.lineTo(sp[i].x, sp[i].y)
    }
    g.stroke({ color, alpha, width, cap: 'round', join: 'round' })
  }

  const drawHead = (tip: Point, dir: Point, kind: string) => {
    if (kind === 'arrow') {
      const bx = tip.x - dir.x * headLen
      const by = tip.y - dir.y * headLen
      const px = -dir.y
      const py = dir.x
      g.poly([
        tip.x,
        tip.y,
        bx + px * (headLen / 2),
        by + py * (headLen / 2),
        bx - px * (headLen / 2),
        by - py * (headLen / 2),
      ]).fill({ color, alpha })
    } else if (kind === 'dot') {
      g.circle(tip.x, tip.y, width * 1.2 + 2).fill({ color, alpha })
    }
  }
  drawHead(path[path.length - 1], tEnd, endHead)
  drawHead(path[0], { x: -tStart.x, y: -tStart.y }, startHead)
}
