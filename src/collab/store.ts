import * as Y from 'yjs'
import type { Shape, ShapeId } from '../scene/types'

/** Fill in style fields for shapes saved before fill/border styling
 *  existed (they carried a single legacy `color`). Each field defaults
 *  independently, so a shape that has been partially patched (e.g. only
 *  fillColor changed) still resolves every field. */
function normalizeShape(raw: Record<string, unknown>): Shape {
  const s = raw as Record<string, unknown> & Shape
  // Boards written before the shape library stored rectangles and
  // ellipses as their own types; they are geo kinds now. The stored
  // type field is left untouched — reads normalize, patches never
  // rewrite it.
  if ((s.type as string) === 'rect' || (s.type as string) === 'ellipse') {
    ;(s as Record<string, unknown>).geo = s.type
    ;(s as Record<string, unknown>).type = 'geo'
  }
  const legacy = (raw.color as number) ?? 0xfbbf24
  const defaults: Record<string, [number, number, number, number, number]> = {
    // [fillColor, fillOpacity, strokeColor, strokeOpacity, strokeWidth]
    sticky: [legacy, 1, 0x000000, 0.08, 1],
    geo: [legacy, 0.15, legacy, 1, 2],
    draw: [legacy, 0, legacy, 1, 4],
    connector: [legacy, 0, legacy, 1, 3],
    image: [0xffffff, 0, 0x475569, 1, 0],
  }
  const d = defaults[s.type] ?? defaults.geo
  s.fillColor ??= d[0]
  s.fillOpacity ??= d[1]
  s.strokeColor ??= d[2]
  s.strokeOpacity ??= d[3]
  s.strokeWidth ??= d[4]
  if (s.type === 'sticky' || s.type === 'geo') {
    s.fontSize ??= 16
    s.bold ??= false
    s.textAlign ??= 'center'
    s.textVAlign ??= 'middle'
  }
  if (s.type === 'geo') {
    ;(s as { geo?: string }).geo ??= 'rect'
  }
  if (s.type === 'connector') {
    // Pre-waypoint bends (single perpendicular offsets at fixed spots)
    // become equivalent via-points.
    const legacy = s as {
      curvature?: number | null
      bendQ1?: number | null
      bendQ3?: number | null
      waypoints?: { u: number; v: number }[] | null
    }
    if (legacy.waypoints == null && legacy.curvature != null) {
      const ways: { u: number; v: number }[] = []
      if (legacy.bendQ1 != null) ways.push({ u: 0.25, v: legacy.bendQ1 })
      ways.push({ u: 0.5, v: legacy.curvature })
      if (legacy.bendQ3 != null) ways.push({ u: 0.75, v: legacy.bendQ3 })
      legacy.waypoints = ways
    }
    s.route ??= 'straight'
    s.dash ??= 'solid'
    s.startHead ??= 'none'
    s.endHead ??= 'arrow'
    s.text ??= ''
    s.fontSize ??= 14
    s.bold ??= false
  }
  return s
}

/**
 * The board document. All shape state lives in a Y.Doc so every mutation
 * is collaboration-ready from day one: to go multiplayer, attach a
 * provider (e.g. y-websocket) to `doc` — no data-model changes needed.
 */
export class BoardStore {
  readonly doc = new Y.Doc()
  readonly shapes = this.doc.getMap<Y.Map<unknown>>('shapes')

  subscribe(fn: () => void): () => void {
    const observer = () => fn()
    this.shapes.observeDeep(observer)
    return () => this.shapes.unobserveDeep(observer)
  }

  /** All shapes, bottom to top (ascending z). */
  getAll(): Shape[] {
    const out: Shape[] = []
    this.shapes.forEach((yShape) => {
      out.push(normalizeShape(Object.fromEntries(yShape.entries())))
    })
    return out.sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
  }

  get(id: ShapeId): Shape | undefined {
    const yShape = this.shapes.get(id)
    if (!yShape) return undefined
    return normalizeShape(Object.fromEntries(yShape.entries()))
  }

  has(id: ShapeId): boolean {
    return this.shapes.has(id)
  }

  topZ(): number {
    let max = 0
    this.shapes.forEach((yShape) => {
      max = Math.max(max, (yShape.get('z') as number) ?? 0)
    })
    return max
  }

  add(shape: Shape): void {
    const yShape = new Y.Map<unknown>()
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(shape)) yShape.set(k, v)
      this.shapes.set(shape.id, yShape)
    })
  }

  update(id: ShapeId, patch: Partial<Shape>): void {
    const yShape = this.shapes.get(id)
    if (!yShape) return
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(patch)) yShape.set(k, v)
    })
  }

  removeMany(ids: Iterable<ShapeId>): void {
    this.doc.transact(() => {
      for (const id of ids) this.shapes.delete(id)
    })
  }
}

export function newShapeId(): ShapeId {
  // crypto.randomUUID needs Safari 15.4+; fall back for older iPads.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
