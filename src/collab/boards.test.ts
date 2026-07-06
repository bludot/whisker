import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  boardDbName,
  createBoard,
  deleteBoard,
  getBoard,
  listBoards,
  renameBoard,
  touchBoard,
} from './boards'

beforeEach(() => {
  // Node's experimental localStorage global shadows happy-dom's working one.
  const bag = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => bag.get(k) ?? null,
    setItem: (k: string, v: string) => void bag.set(k, v),
    removeItem: (k: string) => void bag.delete(k),
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('board registry', () => {
  it('seeds the legacy board on first run, keeping its database name', () => {
    const boards = listBoards()
    expect(boards).toHaveLength(1)
    expect(boards[0].id).toBe('default')
    expect(boardDbName(boards[0].id)).toBe('whisker-board') // legacy data survives
  })

  it('creates boards with unique ids and their own databases', () => {
    const a = createBoard()
    const b = createBoard('Retro')
    expect(a.id).not.toBe(b.id)
    expect(b.name).toBe('Retro')
    expect(boardDbName(a.id)).toBe(`whisker-board-${a.id}`)
    expect(listBoards()).toHaveLength(3) // seed + 2
  })

  it('renames and refuses empty names', () => {
    const a = createBoard('Old name')
    renameBoard(a.id, '  New name  ')
    expect(getBoard(a.id)?.name).toBe('New name')
    renameBoard(a.id, '   ')
    expect(getBoard(a.id)?.name).toBe('New name')
  })

  it('deletes a board from the registry', () => {
    const a = createBoard()
    deleteBoard(a.id)
    expect(getBoard(a.id)).toBeUndefined()
    expect(listBoards().some((b) => b.id === a.id)).toBe(false)
  })

  it('sorts by most recently updated', () => {
    vi.useFakeTimers()
    const a = createBoard('A')
    vi.advanceTimersByTime(10)
    createBoard('B')
    vi.advanceTimersByTime(10)
    touchBoard(a.id)
    expect(listBoards()[0].name).toBe('A')
    vi.useRealTimers()
  })

  it('recovers from a corrupt registry', () => {
    localStorage.setItem('whisker-boards', '{not json')
    const boards = listBoards()
    expect(boards).toHaveLength(1)
    expect(boards[0].id).toBe('default')
  })
})
