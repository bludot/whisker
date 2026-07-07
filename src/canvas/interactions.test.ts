import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BoardStore } from '../collab/store'
import { Editor } from '../editor/Editor'
import {
  cloneShape,
  InteractionController,
  normalizeStroke,
  pointsBounds,
} from './interactions'
import type { BoardRenderer } from './renderer'
import {
  boundsOf,
  boundsUnion,
  denormalizedPoints,
  isResizable,
  STROKE_BREAK,
  type Bounds,
  type DrawShape,
  type Point,
  type Shape,
  type ShapeId,
} from '../scene/types'

/** Minimal stand-in for BoardRenderer: identity camera, real selection
 *  bounds/handle math, inert drawing. Enough for InteractionController. */
function makeRenderer(editor: Editor): BoardRenderer {
  const renderer = {
    camera: {
      zoom: 1,
      screenToWorld: (x: number, y: number): Point => ({ x, y }),
      worldToScreen: (x: number, y: number): Point => ({ x, y }),
      panBy() {},
      zoomAt() {},
    },
    worldPx: (px: number) => px,
    redrawOverlay() {},
    applyCamera() {},
    selectionBounds(): Bounds | null {
      const get = (id: ShapeId) => editor.store.get(id)
      const resizable = editor.getSelectedShapes().filter(isResizable)
      return boundsUnion(resizable.map((s) => boundsOf(s, get)))
    },
    handlePositions(b: Bounds) {
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
    },
    arrowHandlePositions: () => [],
    rotationHandlePosition: () => null,
    bendHandlePositions: () => [],
    drawPreview: null,
    createPreview: null,
    connectPreview: null,
    anchorDots: null,
    arrowHandles: null,
    marquee: null,
    snapGuides: null,
    spacingGuides: null,
    app: { screen: { width: 1280, height: 800 } },
  }
  return renderer as unknown as BoardRenderer
}

function makeHarness() {
  const store = new BoardStore()
  const editor = new Editor(store)
  editor.setRecognizeShapes(false)
  const host = document.createElement('div')
  host.setPointerCapture = () => {}
  const controller = new InteractionController(
    host,
    makeRenderer(editor),
    editor,
  )
  // Drive the private pointer handlers directly with fake events: happy-dom
  // cannot dispatch trusted pointer events with offsetX/offsetY.
  const c = controller as unknown as {
    onPointerDown(e: unknown): void
    onPointerMove(e: unknown): void
    onPointerUp(e: unknown): void
    onPointerCancel(e: unknown): void
  }
  const ev = (x: number, y: number, pointerType: string, pointerId = 1) => ({
    offsetX: x,
    offsetY: y,
    pointerType,
    pointerId,
    button: 0,
    buttons: 1,
    shiftKey: false,
    altKey: false,
  })
  /** Zigzag pen stroke starting at (sx, sy): x spans sx..sx+24, y sy±10. */
  const stroke = (sx: number, sy: number, pointerType = 'pen') => {
    c.onPointerDown(ev(sx, sy, pointerType))
    for (let i = 1; i <= 6; i++) {
      c.onPointerMove(ev(sx + i * 4, sy + (i % 2 ? 10 : -10), pointerType))
    }
    c.onPointerUp(ev(sx + 24, sy, pointerType))
  }
  /** Dead-straight horizontal pen stroke, long/clean enough for the shape
   *  recognizer to see a line (beyond letter size): x spans sx..sx+96. */
  const straightStroke = (sx: number, sy: number) => {
    c.onPointerDown(ev(sx, sy, 'pen'))
    for (let i = 1; i <= 8; i++) c.onPointerMove(ev(sx + i * 12, sy, 'pen'))
    c.onPointerUp(ev(sx + 96, sy, 'pen'))
  }
  const drag = (from: Point, to: Point, pointerType = 'mouse') => {
    c.onPointerDown(ev(from.x, from.y, pointerType))
    const steps = 5
    for (let i = 1; i <= steps; i++) {
      c.onPointerMove(
        ev(
          from.x + ((to.x - from.x) * i) / steps,
          from.y + ((to.y - from.y) * i) / steps,
          pointerType,
        ),
      )
    }
    c.onPointerUp(ev(to.x, to.y, pointerType))
  }
  const draws = () => store.getAll().filter((s): s is DrawShape => s.type === 'draw')
  const connectors = () => store.getAll().filter((s) => s.type === 'connector')
  return { store, editor, controller: c, stroke, straightStroke, drag, draws, connectors, ev }
}

