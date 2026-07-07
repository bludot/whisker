import { geoOutline, type GeoKind } from '../scene/geo'

/** Icon for a shape-library kind, generated from the same outline data
 *  the renderer draws — the picker can never drift from the canvas. */
export function GeoIcon({ kind, size = 16 }: { kind: GeoKind; size?: number }) {
  const pad = 1.5
  const s = size - pad * 2
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinejoin: 'round' as const,
  }
  let body
  if (kind === 'ellipse') {
    body = <ellipse cx={size / 2} cy={size / 2} rx={s / 2} ry={s / 2 - 1} {...common} />
  } else if (kind === 'cylinder') {
    body = (
      <g {...common}>
        <ellipse cx={size / 2} cy={pad + 2} rx={s / 2} ry={2} />
        <path
          d={`M${pad} ${pad + 2}v${s - 4}a${s / 2} 2 0 0 0 ${s} 0v-${s - 4}`}
        />
      </g>
    )
  } else if (kind === 'pipe') {
    body = (
      <g {...common}>
        <ellipse cx={size - pad - 2} cy={size / 2} rx={2} ry={s / 2 - 2} />
        <path
          d={`M${size - pad - 2} ${pad + 2}h-${s - 4}a2 ${s / 2 - 2} 0 0 0 0 ${s - 4}h${s - 4}`}
        />
      </g>
    )
  } else {
    const outline = geoOutline(kind, s, kind === 'semicircle' ? s / 2 : s)
    const yOff = kind === 'semicircle' ? size / 4 : 0
    const points = outline
      ? Array.from({ length: outline.length / 2 }, (_, i) =>
          `${(outline[i * 2] + pad).toFixed(1)},${(outline[i * 2 + 1] + pad + yOff).toFixed(1)}`,
        ).join(' ')
      : `${pad},${pad} ${size - pad},${pad} ${size - pad},${size - pad} ${pad},${size - pad}`
    body = <polygon points={points} {...common} />
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {body}
    </svg>
  )
}
