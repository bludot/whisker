import { useEffect, useReducer } from 'react'
import type { BoardRenderer } from '../canvas/renderer'

export function ZoomControls({ renderer }: { renderer: BoardRenderer }) {
  const [, force] = useReducer((c: number) => c + 1, 0)
  useEffect(() => renderer.subscribeCamera(force), [renderer])

  return (
    <div className="zoom-controls">
      <button className="tool" title="Zoom out" onClick={() => renderer.zoomStep(1 / 1.25)}>
        −
      </button>
      <button
        className="zoom-label"
        title="Reset to 100% — Ctrl+0"
        onClick={() => renderer.resetZoom()}
      >
        {Math.round(renderer.camera.zoom * 100)}%
      </button>
      <button className="tool" title="Zoom in" onClick={() => renderer.zoomStep(1.25)}>
        +
      </button>
      <button className="tool" title="Zoom to fit" onClick={() => renderer.zoomToFit()}>
        ⛶
      </button>
    </div>
  )
}
