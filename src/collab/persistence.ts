import { IndexeddbPersistence } from 'y-indexeddb'
import type { BoardStore } from './store'

/** Persist the board locally so it survives reloads. Because it syncs the
 *  Y.Doc itself, this composes cleanly with future network providers. */
export function createPersistence(
  store: BoardStore,
  dbName: string,
): IndexeddbPersistence {
  return new IndexeddbPersistence(dbName, store.doc)
}
