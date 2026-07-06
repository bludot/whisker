import { useEffect, useReducer, useRef, useState } from 'react'
import { Icon } from './Icons'
import {
  createBoard,
  deleteBoard,
  listBoards,
  renameBoard,
  type BoardMeta,
} from '../collab/boards'
import {
  backendSession,
  backendUrl,
  createServerBoard,
  deleteServerBoard,
  guestModeActive,
  listServerBoards,
  renameServerBoard,
  setGuestMode,
  signOut,
  subscribeBackend,
} from '../collab/backend'

function editedCaption(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000)
  if (mins < 1) return 'Edited just now'
  if (mins < 60) return `Edited ${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Edited ${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `Edited ${days}d ago`
  return `Edited ${new Date(ts).toLocaleDateString()}`
}

function BoardCard({
  board,
  onOpen,
  onRename,
  onDelete,
}: {
  board: BoardMeta
  onOpen: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

  // Two-step delete resets if the user hesitates.
  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => setConfirmDelete(false), 3000)
    return () => clearTimeout(t)
  }, [confirmDelete])

  const commitRename = (value: string) => {
    setRenaming(false)
    if (value.trim() && value.trim() !== board.name) {
      onRename(board.id, value.trim())
    }
  }

  return (
    <div
      className="board-card"
      role="button"
      tabIndex={0}
      onClick={() => !renaming && onOpen(board.id)}
      onKeyDown={(e) => {
        if (!renaming && (e.key === 'Enter' || e.key === ' ')) onOpen(board.id)
      }}
    >
      <div className="board-card-body">
        {renaming ? (
          <input
            ref={inputRef}
            className="board-name-input"
            defaultValue={board.name}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => commitRename(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <div className="board-name">{board.name}</div>
        )}
        <div className="board-caption">{editedCaption(board.updatedAt)}</div>
      </div>
      <div className="board-card-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="popup-btn"
          title="Rename board"
          onClick={() => setRenaming(true)}
        >
          <Icon name="pen" />
        </button>
        {confirmDelete ? (
          <button
            className="popup-btn danger confirm"
            title="Really delete this board and everything on it"
            onClick={() => onDelete(board.id)}
          >
            Delete?
          </button>
        ) : (
          <button
            className="popup-btn danger"
            title="Delete board"
            onClick={() => setConfirmDelete(true)}
          >
            <Icon name="trash" />
          </button>
        )}
      </div>
    </div>
  )
}

/** Landing page: every board, newest edits first. Boards come from the
 *  configured whisker-server when signed in, or device-local storage. */
export function Dashboard({ onOpen }: { onOpen: (id: string) => void }) {
  const [, force] = useReducer((c: number) => c + 1, 0)
  useEffect(() => subscribeBackend(force), [])
  const [serverBoards, setServerBoards] = useState<BoardMeta[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const session = backendSession()
  const serverMode =
    backendUrl() !== null && session !== null && !guestModeActive()

  const reload = () => {
    if (!serverMode) {
      force()
      return
    }
    listServerBoards()
      .then((bs) => {
        setServerBoards(bs)
        setLoadError(null)
      })
      .catch((e) => setLoadError(String(e)))
  }

  useEffect(() => {
    if (serverMode) reload()
    else setServerBoards(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverMode])

  const boards = serverMode ? (serverBoards ?? []) : listBoards()

  const handleCreate = async () => {
    if (serverMode) {
      const b = await createServerBoard(`Board ${boards.length + 1}`)
      onOpen(b.id)
    } else {
      onOpen(createBoard().id)
    }
  }

  const handleRename = async (id: string, name: string) => {
    if (serverMode) await renameServerBoard(id, name)
    else renameBoard(id, name)
    reload()
  }

  const handleDelete = async (id: string) => {
    if (serverMode) await deleteServerBoard(id)
    else deleteBoard(id)
    reload()
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <span className="dashboard-logo">🐈</span>
        <h1>Whisker</h1>
        {serverMode ? (
          <div className="account">
            <span className="account-email">{session?.user.email}</span>
            <button className="login-alt" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        ) : backendUrl() !== null ? (
          // Guest on a configured server: offer the way back to login.
          <div className="account">
            <span className="account-email">Guest — boards stay on this device</span>
            <button className="login-alt" onClick={() => setGuestMode(false)}>
              Sign in
            </button>
          </div>
        ) : null}
        <button className="new-board-btn" onClick={() => void handleCreate()}>
          + New board
        </button>
      </header>
      {loadError && <div className="login-notice">{loadError}</div>}
      <div className="board-grid">
        {boards.map((b) => (
          <BoardCard
            key={b.id}
            board={b}
            onOpen={onOpen}
            onRename={(id, name) => void handleRename(id, name)}
            onDelete={(id) => void handleDelete(id)}
          />
        ))}
      </div>
    </div>
  )
}
