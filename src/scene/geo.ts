/**
 * The shape library: every kind the shape tool can place. One generic
 * `geo` shape type carries a `geo` kind; most kinds are normalized
 * polygons (points in 0..1 unit space, scaled to the shape's bounds),
 * a few render specially (rect, ellipse, cylinder).
 */

export type GeoKind =
  | 'rect'
  | 'ellipse'
  | 'triangle'
  | 'right-triangle'
  | 'diamond'
  | 'parallelogram'
  | 'trapezoid'
  | 'pentagon'
  | 'hexagon'
  | 'octagon'
  | 'star'
  | 'arrow-right'
  | 'arrow-left'
  | 'chevron'
  | 'plus'
  | 'speech-bubble'
  | 'semicircle'
  | 'cylinder'
  | 'pipe'

export const GEO_KINDS: { kind: GeoKind; label: string }[] = [
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'right-triangle', label: 'Right triangle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'parallelogram', label: 'Parallelogram' },
  { kind: 'trapezoid', label: 'Trapezoid' },
  { kind: 'pentagon', label: 'Pentagon' },
  { kind: 'hexagon', label: 'Hexagon' },
  { kind: 'octagon', label: 'Octagon' },
  { kind: 'star', label: 'Star' },
  { kind: 'arrow-right', label: 'Arrow right' },
  { kind: 'arrow-left', label: 'Arrow left' },
  { kind: 'chevron', label: 'Chevron' },
  { kind: 'plus', label: 'Plus' },
  { kind: 'speech-bubble', label: 'Speech bubble' },
  { kind: 'semicircle', label: 'Semicircle' },
  { kind: 'cylinder', label: 'Cylinder' },
  { kind: 'pipe', label: 'Pipe' },
]

/** Regular polygon inscribed in the unit box, first vertex at the top. */
function regular(n: number): number[] {
  const raw: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    raw.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)])
  }
  return normalizeToUnit(raw)
}

function starPoints(spikes: number, inner: number): number[] {
  const raw: [number, number][] = []
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? 0.5 : inner
    const a = -Math.PI / 2 + (i * Math.PI) / spikes
    raw.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)])
  }
  return normalizeToUnit(raw)
}

function arc(cx: number, cy: number, r: number, from: number, to: number, steps: number): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts
}

/** Stretch a point list so it exactly fills the 0..1 unit box. */
function normalizeToUnit(raw: [number, number][]): number[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of raw) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y)
    x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  const w = x1 - x0 || 1
  const h = y1 - y0 || 1
  const out: number[] = []
  for (const [x, y] of raw) out.push((x - x0) / w, (y - y0) / h)
  return out
}

const flat = (pts: [number, number][]): number[] => pts.flat()

/** Unit-space outlines. Kinds absent here (rect, ellipse, cylinder) are
 *  rendered and hit-tested specially. */
const POLYGONS: Partial<Record<GeoKind, number[]>> = {
  triangle: flat([[0.5, 0], [1, 1], [0, 1]]),
  'right-triangle': flat([[0, 0], [1, 1], [0, 1]]),
  diamond: flat([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]),
  parallelogram: flat([[0.25, 0], [1, 0], [0.75, 1], [0, 1]]),
  trapezoid: flat([[0.2, 0], [0.8, 0], [1, 1], [0, 1]]),
  pentagon: regular(5),
  hexagon: flat([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]),
  octagon: regular(8),
  star: starPoints(5, 0.21),
  'arrow-right': flat([[0, 0.28], [0.62, 0.28], [0.62, 0], [1, 0.5], [0.62, 1], [0.62, 0.72], [0, 0.72]]),
  'arrow-left': flat([[1, 0.28], [0.38, 0.28], [0.38, 0], [0, 0.5], [0.38, 1], [0.38, 0.72], [1, 0.72]]),
  chevron: flat([[0, 0], [0.72, 0], [1, 0.5], [0.72, 1], [0, 1], [0.28, 0.5]]),
  plus: flat([
    [0.33, 0], [0.67, 0], [0.67, 0.33], [1, 0.33], [1, 0.67],
    [0.67, 0.67], [0.67, 1], [0.33, 1], [0.33, 0.67], [0, 0.67], [0, 0.33], [0.33, 0.33],
  ]),
  'speech-bubble': flat([
    [0, 0], [1, 0], [1, 0.72], [0.38, 0.72], [0.18, 1], [0.2, 0.72], [0, 0.72],
  ]),
  semicircle: normalizeToUnit(arc(0.5, 1, 0.5, Math.PI, 2 * Math.PI, 20)),
}

/** The kind's outline scaled to (w, h), as flat x,y pairs — or null for
 *  the specially-rendered kinds. */
export function geoOutline(kind: GeoKind, w: number, h: number): number[] | null {
  const unit = POLYGONS[kind]
  if (!unit) return null
  const out = new Array<number>(unit.length)
  for (let i = 0; i < unit.length; i += 2) {
    out[i] = unit[i] * w
    out[i + 1] = unit[i + 1] * h
  }
  return out
}

/** Point-in-polygon (ray casting) against flat x,y pairs. */
export function pointInPolygon(px: number, py: number, pts: number[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1]
    const xj = pts[j], yj = pts[j + 1]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** Default placement size: regular-ish kinds get a square, the rest 3:2. */
export function geoDefaultSize(kind: GeoKind): { width: number; height: number } {
  switch (kind) {
    case 'diamond':
    case 'pentagon':
    case 'hexagon':
    case 'octagon':
    case 'star':
    case 'plus':
    case 'triangle':
    case 'right-triangle':
      return { width: 200, height: 200 }
    case 'semicircle':
      return { width: 240, height: 120 }
    case 'pipe':
      return { width: 280, height: 120 }
    default:
      return { width: 240, height: 160 }
  }
}
