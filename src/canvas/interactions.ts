import type { BoardRenderer, HandleId } from './renderer'
import type { Editor } from '../editor/Editor'
import { newShapeId } from '../collab/store'
import { recognizeStroke, type RecognizedStroke } from '../scene/recognize'
import {
  ANCHOR_POSITIONS,
  anchorAt,
  anchorPoint,
  boundsIntersect,
  boundsOf,
  boundsUnion,
  canHaveText,
  connectorEndpoints,
  denormalizedPoints,
  hitTest,
  isCenterAnchor,
  MIN_SIZE,
  pointOnShape,
  STROKE_BREAK,
  type Bounds,
  type ConnectorShape,
  type DrawShape,
  type Point,
  type Shape,
  type ShapeId,
  type Tool,
} from '../scene/types'

type Session =
  | { kind: 'none' }
  | { kind: 'pan'; fingerTap: Point | null }
  | { kind: 'marquee'; startW: Point; additive: boolean }
  | {
      kind: 'move'
      startW: Point
      snapshots: Map<ShapeId, Shape>
      moved: boolean
      /** Union bounds of the moving shapes at drag start. */
      startBounds: Bounds | null
      /** Snap targets: x and y lines from every non-selected shape. */
      candX: number[]
      candY: number[]
      /** Full bounds of non-selected shapes, for spacing snaps. */
      othersBounds: Bounds[]
    }
  | {
      kind: 'resize'
      handle: HandleId
      startBounds: Bounds
      snapshots: Map<ShapeId, Shape>
    }
  | {
      kind: 'draw'
      points: number[]
      /** Stylus in select mode: a tap (no movement) selects what is under
       *  the pen instead of leaving an invisible dot. */
      tapSelects?: boolean
    }
  | { kind: 'create'; type: 'sticky' | 'rect' | 'ellipse'; startW: Point }
  | { kind: 'pinch'; lastMid: Point; lastDist: number }
  | {
      kind: 'connect'
      startId: ShapeId | null
      startW: Point
      startAnchor: Point | null
      /** Set when dragging an existing connector's endpoint to re-anchor. */
      reattach: { id: ShapeId; end: 'start' | 'end'; fixed: Point } | null
    }

const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'hand',
  p: 'pen',
  s: 'sticky',
  r: 'rect',
  o: 'ellipse',
  c: 'connector',
}

/**
 * Translates pointer/wheel/keyboard input into camera moves, editor state
 * changes, and document mutations. One instance per mounted canvas.
 */
export class InteractionController {
  private host: HTMLElement
  private renderer: BoardRenderer
  private editor: Editor
  private session: Session = { kind: 'none' }
  private spaceHeld = false
  /** Shape currently showing drag-out arrow handles (select-tool hover). */
  private arrowShapeId: ShapeId | null = null
  /** Live finger contacts (touch only — never the pen), for pinch. */
  private activePointers = new Map<number, Point>()
  /** Once a stylus is seen, bare fingers pan instead of drawing/selecting
   *  (palm- and thumb-friendly, like most tablet whiteboards). */
  private penSeen = false
  /** Pointer driving the current session; other contacts (palm!) are
   *  ignored so they can't corrupt or cancel an in-flight gesture. */
  private sessionPointerId: number | null = null
  private sessionPointerType = ''
  private last: Point = { x: 0, y: 0 }
  private detachFns: (() => void)[] = []
  /**
   * Ink-first pipeline: pen-down carries ZERO decisions — a pen or stylus
   * stroke always lands as ink, unconditionally, in the open buffer shape.
   * Interpretation (grouping, shape recognition) happens exactly once, on
   * a single idle timer after the writing burst goes quiet. Nothing that a
   * palm, a hover, or a stale session does can cost the user a stroke.
   */
  private inkBuffer: {
    /** The live draw shape accumulating this burst's strokes. */
    id: ShapeId
    strokes: number
    /** Raw world points of the only stroke — shape recognition applies to
     *  lone strokes only; a second stroke means handwriting. */
    loneStroke: Point[] | null
    /** Shape bounds as we last wrote them: a mismatch at close means the
     *  user moved/resized the ink, so it is left exactly as-is. */
    bounds: Bounds
    timer: ReturnType<typeof setTimeout> | null
  } | null = null
  /** Silence after the last pen-up that ends a writing burst. */
  private static readonly INK_IDLE_MS = 1200

  constructor(host: HTMLElement, renderer: BoardRenderer, editor: Editor) {
    this.host = host
    this.renderer = renderer
    this.editor = editor
  }

