import { describe, expect, it } from 'vitest'
import {
  denormalizedPoints,
  hitTest,
  STROKE_BREAK,
  type DrawShape,
  type Shape,
} from './types'

const get = () => undefined

/** Two horizontal sub-strokes with a pen-lift gap between them:
 *  y=100, x 100..140, then x 160..200 — normalized into x:100 w:100 h:1. */
function multiStroke(): DrawShape {
  return {
    id: 'd1',
    type: 'draw',
    x: 100,
    y: 100,
    width: 100,
    height: 1,
    z: 1,
    fillColor: 0,
    fillOpacity: 0,
    strokeColor: 0,
    strokeOpacity: 1,
    strokeWidth: 4,
    points: [0, 0, 0.4, 0, STROKE_BREAK, STROKE_BREAK, 0.6, 0, 1, 0],
  }
}

describe('denormalizedPoints', () => {
  it('maps normalized points into world space', () => {
    const pts = denormalizedPoints(multiStroke())
    expect(pts[0]).toBe(100)
    expect(pts[1]).toBe(100)
    expect(pts[2]).toBe(140)
  })

  it('passes STROKE_BREAK markers through as NaN', () => {
    const pts = denormalizedPoints(multiStroke())
    expect(Number.isNaN(pts[4])).toBe(true)
    expect(Number.isNaN(pts[5])).toBe(true)
    // Points after the break are still mapped correctly.
    expect(pts[6]).toBe(160)
    expect(pts[8]).toBe(200)
  })
})

describe('hitTest on a multi-stroke draw shape', () => {
  const shape: Shape = multiStroke()

  it('hits the first sub-stroke', () => {
    expect(hitTest(shape, { x: 120, y: 100 }, get, 2)).toBe(true)
  })

  it('hits the second sub-stroke', () => {
    expect(hitTest(shape, { x: 180, y: 100 }, get, 2)).toBe(true)
  })

  it('misses in the pen-lift gap between sub-strokes', () => {
    // x=150 is midway in the gap (140..160); a naive segment walk would
    // connect across the break and wrongly report a hit here.
    expect(hitTest(shape, { x: 150, y: 100 }, get, 2)).toBe(false)
  })

  it('misses outside the strokes entirely', () => {
    expect(hitTest(shape, { x: 120, y: 130 }, get, 2)).toBe(false)
  })
})
