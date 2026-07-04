/** Global theme: light/dark/system preference, persisted locally. */

export type ThemePreference = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'whisker-theme'
const listeners = new Set<() => void>()

export const CANVAS_COLORS: Record<
  Theme,
  { background: number; grid: number }
> = {
  light: { background: 0xf6f5f2, grid: 0xd6d3cc },
  dark: { background: 0x16171c, grid: 0x2c2e37 },
}

export function getPreference(): ThemePreference {
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

export function effectiveTheme(): Theme {
  const p = getPreference()
  if (p !== 'system') return p
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function setPreference(p: ThemePreference): void {
  if (p === 'system') localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, p)
  applyTheme()
}

export function applyTheme(): void {
  document.documentElement.dataset.theme = effectiveTheme()
  listeners.forEach((fn) => fn())
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => {
    if (getPreference() === 'system') applyTheme()
  })

/** Dark-mode variant for each canonical (light-mode) palette color.
 *  Shapes always STORE the canonical value; rendering and swatches
 *  resolve the variant, so boards adapt to the theme non-destructively. */
const DARK_VARIANTS = new Map<number, number>([
  [0xffffff, 0x30343f], // white paper -> elevated dark card
  [0xfbbf24, 0xca8a04], // amber
  [0xf87171, 0xdc2626], // red
  [0x34d399, 0x059669], // green
  [0x60a5fa, 0x2563eb], // blue
  [0xa78bfa, 0x7c3aed], // violet
  [0xf472b6, 0xdb2777], // pink
  [0x475569, 0x9aa4b2], // slate darkens on paper, lightens on charcoal
  [0x000000, 0xffffff], // sticky's faint outline stays visible
])

/** Resolve a stored color to what should be painted in the active theme. */
export function themedColor(color: number): number {
  if (effectiveTheme() === 'light') return color
  return DARK_VARIANTS.get(color) ?? color
}

/** Readable label color for text sitting on `fillColor` at `fillOpacity`
 *  over the theme's canvas background: blends, then picks by luminance. */
export function labelColor(fillColor: number, fillOpacity: number): number {
  const bg = CANVAS_COLORS[effectiveTheme()].background
  const fill = themedColor(fillColor)
  const mix = (shift: number) => {
    const f = (fill >> shift) & 0xff
    const b = (bg >> shift) & 0xff
    return f * fillOpacity + b * (1 - fillOpacity)
  }
  const lum = 0.299 * mix(16) + 0.587 * mix(8) + 0.114 * mix(0)
  return lum > 140 ? 0x1f2937 : 0xf3f4f6
}
