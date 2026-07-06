import { distToSegment, type Bounds, type Point } from './types'

/**
 * Lightweight stroke recognition: turns a rough pen stroke into the shape
 * it resembles. Deliberately conservative — when unsure, return null and
 * keep the ink.
 */
export type RecognizedStroke =
  | { kind: 'rect' | 'ellipse'; bounds: Bounds }
  | { kind: 'line'; a: Point; b: Point }
  | null

/** Uniform arc-length resampling: hand strokes cluster points at slow
 *  corners, which would bias every mean-based metric below. */
function resample(pts: Point[], n: number): Point[] {
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  if (total === 0) return pts.slice(0, 1)
  const step = total / (n - 1)
  const out: Point[] = [pts[0]]
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    let prev = pts[i - 1]
    const cur = pts[i]
    let seg = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    while (acc + seg >= step && seg > 0) {
      const t = (step - acc) / seg
      const np = { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) }
      out.push(np)
      prev = np
      seg = Math.hypot(cur.x - prev.x, cur.y - prev.y)
      acc = 0
    }
    acc += seg
  }
  while (out.length < n) out.push(pts[pts.length - 1])
  return out
}

export function recognizeStroke(raw: Point[], px: number): RecognizedStroke {
  if (raw.length < 8) return null

  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of raw) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  const bounds: Bounds = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  const diag = Math.hypot(bounds.width, bounds.height)
  // Letter-sized marks are handwriting, never shapes: an "o" or the bar of
  // a "t" must stay ink. Deliberate diagram shapes are drawn much larger.
  if (diag < px * 40) return null

  const first = raw[0]
  const last = raw[raw.length - 1]
  const chord = Math.hypot(last.x - first.x, last.y - first.y)
  const pts = resample(raw, 64)

  // Straight line: every point close to the first→last segment. The high
  // size bar keeps tall letters (l, t, k strokes) out — handwriting again.
  if (chord > px * 72) {
    let maxDev = 0
    for (const p of pts) {
      maxDev = Math.max(maxDev, distToSegment(p, first, last))
    }
    if (maxDev <= Math.max(px * 10, chord * 0.05)) {
      return { kind: 'line', a: first, b: last }
    }
  }

  // Closed figures only from here on. Hand-drawn loops rarely close
  // exactly — allow a generous gap or overshoot.
  if (chord > Math.max(diag * 0.35, px * 40)) return null
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  const rx = bounds.width / 2 || 1
  const ry = bounds.height / 2 || 1

  // Score BOTH candidate fits and keep the better one — a box with
  // rounded corners can sneak under the ellipse threshold, and a wobbly
  // circle can pass the rectangle test, so ordering alone misclassifies.

  // Ellipse fit: points sit near the inscribed ellipse. Score = mean
  // radial deviation relative to its acceptance threshold.
  let devSum = 0
  for (const p of pts) {
    const r = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry)
    devSum += Math.abs(r - 1)
  }
  const ellipseScore = devSum / pts.length / 0.15

  // Rectangle fit: stroke hugs the bbox border and visits all corners.
  const corners = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]
  const cornerTol = diag * 0.22
  const visitsCorners = corners.every((c) =>
    pts.some((p) => Math.hypot(p.x - c.x, p.y - c.y) <= cornerTol),
  )
  let rectScore = Infinity
  if (visitsCorners) {
    let borderSum = 0
    for (const p of pts) {
      borderSum += Math.min(
        Math.abs(p.x - x0),
        Math.abs(p.x - x1),
        Math.abs(p.y - y0),
        Math.abs(p.y - y1),
      )
    }
    rectScore = borderSum / pts.length / (diag * 0.09)
  }

  if (ellipseScore > 1 && rectScore > 1) return null
  return rectScore <= ellipseScore
    ? { kind: 'rect', bounds }
    : { kind: 'ellipse', bounds }
}
