import type { Shape } from './types'

/**
 * The .whisker file format: a plain-JSON snapshot of a board's shapes.
 * Import always mints fresh ids (and remaps connector references), so a
 * file can be imported into any board — including the one it came from —
 * without collisions.
 */

const FORMAT = 'whisker-board'
// v2: the shape library replaced rect/ellipse with the generic geo type.
// Bump on any change older builds would silently drop, so they show
// their "made by a newer Whisker" error instead of eating shapes.
const VERSION = 2

const SHAPE_TYPES = new Set([
  'sticky',
  'geo',
  // legacy .whisker files, normalized on read:
  'rect',
  'ellipse',
  'draw',
  'connector',
  'image',
])

export function serializeBoard(shapes: Shape[]): string {
  return JSON.stringify(
    { format: FORMAT, version: VERSION, shapes },
    null,
    2,
  )
}

/** Parse a .whisker file into shapes ready to add to a board. Throws with
 *  a human-readable message on malformed input. */
export function deserializeBoard(
  text: string,
  newId: () => string,
): { shapes: Shape[]; skipped: number } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Not a valid .whisker file (not JSON).')
  }
  const file = data as { format?: string; version?: number; shapes?: unknown }
  if (file.format !== FORMAT || !Array.isArray(file.shapes)) {
    throw new Error('Not a valid .whisker file.')
  }
  if ((file.version ?? 0) > VERSION) {
    throw new Error(
      `This file was made by a newer Whisker (v${file.version}); please update.`,
    )
  }

  const all = file.shapes as Shape[]
  const candidates = all.filter(
    (s) =>
      s &&
      typeof s === 'object' &&
      SHAPE_TYPES.has(s.type) &&
      [s.x, s.y, s.width, s.height].every(Number.isFinite),
  )

  const idMap = new Map<string, string>()
  for (const s of candidates) idMap.set(s.id, newId())

  const out: Shape[] = []
  for (const s of candidates) {
    const clone: Shape = { ...s, id: idMap.get(s.id)! }
    if (clone.type === 'connector') {
      // References must stay internally consistent; a connector pointing
      // at a shape that is not part of the file is dropped.
      if (clone.startId && !idMap.has(clone.startId)) continue
      if (clone.endId && !idMap.has(clone.endId)) continue
      clone.startId = clone.startId ? idMap.get(clone.startId)! : null
      clone.endId = clone.endId ? idMap.get(clone.endId)! : null
    }
    out.push(clone)
  }
  // Anything filtered or dropped is reported, never silently eaten — a
  // partial import that looks complete is worse than an error.
  return { shapes: out, skipped: all.length - out.length }
}