  attach(): void {
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: string,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.detachFns.push(() =>
        target.removeEventListener(type, fn as EventListener),
      )
    }
    // iOS Safari runs its own gesture recognition on the raw TOUCH stream
    // even under touch-action: none (a long-standing WebKit quirk): two
    // quick pencil contacts — crossing a t — read as a double-tap, and
    // Safari may cancel or swallow the second contact's pointer events.
    // Claiming stylus touches disables that path entirely. Finger touches
    // keep their defaults so double-tapping a sticky still edits text.
    const claimStylusTouch = (e: TouchEvent) => {
      // While the text editor is open the pencil is writing TEXT (iPadOS
      // Scribble handwriting); claiming its touches would kill that input.
      if (this.editor.editingId) return
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].touchType !== 'stylus') return
      }
      e.preventDefault()
    }
    on(this.host, 'touchstart', claimStylusTouch, { passive: false })
    on(this.host, 'touchmove', claimStylusTouch, { passive: false })
    on(this.host, 'touchend', claimStylusTouch, { passive: false })
    on(this.host, 'pointerdown', (e) => this.onPointerDown(e as PointerEvent))
    on(this.host, 'pointermove', (e) => this.onPointerMove(e as PointerEvent))
    on(this.host, 'pointerup', (e) => this.onPointerUp(e as PointerEvent))
    on(this.host, 'pointercancel', (e) => this.onPointerCancel(e as PointerEvent))
    on(this.host, 'dblclick', (e) => this.onDoubleClick(e as MouseEvent))
    on(this.host, 'wheel', (e) => this.onWheel(e as WheelEvent), {
      passive: false,
    })
    on(this.host, 'contextmenu', (e) => e.preventDefault())
    on(window, 'keydown', (e) => this.onKey(e as KeyboardEvent))
    on(window, 'keyup', (e) => this.onKey(e as KeyboardEvent))
    on(window, 'paste', (e) => this.onPaste(e as ClipboardEvent))
    on(this.host, 'dragover', (e) => e.preventDefault())
    on(this.host, 'drop', (e) => this.onDrop(e as DragEvent))
  }

  // ---- images (paste / drop) ----------------------------------------------

  private onPaste(e: ClipboardEvent): void {
    const target = e.target as HTMLElement
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)
      return
    for (const item of e.clipboardData?.items ?? []) {
      if (!item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (!file) continue
      e.preventDefault()
      this.readImageFile(file)
      return
    }
  }

  private onDrop(e: DragEvent): void {
    e.preventDefault()
    const at = this.camera.screenToWorld(e.offsetX, e.offsetY)
    for (const file of e.dataTransfer?.files ?? []) {
      if (file.type.startsWith('image/')) {
        this.readImageFile(file, at)
        return
      }
    }
  }

  private readImageFile(file: File, at?: Point): void {
    const reader = new FileReader()
    reader.onload = () => this.placeImage(reader.result as string, at)
    reader.readAsDataURL(file)
  }

  private placeImage(src: string, at?: Point): void {
    const probe = new Image()
    probe.onload = () => {
      const natW = probe.naturalWidth || 300
      const natH = probe.naturalHeight || 300
      const MAX = 480
      const scale = Math.min(1, MAX / Math.max(natW, natH))
      const w = natW * scale
      const h = natH * scale
      const { width, height } = this.renderer.app.screen
      const center = at ?? this.camera.screenToWorld(width / 2, height / 2)
      const id = newShapeId()
      this.editor.store.add({
        id,
        type: 'image',
        src,
        x: center.x - w / 2,
        y: center.y - h / 2,
        width: w,
        height: h,
        z: this.editor.store.topZ() + 1,
        fillColor: 0xffffff,
        fillOpacity: 0,
        strokeColor: 0x475569,
        strokeOpacity: 1,
        strokeWidth: 0,
      })
      this.editor.select([id])
      this.editor.setTool('select')
    }
    probe.src = src
  }

  detach(): void {
    if (this.inkBuffer?.timer) clearTimeout(this.inkBuffer.timer)
    this.inkBuffer = null
    this.detachFns.forEach((fn) => fn())
    this.detachFns = []
  }

  private get camera() {
    return this.renderer.camera
  }

  private world(e: MouseEvent): Point {
    return this.camera.screenToWorld(e.offsetX, e.offsetY)
  }

  private topShapeAt(w: Point, excludeConnectors = false): Shape | null {
    const get = (id: ShapeId) => this.editor.store.get(id)
    const all = this.editor.store.getAll()
    const tol = this.renderer.worldPx(6)
    for (let i = all.length - 1; i >= 0; i--) {
      if (excludeConnectors && all[i].type === 'connector') continue
      if (hitTest(all[i], w, get, tol)) return all[i]
    }
    return null
  }

  /** On a small selection (e.g. handwriting) the eight handle grab zones
   *  blanket the ink, which would turn every drag into a resize. Prefer
   *  moving when the pointer is actually on a selected shape and the
   *  selection is that small; the handle squares clear of the ink still
   *  resize. */
  private moveWinsOverResize(w: Point): boolean {
    const b = this.renderer.selectionBounds()
    if (!b) return false
    const grab = this.renderer.worldPx(8)
    if (b.width > grab * 6 && b.height > grab * 6) return false
    const hit = this.topShapeAt(w)
    return !!hit && this.editor.selection.has(hit.id)
  }

  private handleAt(w: Point): HandleId | null {
    const b = this.renderer.selectionBounds()
    if (!b) return null
    const grab = this.renderer.worldPx(8)
    for (const [id, p] of Object.entries(this.renderer.handlePositions(b))) {
      if (Math.abs(w.x - p.x) <= grab && Math.abs(w.y - p.y) <= grab) {
        return id as HandleId
      }
    }
    return null
  }

  private snapshotSelection(): Map<ShapeId, Shape> {
    const map = new Map<ShapeId, Shape>()
    for (const s of this.editor.getSelectedShapes()) {
      map.set(s.id, cloneShape(s))
    }
    return map
  }

  // ---- pointer events ----------------------------------------------------

  private onPointerDown(e: PointerEvent): void {
    // Text input mode: contacts are writing TEXT, not ink. The textarea is a
    // child of the host, so its events bubble here — never capture them or
    // start a session. A contact outside the textarea moves focus off it,
    // which commits the edit (blur) — closing the editor is all a tap
    // outside should do; it must not also draw or select.
    if (this.editor.editingId) return
    const w = this.world(e)
    this.last = { x: e.offsetX, y: e.offsetY }
    this.host.setPointerCapture(e.pointerId)
    if (e.pointerType === 'pen') {
      this.penSeen = true
      // The pen always wins: a resting palm's pan (or pinch) must not
      // swallow the stroke that is about to start.
      if (
        this.session.kind === 'pinch' ||
        (this.session.kind !== 'none' && this.sessionPointerType === 'touch')
      ) {
        this.cancelSession()
        this.editor.setSessionActive(false)
      } else if (
        this.session.kind === 'draw' &&
        this.sessionPointerType === 'pen' &&
        e.pointerId !== this.sessionPointerId
      ) {
        // Safari sometimes swallows a pen-up outright when quick double
        // contacts trip its gesture recognizer. There is only one pen, so
        // a fresh pen-down proves the old contact ended: commit its ink and
        // let this stroke start clean — never ignore it (that deadlocks the
        // controller, eating every stroke that follows).
        const points = this.session.points
        this.session = { kind: 'none' }
        this.renderer.drawPreview = null
        this.renderer.redrawOverlay()
        this.finishDraw(points)
      }
    }
    if (e.pointerType === 'touch') {
      // Palm rejection: while the pen is mid-gesture, stray touches are
      // ignored completely.
      if (
        this.session.kind !== 'none' &&
        this.sessionPointerType === 'pen'
      ) {
        return
      }
      this.activePointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY })
      // Second finger down: whatever the first finger was doing becomes
      // a pinch.
      if (this.activePointers.size === 2) {
        this.cancelSession()
        const [p1, p2] = [...this.activePointers.values()]
        this.session = {
          kind: 'pinch',
          lastMid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
          lastDist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        }
        this.editor.setSessionActive(true)
        return
      }
      if (this.activePointers.size > 2) return
    }

    // Only the pointer that started a gesture may extend it.
    if (this.session.kind !== 'none' && this.session.kind !== 'pinch') return
    this.sessionPointerId = e.pointerId
    this.sessionPointerType = e.pointerType

    const fingerPans =
      this.penSeen &&
      e.pointerType === 'touch' &&
      this.editor.fingerPansWithStylus &&
      // An explicitly chosen drawing tool means the finger should use it.
      (this.editor.tool === 'select' || this.editor.tool === 'hand')
    const wantsPan =
      e.button === 1 ||
      e.button === 2 ||
      fingerPans ||
      (e.button === 0 && (this.spaceHeld || this.editor.tool === 'hand'))
    if (wantsPan) {
      this.session = {
        kind: 'pan',
        // In stylus mode a finger TAP (press without dragging) should
        // still select — only a drag pans.
        fingerTap: fingerPans ? { x: e.offsetX, y: e.offsetY } : null,
      }
      this.host.style.cursor = 'grabbing'
      this.editor.setSessionActive(true)
      // Panning (often just a planted palm) leaves the freehand group open:
      // time and proximity alone decide whether the next stroke merges.
      return
    }
    if (e.button !== 0) return

    switch (this.editor.tool) {
      case 'select':
        this.beginSelectSession(w, e.shiftKey, e.pointerType === 'pen')
        break
      case 'pen':
        // No decisions at pen-down — the stroke lands no matter what. The
        // idle timer is paused so the buffer can't close mid-stroke.
        this.pauseInkTimer()
        this.session = { kind: 'draw', points: [w.x, w.y] }
        break
      case 'connector': {
        const target = this.topShapeAt(w, true)
        this.session = {
          kind: 'connect',
          startId: target?.id ?? null,
          startW: w,
          startAnchor: target
            ? anchorAt(target, w, this.anchorTol()).anchor
            : null,
          reattach: null,
        }
        break
      }
      case 'sticky':
      case 'rect':
      case 'ellipse':
        // Creation happens on pointerup: a plain click places the default
        // size, a drag sizes the shape in one motion.
        this.session = { kind: 'create', type: this.editor.tool, startW: w }
        break
    }
    this.editor.setSessionActive(this.session.kind !== 'none')
  }

  /** Endpoint of the single selected connector under the pointer, if any. */
  private connectorEndpointAt(
    w: Point,
  ): { id: ShapeId; end: 'start' | 'end'; fixed: Point } | null {
    const sel = this.editor.getSelectedShapes()
    if (sel.length !== 1 || sel[0].type !== 'connector') return null
    const get = (id: ShapeId) => this.editor.store.get(id)
    const { a, b } = connectorEndpoints(sel[0], get)
    const grab = this.renderer.worldPx(8)
    if (Math.hypot(w.x - a.x, w.y - a.y) <= grab)
      return { id: sel[0].id, end: 'start', fixed: b }
    if (Math.hypot(w.x - b.x, w.y - b.y) <= grab)
      return { id: sel[0].id, end: 'end', fixed: a }
    return null
  }

  private anchorTol(): number {
    return this.renderer.worldPx(12)
  }

  private arrowHandleHit(w: Point): { shapeId: ShapeId; anchor: Point } | null {
    if (!this.arrowShapeId) return null
    const shape = this.editor.store.get(this.arrowShapeId)
    if (!shape) return null
    const grab = this.renderer.worldPx(9)
    for (const h of this.renderer.arrowHandlePositions(shape)) {
      if (Math.hypot(w.x - h.world.x, w.y - h.world.y) <= grab) {
        return { shapeId: shape.id, anchor: h.anchor }
      }
    }
    return null
  }

  /** True when a stylus pen-down should manipulate the CURRENT selection
   *  (resize handle, connector endpoint, or dragging a selected shape)
   *  rather than draw. With nothing selected a stylus always draws. */
  private stylusManipulatesSelection(w: Point): boolean {
    if (this.editor.selection.size === 0) return false
    if (this.handleAt(w) && !this.moveWinsOverResize(w)) return true
    if (this.connectorEndpointAt(w)) return true
    const hit = this.topShapeAt(w)
    return !!hit && this.editor.selection.has(hit.id)
  }

  private beginSelectSession(w: Point, shift: boolean, stylus = false): void {
    // Ink-first stylus rule: unless the pen lands on the current selection
    // (tap first, then manipulate), it draws — unconditionally. All
    // interpretation happens at pen-up (tap-select) or on the idle timer,
    // so no hover handle or hit-test can ever cost the user a stroke.
    if (stylus && !this.stylusManipulatesSelection(w)) {
      this.pauseInkTimer()
      this.session = { kind: 'draw', points: [w.x, w.y], tapSelects: true }
      return
    }

    // Drag-out arrow handle: start drawing an arrow from this shape
    // without switching tools.
    const arrowStart = this.arrowHandleHit(w)
    if (arrowStart) {
      this.renderer.arrowHandles = null
      this.renderer.redrawOverlay()
      this.session = {
        kind: 'connect',
        startId: arrowStart.shapeId,
        startW: w,
        startAnchor: arrowStart.anchor,
        reattach: null,
      }
      return
    }

    const endpoint = this.connectorEndpointAt(w)
    if (endpoint) {
      this.session = {
        kind: 'connect',
        startId: null,
        startW: w,
        startAnchor: null,
        reattach: endpoint,
      }
      return
    }

    const handle = this.handleAt(w)
    if (handle && !this.moveWinsOverResize(w)) {
      const startBounds = this.renderer.selectionBounds()!
      const snapshots = new Map<ShapeId, Shape>()
      for (const s of this.editor.getSelectedShapes()) {
        if (s.type !== 'connector') snapshots.set(s.id, cloneShape(s))
      }
      this.session = { kind: 'resize', handle, startBounds, snapshots }
      return
    }

    const hit = this.topShapeAt(w)
    if (hit) {
      if (shift) {
        this.editor.toggleSelected(hit.id)
        this.session = { kind: 'none' }
        return
      }
      if (!this.editor.selection.has(hit.id)) this.editor.select([hit.id])
      const snapshots = this.snapshotSelection()
      const get = (id: ShapeId) => this.editor.store.get(id)
      const startBounds = boundsUnion(
        [...snapshots.values()].map((s) => boundsOf(s, get)),
      )
      const candX: number[] = []
      const candY: number[] = []
      const othersBounds: Bounds[] = []
      for (const other of this.editor.store.getAll()) {
        if (snapshots.has(other.id) || other.type === 'connector') continue
        candX.push(other.x, other.x + other.width / 2, other.x + other.width)
        candY.push(other.y, other.y + other.height / 2, other.y + other.height)
        othersBounds.push({
          x: other.x,
          y: other.y,
          width: other.width,
          height: other.height,
        })
      }
      this.session = {
        kind: 'move',
        startW: w,
        snapshots,
        moved: false,
        startBounds,
        candX,
        candY,
        othersBounds,
      }
      return
    }

    if (!shift) this.editor.clearSelection()
    this.session = { kind: 'marquee', startW: w, additive: shift }
  }

  private static DEFAULT_SIZES = {
    sticky: { width: 200, height: 200 },
    rect: { width: 240, height: 160 },
    ellipse: { width: 200, height: 140 },
  } as const

  /** Runs on pointerup, so opening the sticky text editor is safe (no
   *  later mousedown default action can blur the fresh textarea). */
  private createShape(
    type: 'sticky' | 'rect' | 'ellipse',
    bounds: Bounds,
  ): void {
    const id = newShapeId()
    const sticky = type === 'sticky'
    this.editor.store.add({
      id,
      type,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      z: this.editor.store.topZ() + 1,
      ...this.editor.styleDefaults,
      // Stickies read best as solid cards with a faint outline, whatever
      // the configured shape defaults are.
      ...(sticky
        ? {
            fillOpacity: 1,
            strokeColor: 0x000000,
            strokeOpacity: 0.08,
            strokeWidth: 1,
          }
        : null),
      text: '',
      ...this.editor.textDefaults,
    } as Shape)
    this.editor.select([id])
    this.editor.setTool('select')
    if (sticky) this.editor.beginTextEdit(id)
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY })
    }
    // A foreign contact (palm, second finger) must not drive the session.
    if (
      this.session.kind !== 'none' &&
      this.session.kind !== 'pinch' &&
      this.sessionPointerId !== null &&
      e.pointerId !== this.sessionPointerId
    ) {
      return
    }
    if (this.session.kind === 'pinch') {
      const pts = [...this.activePointers.values()]
      if (pts.length < 2) return
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      this.camera.panBy(mid.x - this.session.lastMid.x, mid.y - this.session.lastMid.y)
      if (this.session.lastDist > 0 && dist > 0) {
        this.camera.zoomAt(mid.x, mid.y, dist / this.session.lastDist)
      }
      this.session.lastMid = mid
      this.session.lastDist = dist
      this.renderer.applyCamera()
      return
    }

    const w = this.world(e)
    const dxScreen = e.offsetX - this.last.x
    const dyScreen = e.offsetY - this.last.y
    this.last = { x: e.offsetX, y: e.offsetY }

    switch (this.session.kind) {
      case 'none':
        this.updateHoverCursor(w)
        return
      case 'pan':
        this.camera.panBy(dxScreen, dyScreen)
        this.renderer.applyCamera()
        return
      case 'move': {
        let dx = w.x - this.session.startW.x
        let dy = w.y - this.session.startW.y
        if (Math.abs(dx) + Math.abs(dy) > 0) this.session.moved = true

        // Magnetic alignment: snap the moving bounds' edges/center to
        // other shapes' edges/centers. Hold Alt to move freely.
        const guides: { v: number[]; h: number[] } = { v: [], h: [] }
        const sb = this.session.startBounds
        if (sb && !e.altKey) {
          const tol = this.renderer.worldPx(6)
          const snapAxis = (
            candidates: number[],
            own: number[],
          ): { delta: number; line: number } | null => {
            let best: { delta: number; line: number } | null = null
            for (const cand of candidates) {
              for (const o of own) {
                const d = cand - o
                if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.delta))) {
                  best = { delta: d, line: cand }
                }
              }
            }
            return best
          }
          const sx = snapAxis(this.session.candX, [
            sb.x + dx,
            sb.x + dx + sb.width / 2,
            sb.x + dx + sb.width,
          ])
          const sy = snapAxis(this.session.candY, [
            sb.y + dy,
            sb.y + dy + sb.height / 2,
            sb.y + dy + sb.height,
          ])
          if (sx) {
            dx += sx.delta
            guides.v.push(sx.line)
          }
          if (sy) {
            dy += sy.delta
            guides.h.push(sy.line)
          }

          // Equal-spacing (distribution) snap on axes that didn't already
          // snap to an edge/center.
          const spacingSegs: { a: Point; b: Point }[] = []
          const proposed: Bounds = {
            x: sb.x + dx,
            y: sb.y + dy,
            width: sb.width,
            height: sb.height,
          }
          if (!sx) {
            const snap = spacingSnap(proposed, this.session.othersBounds, tol, 'x')
            if (snap) {
              dx += snap.delta
              spacingSegs.push(...snap.segments)
            }
          }
          if (!sy) {
            const snap = spacingSnap(proposed, this.session.othersBounds, tol, 'y')
            if (snap) {
              dy += snap.delta
              spacingSegs.push(...snap.segments)
            }
          }
          this.renderer.spacingGuides = spacingSegs.length ? spacingSegs : null
        } else {
          this.renderer.spacingGuides = null
        }
        this.renderer.snapGuides = guides.v.length || guides.h.length ? guides : null
        this.renderer.redrawOverlay()

        for (const [id, snap] of this.session.snapshots) {
          if (snap.type === 'connector') {
            const patch: Partial<ConnectorShape> = {}
            if (snap.startPoint)
              patch.startPoint = { x: snap.startPoint.x + dx, y: snap.startPoint.y + dy }
            if (snap.endPoint)
              patch.endPoint = { x: snap.endPoint.x + dx, y: snap.endPoint.y + dy }
            if (Object.keys(patch).length) this.editor.store.update(id, patch)
          } else {
            this.editor.store.update(id, { x: snap.x + dx, y: snap.y + dy })
          }
        }
        return
      }
      case 'resize': {
        const nb = resizeBounds(
          this.session.startBounds,
          this.session.handle,
          w,
          e.shiftKey,
        )
        const ob = this.session.startBounds
        const ow = ob.width || 1
        const oh = ob.height || 1
        for (const [id, snap] of this.session.snapshots) {
          this.editor.store.update(id, {
            x: nb.x + ((snap.x - ob.x) / ow) * nb.width,
            y: nb.y + ((snap.y - ob.y) / oh) * nb.height,
            width: Math.max(1, (snap.width / ow) * nb.width),
            height: Math.max(1, (snap.height / oh) * nb.height),
          })
        }
        return
      }
      case 'marquee': {
        this.renderer.marquee = boundsFromPoints(this.session.startW, w)
        this.renderer.redrawOverlay()
        return
      }
      case 'draw': {
        // 120 Hz pencil samples arrive coalesced; taking only the frame's
        // last one visibly flattens fast curves. offsetX is unreliable on
        // coalesced events, so map from client coordinates.
        const coalesced = e.getCoalescedEvents?.() ?? []
        if (coalesced.length > 1) {
          const rect = this.host.getBoundingClientRect()
          for (const ev of coalesced) {
            const p = this.camera.screenToWorld(
              ev.clientX - rect.left,
              ev.clientY - rect.top,
            )
            this.session.points.push(p.x, p.y)
          }
        } else {
          this.session.points.push(w.x, w.y)
        }
        this.renderer.drawPreview = {
          points: this.session.points,
          color: this.editor.styleDefaults.strokeColor,
          width: this.editor.penDefaults.width,
        }
        this.renderer.redrawOverlay()
        return
      }
      case 'create': {
        this.renderer.createPreview = {
          type: this.session.type,
          bounds: boundsFromPoints(this.session.startW, w),
          color: this.editor.styleDefaults.fillColor,
        }
        this.renderer.redrawOverlay()
        return
      }
      case 'connect': {
        const get = (id: ShapeId) => this.editor.store.get(id)
        const session = this.session
        const hover = this.topShapeAt(w, true)
        const hoverValid =
          hover && (session.reattach !== null || hover.id !== session.startId)

        // The moving endpoint: magnetic to the hovered shape's anchors.
        let live = w
        if (hoverValid) {
          const res = anchorAt(hover, w, this.anchorTol())
          live = pointOnShape(hover, res.anchor)
          this.renderer.anchorDots = {
            candidates: ANCHOR_POSITIONS.map((p) => pointOnShape(hover, p)),
            active: live,
          }
        } else {
          this.renderer.anchorDots = null
        }

        if (session.reattach) {
          this.renderer.connectPreview =
            session.reattach.end === 'start'
              ? { a: live, b: session.reattach.fixed }
              : { a: session.reattach.fixed, b: live }
        } else {
          const start = session.startId ? get(session.startId) : null
          let a = session.startW
          if (start) {
            a = isCenterAnchor(session.startAnchor)
              ? anchorPoint(start, live)
              : pointOnShape(start, session.startAnchor!)
          }
          this.renderer.connectPreview = { a, b: live }
        }
        this.renderer.redrawOverlay()
        return
      }
    }
  }

  private onPointerCancel(e: PointerEvent): void {
    this.activePointers.delete(e.pointerId)
    // iOS fires pointercancel for palm-rejected touches: a contact that
    // isn't driving the gesture must not kill a pen stroke mid-word.
    if (
      this.session.kind !== 'none' &&
      this.session.kind !== 'pinch' &&
      this.sessionPointerId !== null &&
      e.pointerId !== this.sessionPointerId
    ) {
      return
    }
    // Ink-first even here: iOS cancels a pen stroke it re-reads as a system
    // gesture (a quick double contact — crossing a t — looks like a double
    // tap). The drawn points are real; commit them instead of eating them.
    if (this.session.kind === 'draw') {
      const points = this.session.points
      this.session = { kind: 'none' }
      this.renderer.drawPreview = null
      this.renderer.redrawOverlay()
      this.finishDraw(points)
      if (this.activePointers.size === 0) this.editor.setSessionActive(false)
      return
    }
    this.cancelSession()
    if (this.activePointers.size === 0) this.editor.setSessionActive(false)
  }

  /** Abort the in-flight gesture without committing anything. */
  private cancelSession(): void {
    this.session = { kind: 'none' }
    this.renderer.marquee = null
    this.renderer.drawPreview = null
    this.renderer.connectPreview = null
    this.renderer.createPreview = null
    this.renderer.snapGuides = null
    this.renderer.spacingGuides = null
    this.renderer.anchorDots = null
    this.renderer.redrawOverlay()
  }

  private onPointerUp(e: PointerEvent): void {
    this.activePointers.delete(e.pointerId)
    if (this.session.kind === 'pinch') {
      if (this.activePointers.size < 2) this.session = { kind: 'none' }
      if (this.activePointers.size === 0) this.editor.setSessionActive(false)
      return
    }
    // Only the pointer that started the gesture may end it. A palm lifting
    // mid-stroke must neither finish the stroke nor turn a stray pan into
    // a tap-select at the pen's position.
    if (
      this.session.kind !== 'none' &&
      this.sessionPointerId !== null &&
      e.pointerId !== this.sessionPointerId
    ) {
      return
    }

    const w = this.world(e)
    const session = this.session
    this.session = { kind: 'none' }
    this.host.style.cursor = this.editor.tool === 'hand' ? 'grab' : 'default'
    if (this.renderer.snapGuides || this.renderer.spacingGuides) {
      this.renderer.snapGuides = null
      this.renderer.spacingGuides = null
      this.renderer.redrawOverlay()
    }
    this.editor.setSessionActive(false)

    switch (session.kind) {
      case 'pan': {
        // Finger tap in stylus mode: select instead of (a zero-length) pan.
        if (
          session.fingerTap &&
          Math.hypot(
            e.offsetX - session.fingerTap.x,
            e.offsetY - session.fingerTap.y,
          ) < 9
        ) {
          const hit = this.topShapeAt(w)
          if (hit) this.editor.select([hit.id])
          else this.editor.clearSelection()
        }
        return
      }
      case 'marquee': {
        const rect = boundsFromPoints(session.startW, w)
        this.renderer.marquee = null
        const get = (id: ShapeId) => this.editor.store.get(id)
        const ids = this.editor.store
          .getAll()
          .filter((s) => boundsIntersect(boundsOf(s, get), rect))
          .map((s) => s.id)
        this.editor.select(ids, session.additive)
        this.renderer.redrawOverlay()
        return
      }
      case 'move': {
        if (!session.moved && session.snapshots.size > 1) {
          const hit = this.topShapeAt(w)
          if (hit) this.editor.select([hit.id])
        }
        return
      }
      case 'draw': {
        // The pen-up position is ink too. A fast flick (crossing a t) can
        // finish before Safari delivers a single pointermove; without this
        // point the stroke would be an empty tap and vanish. A true tap
        // gets a hair of length so the round line cap renders it as a dot
        // (dotting an i) instead of a degenerate, invisible path.
        const n = session.points.length
        if (w.x === session.points[n - 2] && w.y === session.points[n - 1]) {
          session.points.push(w.x + this.renderer.worldPx(0.6), w.y)
        } else {
          session.points.push(w.x, w.y)
        }
        // Clear the preview BEFORE creating the shape: if creation ever
        // throws, ghost ink must not linger on the overlay.
        this.renderer.drawPreview = null
        this.renderer.redrawOverlay()
        // A stylus tap (no real movement) is selection intent: it ends the
        // writing burst and selects whatever is under the pen — that is how
        // stylus users grab things for moving, styling, or deleting.
        if (session.tapSelects) {
          const b = pointsBounds(session.points)
          if (Math.max(b.width, b.height) <= this.renderer.worldPx(5)) {
            this.closeInkBuffer()
            const hit = this.topShapeAt(w)
            if (hit) this.editor.select([hit.id])
            else this.editor.clearSelection()
            return
          }
        }
        this.finishDraw(session.points)
        return
      }
      case 'create': {
        this.renderer.createPreview = null
        const dragged =
          Math.hypot(w.x - session.startW.x, w.y - session.startW.y) >
          this.renderer.worldPx(4)
        if (dragged) {
          const b = boundsFromPoints(session.startW, w)
          b.width = Math.max(MIN_SIZE, b.width)
          b.height = Math.max(MIN_SIZE, b.height)
          this.createShape(session.type, b)
        } else {
          const size = InteractionController.DEFAULT_SIZES[session.type]
          this.createShape(session.type, {
            x: w.x - size.width / 2,
            y: w.y - size.height / 2,
            width: size.width,
            height: size.height,
          })
        }
        return
      }
      case 'connect': {
        this.renderer.connectPreview = null
        this.renderer.anchorDots = null
        this.finishConnect(session, w)
        return
      }
      default:
        return
    }
  }

  private finishDraw(points: number[]): void {
    if (points.length < 4) {
      this.renderer.redrawOverlay()
      // Pen-down paused the idle countdown; an aborted stroke must not
      // leave the burst open forever.
      this.restartInkTimer()
      return
    }

    // A burst is open: every stroke folds in, no questions asked. Distance
    // doesn't matter — the idle timer alone decides when the burst ends.
    if (this.inkBuffer) {
      const shape = this.editor.store.get(this.inkBuffer.id)
      if (shape?.type === 'draw') {
        this.inkBuffer.bounds = this.appendStroke(shape, points)
        this.inkBuffer.strokes++
        this.inkBuffer.loneStroke = null
        this.restartInkTimer()
        return
      }
      this.inkBuffer = null // the buffer shape was deleted/undone
    }

    // No open burst. A stroke that STARTS on existing unselected ink rejoins
    // that item (crossing a t long after writing it); this hit-test runs at
    // pen-UP, so it can never cost a stroke.
    const start = { x: points[0], y: points[1] }
    const target = this.topShapeAt(start)
    if (
      target?.type === 'draw' &&
      !this.editor.selection.has(target.id)
    ) {
      const bounds = this.appendStroke(target, points)
      this.inkBuffer = {
        id: target.id,
        strokes: 2, // at least — enough to disqualify recognition
        loneStroke: null,
        bounds,
        timer: null,
      }
      this.restartInkTimer()
      return
    }

    // Fresh burst: the stroke is its own (visible) shape immediately; the
    // idle timer will decide later whether it was really a rect/line/circle.
    const id = this.addDrawShape(points)
    const loneStroke: Point[] = []
    for (let i = 0; i < points.length; i += 2) {
      loneStroke.push({ x: points[i], y: points[i + 1] })
    }
    this.inkBuffer = {
      id,
      strokes: 1,
      loneStroke,
      bounds: pointsBounds(points),
      timer: null,
    }
    this.restartInkTimer()
  }

  /** Stop the idle countdown while a pen stroke is in flight — the burst
   *  must never be processed out from under a moving pen. */
  private pauseInkTimer(): void {
    if (this.inkBuffer?.timer) {
      clearTimeout(this.inkBuffer.timer)
      this.inkBuffer.timer = null
    }
  }

  private restartInkTimer(): void {
    if (!this.inkBuffer) return
    this.pauseInkTimer()
    this.inkBuffer.timer = setTimeout(
      () => this.closeInkBuffer(),
      InteractionController.INK_IDLE_MS,
    )
  }

  /** End the writing burst and interpret it — the single place any
   *  processing of drawn ink happens. Grouping already happened (the burst
   *  IS one shape); what remains is shape recognition for a lone stroke. */
  private closeInkBuffer(): void {
    const buf = this.inkBuffer
    if (!buf) return
    if (buf.timer) clearTimeout(buf.timer)
    this.inkBuffer = null

    // Only a lone stroke can be a shape; several strokes are handwriting.
    if (!buf.loneStroke || !this.editor.recognizeShapes) return
    const shape = this.editor.store.get(buf.id)
    if (!shape || this.editor.sessionActive || this.editor.selection.has(buf.id)) {
      return
    }
    // Moved or resized since drawn: the user claimed the ink — keep it.
    if (
      shape.x !== buf.bounds.x ||
      shape.y !== buf.bounds.y ||
      shape.width !== buf.bounds.width ||
      shape.height !== buf.bounds.height
    ) {
      return
    }
    // Ink near other ink is handwriting context, not a diagram element: an
    // "l", a dash or an underline beside text must never become an arrow.
    const gap = Math.max(buf.bounds.width, buf.bounds.height, this.renderer.worldPx(20))
    const zone: Bounds = {
      x: buf.bounds.x - gap,
      y: buf.bounds.y - gap,
      width: buf.bounds.width + gap * 2,
      height: buf.bounds.height + gap * 2,
    }
    for (const other of this.editor.store.getAll()) {
      if (other.id === buf.id || other.type !== 'draw') continue
      if (boundsIntersect(zone, other)) return
    }
    const rec = recognizeStroke(buf.loneStroke, this.renderer.worldPx(1))
    if (!rec) return
    // Remove the ink BEFORE materializing: a recognized line hit-tests its
    // endpoints for shapes to connect, and must not find its own ink there.
    this.editor.store.removeMany([buf.id])
    this.materializeStroke(rec)
  }

  /** Create a freehand shape from one world-space stroke; returns its id. */
  private addDrawShape(world: number[]): ShapeId {
    const id = newShapeId()
    this.editor.store.add({
      id,
      type: 'draw',
      ...normalizeStroke(world),
      z: this.editor.store.topZ() + 1,
      fillColor: this.editor.styleDefaults.strokeColor,
      fillOpacity: 0,
      strokeColor: this.editor.styleDefaults.strokeColor,
      strokeOpacity: this.editor.styleDefaults.strokeOpacity,
      strokeWidth: this.editor.penDefaults.width,
      dash: this.editor.penDefaults.dash,
    })
    return id
  }

  /** Fold another stroke into an existing freehand shape, separated by a
   *  pen-lift marker, and renormalize to the grown bounds (returned). */
  private appendStroke(shape: DrawShape, world: number[]): Bounds {
    const combined = denormalizedPoints(shape)
    combined.push(STROKE_BREAK, STROKE_BREAK)
    for (let i = 0; i < world.length; i++) combined.push(world[i])
    const packed = normalizeStroke(combined)
    this.editor.store.update(shape.id, packed)
    return { x: packed.x, y: packed.y, width: packed.width, height: packed.height }
  }

  /** Replace a recognized pen stroke with the real shape it resembles.
   *  The pen tool stays active so sketching can continue. */
  private materializeStroke(rec: NonNullable<RecognizedStroke>): void {
    const sd = this.editor.styleDefaults
    const id = newShapeId()
    if (rec.kind === 'line') {
      const startShape = this.topShapeAt(rec.a, true)
      let endShape = this.topShapeAt(rec.b, true)
      if (endShape && startShape && endShape.id === startShape.id) endShape = null
      // Sketched strokes are imprecise: pin only when the stroke ended on
      // a magnetic anchor spot, otherwise float so the arrow routes
      // cleanly edge-to-edge.
      const startHit = startShape
        ? anchorAt(startShape, rec.a, this.anchorTol())
        : null
      const endHit = endShape ? anchorAt(endShape, rec.b, this.anchorTol()) : null
      this.editor.store.add({
        id,
        type: 'connector',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        z: this.editor.store.topZ() + 1,
        fillColor: sd.strokeColor,
        fillOpacity: 0,
        strokeColor: sd.strokeColor,
        strokeOpacity: sd.strokeOpacity,
        strokeWidth: 3,
        startId: startShape?.id ?? null,
        endId: endShape?.id ?? null,
        startPoint: startShape ? null : rec.a,
        endPoint: endShape ? null : rec.b,
        startAnchor: startHit?.snapped ? startHit.anchor : null,
        endAnchor: endHit?.snapped ? endHit.anchor : null,
        route: 'straight',
        dash: 'solid',
        startHead: 'none',
        // A stroke that touches a shape reads as "connect these".
        endHead: startShape || endShape ? 'arrow' : 'none',
      })
    } else {
      // Guard against invisible defaults (0% fill + 0px border): a
      // recognized shape must be visible or it reads as a lost stroke.
      const invisible =
        sd.fillOpacity < 0.05 && (sd.strokeWidth === 0 || sd.strokeOpacity < 0.05)
      this.editor.store.add({
        id,
        type: rec.kind,
        x: rec.bounds.x,
        y: rec.bounds.y,
        width: rec.bounds.width,
        height: rec.bounds.height,
        z: this.editor.store.topZ() + 1,
        ...sd,
        ...(invisible ? { strokeWidth: 2, strokeOpacity: 1 } : null),
        text: '',
        ...this.editor.textDefaults,
      } as Shape)
    }
    // No auto-select: conversion happens on a timer now, and yanking the
    // selection (plus its style popup) mid-writing reads as flicker.
  }

  private finishConnect(
    session: {
      startId: ShapeId | null
      startW: Point
      startAnchor: Point | null
      reattach: { id: ShapeId; end: 'start' | 'end'; fixed: Point } | null
    },
    w: Point,
  ): void {
    const target = this.topShapeAt(w, true)
    const endAnchor = target ? anchorAt(target, w, this.anchorTol()).anchor : null

    if (session.reattach) {
      const { id, end } = session.reattach
      const patch =
        end === 'start'
          ? {
              startId: target?.id ?? null,
              startPoint: target ? null : w,
              startAnchor: target ? endAnchor : null,
            }
          : {
              endId: target?.id ?? null,
              endPoint: target ? null : w,
              endAnchor: target ? endAnchor : null,
            }
      this.editor.store.update(id, patch)
      this.renderer.redrawOverlay()
      return
    }

    const endId = target && target.id !== session.startId ? target.id : null
    const dragged =
      Math.hypot(w.x - session.startW.x, w.y - session.startW.y) >
      this.renderer.worldPx(8)
    if (!endId && !dragged) {
      this.renderer.redrawOverlay()
      return
    }
    const id = newShapeId()
    this.editor.store.add({
      id,
      type: 'connector',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      z: this.editor.store.topZ() + 1,
      fillColor: 0x475569,
      fillOpacity: 0,
      strokeColor: 0x475569,
      strokeOpacity: 1,
      strokeWidth: 3,
      startId: session.startId,
      endId,
      startPoint: session.startId ? null : session.startW,
      endPoint: endId ? null : w,
      startAnchor: session.startAnchor,
      endAnchor: endId ? endAnchor : null,
      route: 'straight',
      dash: 'solid',
      startHead: 'none',
      endHead: 'arrow',
    })
    this.editor.select([id])
    this.editor.setTool('select')
  }

  private onDoubleClick(e: MouseEvent): void {
    // Two quick pen contacts while writing (crossing a t over a shape)
    // synthesize a dblclick; mid-burst that is ink, never "edit text".
    if (this.inkBuffer) return
    if (this.editor.tool !== 'select') return
    const hit = this.topShapeAt(this.world(e))
    if (hit && canHaveText(hit)) {
      this.editor.select([hit.id])
      this.editor.beginTextEdit(hit.id)
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      this.camera.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.01))
    } else {
      this.camera.panBy(-e.deltaX, -e.deltaY)
    }
    this.renderer.applyCamera()
  }

  private updateHoverCursor(w: Point): void {
    let cursor = 'default'
    const tool = this.editor.tool
    if (tool !== 'select' && (this.arrowShapeId || this.renderer.arrowHandles)) {
      this.arrowShapeId = null
      this.renderer.arrowHandles = null
      this.renderer.redrawOverlay()
    }
    if (tool === 'hand') cursor = 'grab'
    else if (tool !== 'select') cursor = 'crosshair'
    else {
      const hit = this.topShapeAt(w)
      if (this.arrowHandleHit(w)) cursor = 'crosshair'
      else if (this.connectorEndpointAt(w)) cursor = 'crosshair'
      else {
        const handle = this.handleAt(w)
        if (handle) cursor = HANDLE_CURSORS[handle]
        else if (hit) cursor = 'move'
      }
      this.updateArrowHandles(w, hit)
    }
    this.host.style.cursor = cursor
    this.updateHoverAnchorDots(w)
  }

  /** Show/refresh drag-out arrow handles while hovering a shape. */
  private updateArrowHandles(w: Point, hit: Shape | null): void {
    let shape = hit && hit.type !== 'connector' ? hit : null
    // Keep the handles alive while the pointer travels to a dot that
    // floats outside the shape itself.
    if (!shape && this.arrowShapeId) {
      const prev = this.editor.store.get(this.arrowShapeId)
      const reach = this.renderer.worldPx(14)
      if (
        prev &&
        prev.type !== 'connector' &&
        this.renderer.arrowHandlePositions(prev).some(
          (h) => Math.hypot(w.x - h.world.x, w.y - h.world.y) <= reach,
        )
      ) {
        shape = prev
      }
    }

    if (shape) {
      const handles = this.renderer.arrowHandlePositions(shape)
      const grab = this.renderer.worldPx(9)
      const near = handles.find(
        (h) => Math.hypot(w.x - h.world.x, w.y - h.world.y) <= grab,
      )
      const prev = this.renderer.arrowHandles
      const changed =
        !prev ||
        prev.shapeId !== shape.id ||
        prev.active?.x !== near?.anchor.x ||
        prev.active?.y !== near?.anchor.y
      this.arrowShapeId = shape.id
      this.renderer.arrowHandles = {
        shapeId: shape.id,
        active: near?.anchor ?? null,
      }
      if (changed) this.renderer.redrawOverlay()
    } else if (this.arrowShapeId || this.renderer.arrowHandles) {
      this.arrowShapeId = null
      this.renderer.arrowHandles = null
      this.renderer.redrawOverlay()
    }
  }

  private updateHoverAnchorDots(w: Point): void {
    // Preview the anchor spots while the arrow tool hovers a shape.
    if (this.editor.tool === 'connector') {
      const hover = this.topShapeAt(w, true)
      const next = hover
        ? {
            candidates: ANCHOR_POSITIONS.map((p) => pointOnShape(hover, p)),
            active: (() => {
              const res = anchorAt(hover, w, this.anchorTol())
              return res.snapped ? pointOnShape(hover, res.anchor) : null
            })(),
          }
        : null
      if (next || this.renderer.anchorDots) {
        this.renderer.anchorDots = next
        this.renderer.redrawOverlay()
      }
    } else if (this.renderer.anchorDots) {
      this.renderer.anchorDots = null
      this.renderer.redrawOverlay()
    }
  }

  // ---- keyboard ----------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)
      return

    if (e.code === 'Space') {
      this.spaceHeld = e.type === 'keydown'
      if (e.type === 'keyup' && this.session.kind !== 'pan') {
        this.host.style.cursor = 'default'
      }
      return
    }
    if (e.type !== 'keydown') return

    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase()
      if (key === 'z') {
        e.preventDefault()
        if (e.shiftKey) this.editor.redo()
        else this.editor.undo()
      } else if (key === 'y') {
        e.preventDefault()
        this.editor.redo()
      } else if (key === 'd') {
        e.preventDefault()
        this.editor.duplicateSelection()
      } else if (key === 'a') {
        e.preventDefault()
        this.editor.selectAll()
      } else if (key === '0') {
        e.preventDefault()
        this.renderer.resetZoom()
      }
      return
    }

    if (e.key.startsWith('Arrow') && this.editor.selection.size > 0) {
      e.preventDefault()
      const step = e.shiftKey ? 16 : 1
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      this.editor.translateSelection(dx, dy)
      return
    }

    if (e.key === ']' || e.key === '}') {
      if (e.shiftKey) this.editor.bringToFront()
      else this.editor.bringForward()
      return
    }
    if (e.key === '[' || e.key === '{') {
      if (e.shiftKey) this.editor.sendToBack()
      else this.editor.sendBackward()
      return
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.editor.deleteSelection()
      return
    }
    if (e.key === 'Escape') {
      this.editor.clearSelection()
      return
    }
    const tool = TOOL_KEYS[e.key.toLowerCase()]
    if (tool) this.editor.setTool(tool)
  }
}

