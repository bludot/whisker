import * as Y from 'yjs'
import { newShapeId, type BoardStore } from '../collab/store'
import {
  boundsOf,
  boundsUnion,
  canHaveText,
  isResizable,
  type ConnectorStyleProps,
  type Shape,
  type ShapeId,
  type StyleProps,
  type TextStyleProps,
  type Tool,
} from '../scene/types'

export type AlignKind = 'left' | 'centerH' | 'right' | 'top' | 'middle' | 'bottom'

/**
 * Editor session state: active tool, selection, text editing, current
 * color, undo history. Lives outside React so the canvas layer can read
 * and mutate it without re-renders; React chrome subscribes for updates.
 */
export class Editor {
  readonly store: BoardStore
  readonly undoManager: Y.UndoManager

  tool: Tool = 'select'
  selection = new Set<ShapeId>()
  editingId: ShapeId | null = null
  /** Style for newly created shapes. Editable in Settings, also follows
   *  the last style edit; persisted across sessions. */
  styleDefaults: StyleProps = {
    fillColor: 0xfbbf24,
    fillOpacity: 0.15,
    strokeColor: 0xfbbf24,
    strokeOpacity: 1,
    strokeWidth: 2,
  }
  /** Text style for newly created shapes; follows the last text edit so
   *  consecutive shapes come out formatted consistently. */
  textDefaults: TextStyleProps = {
    fontSize: 16,
    bold: false,
    textAlign: 'center',
    textVAlign: 'middle',
  }
  /** Convert rough pen strokes into real shapes (rect/ellipse/line). */
  recognizeShapes = localStorage.getItem('whisker-recognize') !== 'off'
  /** Once a stylus is in use, bare fingers pan (tap still selects). */
  fingerPansWithStylus = localStorage.getItem('whisker-finger-pan') !== 'off'
  /** True while a pointer gesture (move/resize/draw/…) is in flight. */
  sessionActive = false

  private listeners = new Set<() => void>()

  constructor(store: BoardStore) {
    this.store = store
    // Local transactions have origin null (Yjs default), which UndoManager
    // tracks; provider transactions carry their own origin and are skipped.
    this.undoManager = new Y.UndoManager(store.shapes)
    store.subscribe(() => this.pruneSelection())
    try {
      const saved = localStorage.getItem('whisker-style-defaults')
      if (saved) this.styleDefaults = { ...this.styleDefaults, ...JSON.parse(saved) }
      const savedText = localStorage.getItem('whisker-text-defaults')
      if (savedText) this.textDefaults = { ...this.textDefaults, ...JSON.parse(savedText) }
    } catch {
      // Corrupt persisted defaults: fall back to the built-ins.
    }
  }

  setRecognizeShapes(on: boolean): void {
    this.recognizeShapes = on
    localStorage.setItem('whisker-recognize', on ? 'on' : 'off')
    this.notify()
  }

  setFingerPansWithStylus(on: boolean): void {
    this.fingerPansWithStylus = on
    localStorage.setItem('whisker-finger-pan', on ? 'on' : 'off')
    this.notify()
  }