beforeEach(() => {
  // The ink buffer closes on a real setTimeout; tests drive it explicitly.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  // Node's experimental localStorage global shadows happy-dom's working one.
  const bag = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => bag.get(k) ?? null,
    setItem: (k: string, v: string) => void bag.set(k, v),
    removeItem: (k: string) => void bag.delete(k),
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('pen stroke debounce-merge', () => {
  it('creates a single draw shape for one stroke', () => {
    const h = makeHarness()
    h.editor.setTool('pen')
    h.stroke(400, 300)
    const d = h.draws()
    expect(d).toHaveLength(1)
    expect(d[0].x).toBe(400)
    expect(d[0].width).toBe(24) // x spans 400..424
    // Normalized points stay in 0..1.
    expect(Math.max(...d[0].points)).toBeLessThanOrEqual(1)
    expect(Math.min(...d[0].points)).toBeGreaterThanOrEqual(0)
  })

  it('merges a quick nearby stroke into the same shape', () => {
    const h = makeHarness()
    h.editor.setTool('pen')
    h.stroke(400, 300)
    vi.advanceTimersByTime(200) // within the idle window
    h.stroke(432, 300)
    const d = h.draws()
    expect(d).toHaveLength(1)
    // One pen-lift marker between the two sub-strokes.
    expect(d[0].points.filter((v) => Number.isNaN(v))).toHaveLength(2)
    // Bounds grew to cover both strokes.
    expect(d[0].x).toBe(400)
    expect(d[0].x + d[0].width).toBe(456)
  })

  it('keeps strokes separate after the idle window passes', () => {
    const h = makeHarness()
    h.editor.setTool('pen')
    h.stroke(400, 300)
    vi.advanceTimersByTime(1500) // past INK_IDLE_MS: the burst closed
    // Clearly off the first stroke's ink — starting ON it would rejoin.
    h.stroke(448, 300)
    expect(h.draws()).toHaveLength(2)
  })

  it('merges even distant strokes while the burst is open', () => {
    // Time alone decides the burst: "draw whatever, as long as it falls in
    // the debounce" — distance does not split it.
    const h = makeHarness()
    h.editor.setTool('pen')
    h.stroke(400, 300)
    vi.advanceTimersByTime(200)
    h.stroke(900, 300)
    expect(h.draws()).toHaveLength(1)
  })

  it('chains: each stroke restarts the idle window', () => {
    const h = makeHarness()
    h.editor.setTool('pen')
    h.stroke(400, 300)
    vi.advanceTimersByTime(1000)
    h.stroke(432, 300)
    vi.advanceTimersByTime(1000) // 2000ms after stroke 1, 1000ms after stroke 2
    h.stroke(464, 300)
    const d = h.draws()
    expect(d).toHaveLength(1)
    expect(d[0].points.filter((v) => Number.isNaN(v))).toHaveLength(4)
  })

  it('a stylus tap ends the burst', () => {
    const h = makeHarness()
    h.editor.setTool('select')
    h.stroke(400, 300) // stylus writes
    // Tap on empty canvas: ends the burst (and clears any selection).
    h.controller.onPointerDown(h.ev(900, 700, 'pen'))
    h.controller.onPointerUp(h.ev(900, 700, 'pen'))
    h.stroke(448, 300) // quick + near (but off the ink): burst was closed by the tap
    expect(h.draws()).toHaveLength(2)
  })

  it('a stylus stroke starting on the group ink keeps writing (t-cross)', () => {
    const h = makeHarness()
    // Stylus + select tool: the tablet writing mode.
    h.editor.setTool('select')
    h.stroke(400, 300) // stylus draws on empty canvas
    const before = h.draws()[0]
    vi.advanceTimersByTime(200)
    // Next stroke STARTS on the previous ink (like crossing a t): must
    // draw and merge, not select-and-drag the word.
    h.stroke(404, 308)
    const d = h.draws()
    expect(d).toHaveLength(1)
    expect(d[0].points.filter((v) => Number.isNaN(v))).toHaveLength(2)
    expect(d[0].x).toBe(before.x) // the word did not get dragged
    expect(h.editor.selection.size).toBe(0) // and never flashed selected
  })

  it('a stylus stroke on old ink rejoins it, even after the window', () => {
    const h = makeHarness()
    h.editor.setTool('select')
    h.stroke(400, 300)
    vi.advanceTimersByTime(5000) // long pause: crossing the t much later
    h.stroke(404, 308) // starts on the ink
    const d = h.draws()
    expect(d).toHaveLength(1)
    expect(d[0].points.filter((v) => Number.isNaN(v))).toHaveLength(2)
  })

  it('a pen-tool stroke starting on old ink also rejoins it', () => {
    const h = makeHarness()
    h.editor.setTool('pen')
    h.stroke(400, 300)
    vi.advanceTimersByTime(5000)
    h.stroke(404, 308)
    const d = h.draws()
    expect(d).toHaveLength(1)
    expect(d[0].points.filter((v) => Number.isNaN(v))).toHaveLength(2)
  })

  it('a stylus tap on ink selects it instead of writing', () => {
    const h = makeHarness()
    h.editor.setTool('select')
    h.stroke(400, 300)
    const id = h.draws()[0].id
    vi.advanceTimersByTime(5000)
    // Tap: pointer down and up on the ink with no movement.
    h.controller.onPointerDown(h.ev(404, 308, 'pen'))
    h.controller.onPointerUp(h.ev(404, 308, 'pen'))
    expect([...h.editor.selection]).toEqual([id])
    expect(h.draws()).toHaveLength(1) // no dot, no merge
  })

  it('tap-selected ink can then be dragged to move', () => {
    const h = makeHarness()
    h.editor.setTool('select')
    h.stroke(400, 300)
    const before = h.draws()[0]
    vi.advanceTimersByTime(5000)
    h.controller.onPointerDown(h.ev(404, 308, 'pen'))
    h.controller.onPointerUp(h.ev(404, 308, 'pen')) // tap selects
    h.drag({ x: 404, y: 308 }, { x: 504, y: 408 }, 'pen') // now drag moves
    const after = h.draws()[0]
    expect(after.x).toBe(before.x + 100)
    expect(after.width).toBe(before.width) // moved, not resized
  })

  it('a flick too fast for any pointermove still lands as ink (t-cross)', () => {
    // iPad Safari can deliver a fast cross-stroke as bare down+up with zero
    // moves in between; the up position alone must carry the stroke.
    const h = makeHarness()
    h.editor.setTool('pen')
    h.stroke(400, 300) // the t's stem
    vi.advanceTimersByTime(200)
    h.controller.onPointerDown(h.ev(398, 296, 'pen'))
    h.controller.onPointerUp(h.ev(420, 298, 'pen')) // the flicked crossbar
    const d = h.draws()
    expect(d).toHaveLength(1) // merged into the open burst, not dropped
    expect(d[0].points.filter((v) => Number.isNaN(v))).toHaveLength(2)
  })

  it('an iOS-cancelled pen stroke keeps its ink instead of vanishing', () => {
    // Safari may reinterpret a quick double pen contact as a system gesture
    // and fire pointercancel on the in-flight stroke.
    const h = makeHarness()
    h.editor.setTool('pen')
    h.stroke(400, 300)
    vi.advanceTimersByTime(200)
    h.controller.onPointerDown(h.ev(398, 296, 'pen'))
    h.controller.onPointerMove(h.ev(410, 297, 'pen'))
    h.controller.onPointerCancel(h.ev(410, 297, 'pen'))
    const d = h.draws()
    expect(d).toHaveLength(1)
    expect(d[0].points.filter((v) => Number.isNaN(v))).toHaveLength(2)
  })

  it('a swallowed pen-up cannot deadlock the controller (t-cross)', () => {
    // Safari sometimes drops a pen-up entirely when quick double contacts
    // trip its gesture recognizer. The next pen-down (a new contact = a new
    // pointerId) must commit the orphaned stroke and draw, not be ignored.
    const h = makeHarness()
    h.editor.setTool('pen')
    h.controller.onPointerDown(h.ev(400, 300, 'pen', 1))
    h.controller.onPointerMove(h.ev(400, 320, 'pen', 1))
    // ...pen-up for pointer 1 never arrives...
    h.controller.onPointerDown(h.ev(395, 296, 'pen', 2))
    h.controller.onPointerMove(h.ev(415, 297, 'pen', 2))
    h.controller.onPointerUp(h.ev(420, 298, 'pen', 2))
    const d = h.draws()
    expect(d).toHaveLength(1) // both strokes present, merged into the burst
    expect(d[0].points.filter((v) => Number.isNaN(v))).toHaveLength(2)
  })

  it('a pen-tool tap leaves a dot (dotting an i), not nothing', () => {
    const h = makeHarness()
    h.editor.setTool('pen')
    h.controller.onPointerDown(h.ev(400, 300, 'pen'))
    h.controller.onPointerUp(h.ev(400, 300, 'pen'))
    expect(h.draws()).toHaveLength(1)
  })

  it('new strokes pick up the pen width and line style defaults', () => {
    const h = makeHarness()
    h.editor.setPenDefaults({ width: 7, dash: 'dashed' })
    h.editor.setTool('pen')
    h.stroke(400, 300)
    const d = h.draws()[0]
    expect(d.strokeWidth).toBe(7)
    expect(d.dash).toBe('dashed')
  })

  it('new boxes pick up the default border style', () => {
    const h = makeHarness()
    h.editor.setStyleDefaults({ dash: 'dotted' })
    h.editor.setShapeKind('rect')
    h.editor.setTool('shape')
    h.drag({ x: 300, y: 300 }, { x: 420, y: 380 })
    const r = h.store.getAll().find((s) => s.type === 'geo')!
    expect(r.dash).toBe('dotted')
  })

  it('never draws while the text editor is open (Scribble writes text)', () => {
    const h = makeHarness()
    h.store.add({
      id: 's1',
      type: 'sticky',
      x: 500,
      y: 500,
      width: 200,
      height: 200,
      z: 1,
      fillColor: 0xfbbf24,
      fillOpacity: 1,
      strokeColor: 0,
      strokeOpacity: 0.08,
      strokeWidth: 1,
      text: '',
      fontSize: 16,
      bold: false,
      textAlign: 'center',
      textVAlign: 'middle',
    } as Shape)
    h.editor.beginTextEdit('s1')
    h.editor.setTool('pen')
    h.stroke(400, 300) // pen contact while editing: text input, not ink
    expect(h.draws()).toHaveLength(0)
    h.editor.commitTextEdit('hello')
    h.stroke(400, 300) // editor closed: ink works again
    expect(h.draws()).toHaveLength(1)
  })

  it('deleting the group starts a fresh shape instead of reviving it', () => {
    const h = makeHarness()
    h.editor.setTool('pen')
    h.stroke(400, 300)
    h.store.removeMany(h.draws().map((s) => s.id))
    vi.advanceTimersByTime(100)
    h.stroke(432, 300)
    const d = h.draws()
    expect(d).toHaveLength(1)
    expect(d[0].points.some((v) => Number.isNaN(v))).toBe(false)
  })
})

describe('dragging a small selected shape (move vs resize)', () => {
  it('moves — not resizes — small handwriting grabbed on its ink', () => {
    const h = makeHarness()
    h.editor.setTool('pen')
    h.stroke(400, 300)
    vi.advanceTimersByTime(200)
    h.stroke(432, 300)
    const shape = h.draws()[0]
    // Bounds 400..456 × 290..310: every ink point falls inside a resize
    // handle grab zone, which used to turn every drag into a resize.
    h.editor.setTool('select')
    h.editor.select([shape.id])
    h.drag({ x: 400, y: 300 }, { x: 500, y: 380 }) // on ink, at the W handle
    const after = h.draws()[0]
    expect({ w: after.width, h: after.height }).toEqual({
      w: shape.width,
      h: shape.height,
    })
    expect(after.x).toBe(shape.x + 100)
    expect(after.y).toBe(shape.y + 80)
  })

  it('still resizes a large shape from its corner handle', () => {
    const h = makeHarness()
    h.store.add({
      id: 'r1',
      type: 'geo',
      geo: 'rect',
      x: 300,
      y: 300,
      width: 240,
      height: 160,
      z: 1,
      fillColor: 0,
      fillOpacity: 0.15,
      strokeColor: 0,
      strokeOpacity: 1,
      strokeWidth: 2,
      text: '',
      fontSize: 16,
      bold: false,
      textAlign: 'center',
      textVAlign: 'middle',
    } as Shape)
    h.editor.select(['r1'])
    h.drag({ x: 540, y: 460 }, { x: 580, y: 500 }) // SE corner handle
    const r = h.store.get('r1')!
    expect(r.width).toBe(280)
    expect(r.height).toBe(200)
    expect(r.x).toBe(300)
  })
})

describe('stroke geometry helpers', () => {
  it('pointsBounds skips pen-lift markers', () => {
    const b = pointsBounds([10, 10, 20, 20, STROKE_BREAK, STROKE_BREAK, 30, 40])
    expect(b).toEqual({ x: 10, y: 10, width: 20, height: 30 })
  })

  it('normalizeStroke round-trips through denormalizedPoints', () => {
    const world = [100, 200, 150, 260, STROKE_BREAK, STROKE_BREAK, 180, 220]
    const packed = normalizeStroke(world)
    const back = denormalizedPoints({
      type: 'draw',
      ...packed,
    } as DrawShape)
    expect(back).toHaveLength(world.length)
    for (let i = 0; i < world.length; i++) {
      if (Number.isNaN(world[i])) expect(Number.isNaN(back[i])).toBe(true)
      else expect(back[i]).toBeCloseTo(world[i], 10)
    }
  })
})

describe('cloneShape', () => {
  const merged = {
    id: 'd1',
    type: 'draw',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    z: 1,
    fillColor: 0,
    fillOpacity: 0,
    strokeColor: 0,
    strokeOpacity: 1,
    strokeWidth: 4,
    points: [0, 0, 1, 1, STROKE_BREAK, STROKE_BREAK, 0.5, 0.5],
  } as DrawShape

  it('preserves pen-lift markers (structuredClone path)', () => {
    const copy = cloneShape(merged) as DrawShape
    expect(copy).not.toBe(merged)
    expect(copy.points.filter((v) => Number.isNaN(v))).toHaveLength(2)
    expect(copy.points.filter((v) => v === null)).toHaveLength(0)
  })

  it('preserves pen-lift markers (JSON fallback for old Safari)', () => {
    vi.stubGlobal('structuredClone', undefined)
    const copy = cloneShape(merged) as DrawShape
    expect(copy).not.toBe(merged)
    expect(copy.points.filter((v) => Number.isNaN(v))).toHaveLength(2)
    expect(copy.points.filter((v) => v === null)).toHaveLength(0)
    // Ordinary values still round-trip.
    expect(copy.points[2]).toBe(1)
    expect(copy.strokeWidth).toBe(4)
  })
})

describe('palm rejection while writing', () => {
  it('a planted palm does not swallow the next pen stroke (tally marks)', () => {
    const h = makeHarness()
    h.editor.setTool('select')
    h.stroke(400, 300) // pen seen: fingers pan from here on
    vi.advanceTimersByTime(300)
    // Palm plants on the canvas (finger pan session starts)...
    h.controller.onPointerDown(h.ev(600, 500, 'touch', 99))
    // ...and the pen writes the next tally mark while the palm rests.
    h.stroke(420, 300)
    // Palm lifts afterwards.
    h.controller.onPointerUp(h.ev(600, 500, 'touch', 99))
    const d = h.draws()
    expect(d).toHaveLength(1) // both marks present, merged
    expect(d[0].points.filter((v) => Number.isNaN(v))).toHaveLength(2)
    expect(h.editor.selection.size).toBe(0) // no phantom tap-select
  })

  it('a palm lift mid-stroke does not end the pen stroke', () => {
    const h = makeHarness()
    h.editor.setTool('pen')
    h.controller.onPointerDown(h.ev(400, 300, 'pen'))
    h.controller.onPointerMove(h.ev(410, 310, 'pen'))
    // Palm lifts (its up must not finish the pen's stroke)...
    h.controller.onPointerUp(h.ev(600, 500, 'touch', 99))
    h.controller.onPointerMove(h.ev(420, 320, 'pen'))
    h.controller.onPointerUp(h.ev(430, 330, 'pen'))
    const d = h.draws()
    expect(d).toHaveLength(1)
    expect(d[0].points.length / 2).toBe(4) // down + both moves + up, one stroke
  })

  it('a palm-rejection pointercancel does not kill the pen stroke', () => {
    const h = makeHarness()
    h.editor.setTool('pen')
    h.controller.onPointerDown(h.ev(400, 300, 'pen'))
    h.controller.onPointerMove(h.ev(410, 310, 'pen'))
    // iOS palm rejection cancels the palm contact mid-stroke.
    h.controller.onPointerCancel(h.ev(600, 500, 'touch', 99))
    h.controller.onPointerMove(h.ev(420, 320, 'pen'))
    h.controller.onPointerUp(h.ev(430, 330, 'pen'))
    expect(h.draws()).toHaveLength(1) // the stroke survived
  })
})

describe('shape recognition happens only when the burst closes', () => {
  const makeRecognizingHarness = () => {
    const h = makeHarness()
    h.editor.setRecognizeShapes(true)
    h.editor.setTool('pen')
    return h
  }

  it('keeps a lone straight stroke as ink until the burst closes', () => {
    const h = makeRecognizingHarness()
    h.straightStroke(400, 300)
    // While the burst is open it is still ink...
    vi.advanceTimersByTime(1000)
    expect(h.draws()).toHaveLength(1)
    expect(h.connectors()).toHaveLength(0)
    // ...then, with no follow-up writing, the recognized line materializes.
    vi.advanceTimersByTime(400)
    expect(h.draws()).toHaveLength(0)
    expect(h.connectors()).toHaveLength(1)
  })

  it('keeps quick straight strokes as one merged ink item', () => {
    const h = makeRecognizingHarness()
    h.straightStroke(400, 300)
    vi.advanceTimersByTime(200)
    h.straightStroke(400, 320) // second line just below, same burst
    vi.advanceTimersByTime(2000)
    const d = h.draws()
    expect(d).toHaveLength(1)
    expect(d[0].points.filter((v) => Number.isNaN(v))).toHaveLength(2)
    expect(h.connectors()).toHaveLength(0) // neither stroke was converted
  })

  it('recognizes strokes from separate bursts independently', () => {
    const h = makeRecognizingHarness()
    h.straightStroke(400, 300)
    vi.advanceTimersByTime(1500) // burst 1 closed: line converts
    expect(h.connectors()).toHaveLength(1)
    h.straightStroke(400, 700)
    vi.advanceTimersByTime(1500)
    expect(h.connectors()).toHaveLength(2)
    expect(h.draws()).toHaveLength(0)
  })

  it('leaves the ink alone if the user moved it before the window closed', () => {
    const h = makeRecognizingHarness()
    h.straightStroke(400, 300)
    const ink = h.draws()[0]
    h.store.update(ink.id, { x: ink.x + 50 })
    vi.advanceTimersByTime(2000)
    expect(h.draws()).toHaveLength(1) // still ink, exactly where it was put
    expect(h.connectors()).toHaveLength(0)
  })

  it('keeps a straight stroke as ink when written near existing ink', () => {
    const h = makeRecognizingHarness()
    h.stroke(400, 300) // scribbled word (not recognizable)
    vi.advanceTimersByTime(2000) // long pause: the burst closed
    h.straightStroke(400, 330) // dash/underline right below the word
    vi.advanceTimersByTime(2000)
    // Near handwriting, the straight stroke must stay ink, not become an arrow.
    expect(h.draws()).toHaveLength(2)
    expect(h.connectors()).toHaveLength(0)
  })

  it('does not steal the selection when a lone stroke converts', () => {
    const h = makeRecognizingHarness()
    h.straightStroke(400, 300)
    vi.advanceTimersByTime(2000)
    expect(h.connectors()).toHaveLength(1)
    expect(h.editor.selection.size).toBe(0)
  })

  it('never converts a scribble', () => {
    const h = makeRecognizingHarness()
    h.stroke(400, 300) // zigzag — not recognizable
    vi.advanceTimersByTime(2000)
    expect(h.draws()).toHaveLength(1)
    expect(h.connectors()).toHaveLength(0)
  })
})

describe('deleteSelection (backs the popup trash button)', () => {
  it('removes selected shapes and their attached connectors', () => {
    const h = makeHarness()
    const base = {
      z: 1,
      fillColor: 0,
      fillOpacity: 0.15,
      strokeColor: 0,
      strokeOpacity: 1,
      strokeWidth: 2,
      text: '',
      fontSize: 16,
      bold: false,
      textAlign: 'center',
      textVAlign: 'middle',
    }
    h.store.add({ id: 'a', type: 'geo', geo: 'rect', x: 0, y: 0, width: 100, height: 100, ...base } as Shape)
    h.store.add({ id: 'b', type: 'geo', geo: 'rect', x: 300, y: 0, width: 100, height: 100, ...base } as Shape)
    h.store.add({
      id: 'c',
      type: 'connector',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      z: 2,
      fillColor: 0,
      fillOpacity: 0,
      strokeColor: 0,
      strokeOpacity: 1,
      strokeWidth: 3,
      startId: 'a',
      endId: 'b',
      startPoint: null,
      endPoint: null,
      startAnchor: null,
      endAnchor: null,
      route: 'straight',
      dash: 'solid',
      startHead: 'none',
      endHead: 'arrow',
    } as Shape)
    h.editor.select(['a'])
    h.editor.deleteSelection()
    expect(h.store.has('a')).toBe(false)
    expect(h.store.has('c')).toBe(false) // connector went with its endpoint
    expect(h.store.has('b')).toBe(true)
    expect(h.editor.selection.size).toBe(0)
  })
})