/** Axis-aligned bounds of a flat [x,y,...] world stroke, skipping the NaN
 *  pairs that mark pen-lifts between sub-strokes. Width/height floor at 1 so
 *  normalization never divides by zero. */
export function pointsBounds(pts: number[]): Bounds {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = 0; i < pts.length; i += 2) {
    if (Number.isNaN(pts[i])) continue
    x0 = Math.min(x0, pts[i])
    x1 = Math.max(x1, pts[i])
    y0 = Math.min(y0, pts[i + 1])
    y1 = Math.max(y1, pts[i + 1])
  }
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) }
}

/** Pack a world-space stroke (possibly multi-part, with STROKE_BREAK markers)
 *  into a DrawShape's bounds plus 0..1 normalized points. */
export function normalizeStroke(
  world: number[],
): Pick<DrawShape, 'x' | 'y' | 'width' | 'height' | 'points'> {
  const b = pointsBounds(world)
  const points: number[] = []
  for (let i = 0; i < world.length; i += 2) {
    if (Number.isNaN(world[i])) {
      points.push(STROKE_BREAK, STROKE_BREAK)
      continue
    }
    points.push((world[i] - b.x) / b.width, (world[i + 1] - b.y) / b.height)
  }
  return { x: b.x, y: b.y, width: b.width, height: b.height, points }
}

