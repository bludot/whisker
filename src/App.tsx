import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { CanvasHost } from './canvas/CanvasHost'
import { Toolbar } from './ui/Toolbar'
import { StylePopup } from './ui/StylePopup'
import { ZoomControls } from './ui/ZoomControls'
import { Dashboard } from './ui/Dashboard'
import { LoginScreen } from './ui/LoginScreen'
import { BoardStore } from './collab/store'
import { createPersistence } from './collab/persistence'
import { createSyncProvider } from './collab/sync'
import { boardDbName, getBoard, touchBoard } from './collab/boards'
import {
  backendReady,
  backendSession,
  backendUrl,
  guestModeActive,
  subscribeBackend,
  syncEndpoint,
} from './collab/backend'
import { Editor } from './editor/Editor'
import type { BoardRenderer } from './canvas/renderer'

/** Current board id from the URL hash (`#<id>`); null shows the dashboard.
 *  Hash routing keeps boards linkable and reload-safe with zero deps. */
function useBoardId(): [string | null, (id: string | null) => void] {
  const read = () => decodeURIComponent(window.location.hash.slice(1)) || null
  const [id, setId] = useState<string | null>(read)
  useEffect(() => {
    const onChange = () => setId(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const navigate = (next: string | null) => {
    window.location.hash = next ?? ''
    setId(next)
  }
  return [id, navigate]
}

function Board({ boardId, onHome }: { boardId: string; onHome: () => void }) {
  const store = useMemo(() => new BoardStore(), [boardId]) // eslint-disable-line react-hooks/exhaustive-deps
  const editor = useMemo(() => new Editor(store), [store])
  const [renderer, setRenderer] = useState<BoardRenderer | null>(null)
  const [synced, setSynced] = useState(false)

  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__whisker = {
      store,
      editor,
      renderer,
    }
  }

  useEffect(() => {
    const persistence = createPersistence(store, boardDbName(boardId))
    persistence.whenSynced.then(() => setSynced(true))
    // Keep the dashboard's "edited …" caption honest without writing
    // localStorage on every pointermove: at most one touch per few seconds.
    let lastTouch = 0
    const unsubscribe = store.subscribe(() => {
      const now = Date.now()
      if (now - lastTouch > 5000) {
        lastTouch = now
        touchBoard(boardId)
      }
    })
    return () => {
      unsubscribe()
      persistence.destroy()
    }
  }, [store, boardId])

  // Network sync, separate from persistence so a token refresh reconnects
  // the provider without touching IndexedDB. Re-renders via subscribeBackend
  // keep `token` current.
  const [, forceBackend] = useReducer((c: number) => c + 1, 0)
  useEffect(() => subscribeBackend(forceBackend), [])
  const endpoint = guestModeActive() ? null : syncEndpoint()
  const token = guestModeActive() ? undefined : backendSession()?.access_token
  useEffect(() => {
    const sync =
      endpoint && token
        ? createSyncProvider(store, boardId, { url: endpoint, token })
        : createSyncProvider(store, boardId) // legacy dev flags, or null
    return () => sync?.destroy()
  }, [store, boardId, endpoint, token])

  // Once BOTH the renderer exists and the saved shapes have loaded, land
  // the camera on the board's content instead of the world origin. Runs
  // once per board mount (Board is keyed by boardId).
  const centered = useRef(false)
  useEffect(() => {
    if (renderer && synced && !centered.current) {
      centered.current = true
      renderer.centerContent()
    }
  }, [renderer, synced])

  return (
    <div className="app">
      <CanvasHost editor={editor} onRenderer={setRenderer} />
      <Toolbar editor={editor} renderer={renderer} onHome={onHome} />
      {renderer && <StylePopup editor={editor} renderer={renderer} />}
      {renderer && <ZoomControls renderer={renderer} />}
      {/* Build marker: confirms which release a device is running. */}
      <div style={{ position: 'absolute', left: 8, bottom: 6, fontSize: 10, opacity: 0.45, pointerEvents: 'none' }}>
        v{__APP_VERSION__}
        {import.meta.env.DEV && ' (dev)'}
      </div>
    </div>
  )
}

export default function App() {
  const [boardId, navigate] = useBoardId()
  const [, force] = useReducer((c: number) => c + 1, 0)
  useEffect(() => subscribeBackend(force), [])

  const configured = backendUrl() !== null
  if (configured && !backendReady()) return null // restoring saved session
  // With a server configured, the login page is the default view; guests
  // opt out explicitly and get device-local boards.
  if (configured && !backendSession() && !guestModeActive()) {
    return <LoginScreen />
  }
  const serverMode = configured && backendSession() !== null && !guestModeActive()

  // Server mode trusts the server's ACL; local mode validates against the
  // device registry so a stale link falls back to the dashboard.
  const valid =
    boardId !== null && (serverMode || getBoard(boardId) !== undefined)

  if (!valid) return <Dashboard onOpen={(id) => navigate(id)} />
  return <Board key={boardId} boardId={boardId!} onHome={() => navigate(null)} />
}
