import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { BoardRenderer } from './renderer'
import { InteractionController } from './interactions'
import {
  canHaveText,
  type GeoShape,
  type StickyShape,
} from '../scene/types'
import { labelColor } from '../ui/theme'
import type { Editor } from '../editor/Editor'

interface Props {
  editor: Editor
  onRenderer?: (renderer: BoardRenderer | null) => void
}

/** WYSIWYG text editor: mirrors the rendered label's font, alignment and
 *  line-height, including vertical alignment via dynamic top padding, so
 *  entering and leaving edit mode never shifts the text. */
function TextEditorOverlay({
  shape,
  zoom,
  pos,
  onCommit,
}: {
  shape: StickyShape | GeoShape
  zoom: number
  pos: { x: number; y: number }
  onCommit: (text: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const adjustVerticalAlign = () => {
    const el = ref.current
    if (!el) return
    const pad = 12 * zoom
    const box = shape.height * zoom
    // Measure pure content height with the classic autosize trick.
    el.style.paddingTop = '0px'
    const prevHeight = el.style.height
    el.style.height = '0px'
    const content = el.scrollHeight
    el.style.height = prevHeight
    const valign = shape.textVAlign ?? 'middle'
    let top = pad
    if (valign === 'middle') top = Math.max(pad, (box - content) / 2)
    else if (valign === 'bottom') top = Math.max(pad, box - content - pad)
    el.style.paddingTop = `${top}px`
  }

  useLayoutEffect(adjustVerticalAlign)

  return (
    <textarea
      ref={ref}
      className="text-editor"
      defaultValue={shape.text}
      autoFocus
      spellCheck={false}
      style={{
        left: pos.x,
        top: pos.y,
        width: shape.width * zoom,
        height: shape.height * zoom,
        fontSize: (shape.fontSize ?? 16) * zoom,
        fontWeight: shape.bold ? 700 : 400,
        padding: 12 * zoom,
        textAlign: shape.textAlign ?? 'center',
        transform: shape.rotation ? `rotate(${shape.rotation}rad)` : undefined,
        transformOrigin: 'center center',
        color: `#${labelColor(shape.fillColor, shape.fillOpacity)
          .toString(16)
          .padStart(6, '0')}`,
      }}
      onInput={adjustVerticalAlign}
      onBlur={(e) => onCommit(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.currentTarget.blur()
        }
      }}
    />
  )
}

/**
 * Mounts the Pixi renderer and interaction controller. React renders this
 * div once; everything inside it is owned by Pixi — except the text-edit
 * textarea, which is DOM positioned over the shape being edited.
 */
export function CanvasHost({ editor, onRenderer }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [renderer, setRenderer] = useState<BoardRenderer | null>(null)
  const [, force] = useReducer((c: number) => c + 1, 0)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const r = new BoardRenderer(editor)
    const controller = new InteractionController(host, r, editor)
    let disposed = false
    let ready = false

    r.init(host).then(() => {
      if (disposed) {
        r.destroy()
        return
      }
      ready = true
      controller.attach()
      setRenderer(r)
      onRenderer?.(r)
    })

    return () => {
      disposed = true
      controller.detach()
      if (ready) r.destroy()
      setRenderer(null)
      onRenderer?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // Re-render on editor changes (text editing state) and camera moves
  // (to keep the textarea glued to its shape).
  useEffect(() => editor.subscribe(force), [editor])
  useEffect(() => (renderer ? renderer.subscribeCamera(force) : undefined), [renderer])

  const editing = editor.editingId ? editor.store.get(editor.editingId) : null
  let overlay = null
  if (editing && canHaveText(editing) && renderer) {
    overlay = (
      <TextEditorOverlay
        key={editing.id}
        shape={editing}
        zoom={renderer.camera.zoom}
        pos={renderer.camera.worldToScreen(editing.x, editing.y)}
        onCommit={(text) => editor.commitTextEdit(text)}
      />
    )
  }

  return (
    <div ref={hostRef} className="canvas-host">
      {overlay}
    </div>
  )
}
