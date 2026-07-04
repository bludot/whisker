import { useEffect, useMemo, useState } from 'react'
import { CanvasHost } from './canvas/CanvasHost'
import { Toolbar } from './ui/Toolbar'
import { StylePopup } from './ui/StylePopup'
import { ZoomControls } from './ui/ZoomControls'
import { BoardStore } from './collab/store'
import { createPersistence } from './collab/persistence'
import { Editor } from './editor/Editor'
import type { BoardRenderer } from './canvas/renderer'

export default function App() {
  const store = useMemo(() => new BoardStore(), [])
  const editor = useMemo(() => new Editor(store), [store])
  const [renderer, setRenderer] = useState<BoardRenderer | null>(null)

  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__whisker = {
      store,
      editor,
      renderer,
    }
  }

  useEffect(() => {
    const persistence = createPersistence(store)
    return () => {
      persistence.destroy()
    }
  }, [store])

  return (
    <div className="app">
      <CanvasHost editor={editor} onRenderer={setRenderer} />
      <Toolbar editor={editor} />
      {renderer && <StylePopup editor={editor} renderer={renderer} />}
      {renderer && <ZoomControls renderer={renderer} />}
    </div>
  )
}