const NAN_TOKEN = ' NaN'

/** Deep-copy a shape. Prefers structuredClone (Safari 15.4+); the JSON
 *  fallback for older iPads must round-trip the NaN pen-lift markers in
 *  freehand points, which plain JSON would flatten to null. */
export function cloneShape(s: Shape): Shape {
  if (typeof structuredClone === 'function') return structuredClone(s)
  return JSON.parse(
    JSON.stringify(s, (_k, v) =>
      typeof v === 'number' && Number.isNaN(v) ? NAN_TOKEN : v,
    ),
    (_k, v) => (v === NAN_TOKEN ? NaN : v),
  ) as Shape
}

function boundsFromPoints(a: Point, b: Point): Bounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

/** Equal-spacing snap: if placing the moving bounds `mb` next to (or
 *  between) two other shapes would repeat an existing gap, return the
 *  correction plus the gap segments to visualize. */
function spacingSnap(
  mb: Bounds,
  others: Bounds[],
  tol: number,
  axis: 'x' | 'y',
): { delta: number; segments: { a: Point; b: Point }[] } | null {
  const pos = axis
  const size: 'width' | 'height' = axis === 'x' ? 'width' : 'height'
  const cpos: 'x' | 'y' = axis === 'x' ? 'y' : 'x'
  const csize: 'width' | 'height' = axis === 'x' ? 'height' : 'width'

  // Only shapes that overlap the moving bounds on the cross axis count
  // as "in the same row/column".
  const lane = others.filter(
    (o) => o[cpos] < mb[cpos] + mb[csize] && o[cpos] + o[csize] > mb[cpos],
  )
  const sorted = [...lane].sort((p, q) => p[pos] - q[pos])
  const crossAt = mb[cpos] + mb[csize] / 2
  const seg = (from: number, to: number): { a: Point; b: Point } =>
    axis === 'x'
      ? { a: { x: from, y: crossAt }, b: { x: to, y: crossAt } }
      : { a: { x: crossAt, y: from }, b: { x: crossAt, y: to } }

  let best: { delta: number; segments: { a: Point; b: Point }[] } | null = null
  const consider = (cand: number, segments: () => { a: Point; b: Point }[]) => {
    const d = cand - mb[pos]
    if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.delta))) {
      best = { delta: d, segments: segments() }
    }
  }

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]
      const b = sorted[j]
      const aEnd = a[pos] + a[size]
      const bEnd = b[pos] + b[size]
      const gap = b[pos] - aEnd
      if (gap < 0) continue
      // Moving shape after b, repeating the a↔b gap
      consider(bEnd + gap, () => [seg(aEnd, b[pos]), seg(bEnd, bEnd + gap)])
      // Moving shape before a, repeating the a↔b gap
      consider(a[pos] - gap - mb[size], () => [
        seg(a[pos] - gap, a[pos]),
        seg(aEnd, b[pos]),
      ])
      // Moving shape centered between a and b with equal gaps
      const inner = gap - mb[size]
      if (inner >= 0) {
        const half = inner / 2
        consider(aEnd + half, () => [
          seg(aEnd, aEnd + half),
          seg(aEnd + half + mb[size], b[pos]),
        ])
      }
    }
  }
  return best
}

function resizeBounds(
  ob: Bounds,
  handle: HandleId,
  w: Point,
  keepRatio = false,
): Bounds {
  let { x, y, width, height } = ob
  const right = ob.x + ob.width
  const bottom = ob.y + ob.height
  if (handle.includes('w')) {
    x = Math.min(w.x, right - MIN_SIZE)
    width = right - x
  }
  if (handle.includes('e')) width = Math.max(MIN_SIZE, w.x - ob.x)
  if (handle.includes('n')) {
    y = Math.min(w.y, bottom - MIN_SIZE)
    height = bottom - y
  }
  if (handle.includes('s')) height = Math.max(MIN_SIZE, w.y - ob.y)

  // Shift on a corner handle locks the original aspect ratio; the
  // dimension pulled furthest wins.
  if (keepRatio && handle.length === 2 && ob.width > 0 && ob.height > 0) {
    const scale = Math.max(width / ob.width, height / ob.height)
    width = ob.width * scale
    height = ob.height * scale
    if (handle.includes('w')) x = right - width
    if (handle.includes('n')) y = bottom - height
  }
  return { x, y, width, height }
}