  setStyleDefaults(patch: Partial<StyleProps>): void {
    this.styleDefaults = { ...this.styleDefaults, ...patch }
    localStorage.setItem(
      'whisker-style-defaults',
      JSON.stringify(this.styleDefaults),
    )
    this.notify()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  notify(): void {
    this.listeners.forEach((fn) => fn())
  }

  setTool(tool: Tool): void {
    if (this.tool === tool) return
    this.tool = tool
    this.notify()
  }

  setSessionActive(active: boolean): void {
    if (this.sessionActive === active) return
    this.sessionActive = active
    this.notify()
  }

  getSelectedShapes(): Shape[] {
    const out: Shape[] = []
    for (const id of this.selection) {
      const s = this.store.get(id)
      if (s) out.push(s)
    }
    return out
  }

  select(ids: Iterable<ShapeId>, additive = false): void {
    const next = additive ? new Set(this.selection) : new Set<ShapeId>()
    for (const id of ids) next.add(id)
    this.selection = next
    this.notify()
  }

  toggleSelected(id: ShapeId): void {
    const next = new Set(this.selection)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    this.selection = next
    this.notify()
  }

  clearSelection(): void {
    if (this.selection.size === 0) return
    this.selection = new Set()
    this.notify()
  }

  selectAll(): void {
    this.selection = new Set(this.store.getAll().map((s) => s.id))
    this.notify()
  }

  /** Delete selected shapes plus any connectors attached to them. */
  deleteSelection(): void {
    if (this.selection.size === 0) return
    const doomed = new Set(this.selection)
    for (const s of this.store.getAll()) {
      if (
        s.type === 'connector' &&
        ((s.startId && doomed.has(s.startId)) ||
          (s.endId && doomed.has(s.endId)))
      ) {
        doomed.add(s.id)
      }
    }
    this.store.removeMany(doomed)
    this.selection = new Set()
    this.notify()
  }

  duplicateSelection(): void {
    const originals = this.getSelectedShapes()
    if (originals.length === 0) return
    const OFFSET = 24
    const idMap = new Map<ShapeId, ShapeId>()
    for (const s of originals) idMap.set(s.id, newShapeId())

    let z = this.store.topZ()
    for (const s of originals) {
      const clone: Shape = {
        ...s,
        id: idMap.get(s.id)!,
        x: s.x + OFFSET,
        y: s.y + OFFSET,
        z: ++z,
      }
      if (clone.type === 'connector') {
        clone.startId = clone.startId
          ? (idMap.get(clone.startId) ?? clone.startId)
          : null
        clone.endId = clone.endId
          ? (idMap.get(clone.endId) ?? clone.endId)
          : null
        if (clone.startPoint)
          clone.startPoint = {
            x: clone.startPoint.x + OFFSET,
            y: clone.startPoint.y + OFFSET,
          }
        if (clone.endPoint)
          clone.endPoint = {
            x: clone.endPoint.x + OFFSET,
            y: clone.endPoint.y + OFFSET,
          }
      }
      this.store.add(clone)
    }
    this.selection = new Set(idMap.values())
    this.notify()
  }

  /** Apply style fields to every selected shape. */
  applyStyle(patch: Partial<StyleProps>): void {
    for (const s of this.getSelectedShapes()) {
      const p = { ...patch }
      // Picking a border color must produce a visible border: bump
      // near-invisible stroke (e.g. a sticky's faint 8% outline) to solid.
      if (p.strokeColor !== undefined && p.strokeOpacity === undefined) {
        if (s.strokeOpacity < 0.15) p.strokeOpacity = 1
        if (s.strokeWidth === 0) p.strokeWidth = 2
      }
      this.store.update(s.id, p)
    }
    this.setStyleDefaults(patch) // last-used style carries into new shapes
  }

  /** Apply text style to every selected text-capable shape. */
  applyTextStyle(patch: Partial<TextStyleProps>): void {
    for (const s of this.getSelectedShapes()) {
      if (canHaveText(s)) this.store.update(s.id, patch)
    }
    this.textDefaults = { ...this.textDefaults, ...patch }
    localStorage.setItem(
      'whisker-text-defaults',
      JSON.stringify(this.textDefaults),
    )
    this.notify()
  }

  /** Apply routing/dash/head style to every selected connector. */
  applyConnectorStyle(patch: Partial<ConnectorStyleProps>): void {
    for (const s of this.getSelectedShapes()) {
      if (s.type === 'connector') this.store.update(s.id, patch)
    }
    this.notify()
  }

  /** Move the selection by a world-space delta (arrow-key nudge etc.). */
  translateSelection(dx: number, dy: number): void {
    for (const s of this.getSelectedShapes()) {
      if (s.type === 'connector') {
        const patch: Record<string, unknown> = {}
        if (s.startPoint)
          patch.startPoint = { x: s.startPoint.x + dx, y: s.startPoint.y + dy }
        if (s.endPoint)
          patch.endPoint = { x: s.endPoint.x + dx, y: s.endPoint.y + dy }
        if (Object.keys(patch).length)
          this.store.update(s.id, patch as Partial<Shape>)
      } else {
        this.store.update(s.id, { x: s.x + dx, y: s.y + dy })
      }
    }
  }

  align(kind: AlignKind): void {
    const shapes = this.getSelectedShapes().filter(isResizable)
    if (shapes.length < 2) return
    const get = (id: ShapeId) => this.store.get(id)
    const b = boundsUnion(shapes.map((s) => boundsOf(s, get)))!
    for (const s of shapes) {
      const patch: Partial<Shape> = {}
      if (kind === 'left') patch.x = b.x
      if (kind === 'centerH') patch.x = b.x + (b.width - s.width) / 2
      if (kind === 'right') patch.x = b.x + b.width - s.width
      if (kind === 'top') patch.y = b.y
      if (kind === 'middle') patch.y = b.y + (b.height - s.height) / 2
      if (kind === 'bottom') patch.y = b.y + b.height - s.height
      this.store.update(s.id, patch)
    }
  }

  bringToFront(): void {
    const selected = this.getSelectedShapes().sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
    let z = this.store.topZ()
    for (const s of selected) this.store.update(s.id, { z: ++z })
    this.notify()
  }

  sendToBack(): void {
    const selected = this.getSelectedShapes().sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
    const all = this.store.getAll()
    let z = (all.length ? Math.min(...all.map((s) => s.z ?? 0)) : 0) - selected.length
    for (const s of selected) this.store.update(s.id, { z: z++ })
    this.notify()
  }

  bringForward(): void {
    this.stepOrder(1)
  }

  sendBackward(): void {
    this.stepOrder(-1)
  }

  /** Swap each selected shape with its nearest non-selected neighbor in
   *  z-order, so a multi-selection steps as a block. */
  private stepOrder(dir: 1 | -1): void {
    const all = this.store.getAll() // ascending z
    const indices = all
      .map((s, i) => (this.selection.has(s.id) ? i : -1))
      .filter((i) => i >= 0)
    const ordered = dir === 1 ? [...indices].reverse() : indices
    for (const i of ordered) {
      const j = i + dir
      if (j < 0 || j >= all.length) continue
      const neighbor = all[j]
      if (this.selection.has(neighbor.id)) continue
      const shape = all[i]
      const sz = shape.z ?? 0
      this.store.update(shape.id, { z: neighbor.z ?? 0 })
      this.store.update(neighbor.id, { z: sz })
      all[i] = neighbor
      all[j] = shape
    }
    this.notify()
  }

  /** Even gaps along an axis; the outermost shapes stay put. */
  distribute(axis: 'h' | 'v'): void {
    const shapes = this.getSelectedShapes().filter(isResizable)
    if (shapes.length < 3) return
    const pos = axis === 'h' ? 'x' : 'y'
    const size = axis === 'h' ? 'width' : 'height'
    const sorted = [...shapes].sort((a, b) => a[pos] - b[pos])
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const span = last[pos] + last[size] - first[pos]
    const total = sorted.reduce((acc, s) => acc + s[size], 0)
    const gap = (span - total) / (sorted.length - 1)
    let cursor = first[pos]
    for (const s of sorted) {
      this.store.update(s.id, { [pos]: cursor } as Partial<Shape>)
      cursor += s[size] + gap
    }
  }

  beginTextEdit(id: ShapeId): void {
    const s = this.store.get(id)
    if (!s || !canHaveText(s)) return
    this.editingId = id
    this.notify()
  }

  commitTextEdit(text: string): void {
    if (this.editingId) this.store.update(this.editingId, { text })
    this.editingId = null
    this.notify()
  }

  undo(): void {
    this.undoManager.undo()
  }

  redo(): void {
    this.undoManager.redo()
  }

  private pruneSelection(): void {
    let changed = false
    const next = new Set<ShapeId>()
    for (const id of this.selection) {
      if (this.store.has(id)) next.add(id)
      else changed = true
    }
    if (this.editingId && !this.store.has(this.editingId)) {
      this.editingId = null
      changed = true
    }
    if (changed) {
      this.selection = next
      this.notify()
    }
  }
}
