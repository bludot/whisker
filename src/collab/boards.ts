import { newShapeId } from './store'

/** Device-local board metadata. Board CONTENT lives in one Y.Doc per board
 *  (IndexedDB); this registry only names and orders them, so it can stay in
 *  localStorage without any migration burden on the documents themselves. */
export interface BoardMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

const KEY = 'whisker-boards'

/** The pre-dashboard app stored its single board under this fixed database
 *  name. That board becomes the registry's seed entry, keeping its data. */
const LEGACY_ID = 'default'
const LEGACY_DB = 'whisker-board'

export function boardDbName(id: string): string {
  return id === LEGACY_ID ? LEGACY_DB : `whisker-board-${id}`
}

function save(boards: BoardMeta[]): void {
  localStorage.setItem(KEY, JSON.stringify(boards))
}

/** All boards, most recently updated first. Seeds the registry on first run
 *  so the legacy single board shows up as "My board". */
export function listBoards(): BoardMeta[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const boards = JSON.parse(raw) as BoardMeta[]
      return boards.sort((a, b) => b.updatedAt - a.updatedAt)
    }
  } catch {
    // Corrupt registry: reseed below rather than dead-end the app.
  }
  const now = Date.now()
  const seed: BoardMeta[] = [
    { id: LEGACY_ID, name: 'My board', createdAt: now, updatedAt: now },
  ]
  save(seed)
  return seed
}

export function getBoard(id: string): BoardMeta | undefined {
  return listBoards().find((b) => b.id === id)
}

export function createBoard(name?: string): BoardMeta {
  const boards = listBoards()
  const now = Date.now()
  const board: BoardMeta = {
    id: newShapeId(),
    name: name?.trim() || `Board ${boards.length + 1}`,
    createdAt: now,
    updatedAt: now,
  }
  save([...boards, board])
  return board
}

export function renameBoard(id: string, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  save(
    listBoards().map((b) =>
      b.id === id ? { ...b, name: trimmed, updatedAt: Date.now() } : b,
    ),
  )
}

/** Bump updatedAt (dashboard sort order + "edited …" captions). */
export function touchBoard(id: string): void {
  save(
    listBoards().map((b) =>
      b.id === id ? { ...b, updatedAt: Date.now() } : b,
    ),
  )
}

/** Remove a board and its persisted document. */
export function deleteBoard(id: string): void {
  save(listBoards().filter((b) => b.id !== id))
  // Fire-and-forget: even if the browser defers this (open connections),
  // the board is gone from the registry and unreachable.
  try {
    indexedDB.deleteDatabase(boardDbName(id))
  } catch {
    // e.g. no indexedDB in tests — metadata removal already succeeded.
  }
}
