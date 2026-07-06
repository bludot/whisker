import { WebsocketProvider } from 'y-websocket'
import type { BoardStore } from './store'

/**
 * Network sync against a whisker-server instance.
 *
 * Preferred path: an explicit endpoint + token from the configured backend
 * (see backend.ts). Fallback path: manual localStorage flags, kept for
 * development against an AUTH_DISABLED server:
 *
 *   localStorage.setItem('whisker-sync-url', 'ws://localhost:8787/sync')
 *
 * Composes with y-indexeddb: local persistence keeps working offline and
 * the CRDT merges when connectivity returns.
 */
export function createSyncProvider(
  store: BoardStore,
  boardId: string,
  opts?: { url: string; token: string },
): WebsocketProvider | null {
  if (opts) {
    return new WebsocketProvider(opts.url, boardId, store.doc, {
      params: { token: opts.token },
    })
  }
  const url = localStorage.getItem('whisker-sync-url')
  if (!url) return null
  const token = localStorage.getItem('whisker-sync-token')
  return new WebsocketProvider(url, boardId, store.doc, {
    params: token ? { token } : {},
  })
}
