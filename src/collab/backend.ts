import { GoTrueClient, type Session } from '@supabase/auth-js'
import type { BoardMeta } from './boards'

/**
 * Optional whisker-server backend. One URL configures everything: the auth
 * API is reverse-proxied by the server under /auth, boards REST lives under
 * /api, and the sync websocket under /sync. No URL = local-only mode,
 * exactly as before.
 *
 * Lives outside React (same pattern as Editor): components subscribe for
 * re-renders, everything else reads the current state directly.
 */

const URL_KEY = 'whisker-server-url'

let serverUrl: string | null = localStorage.getItem(URL_KEY)
let client: GoTrueClient | null = null
let session: Session | null = null
let ready = false // session restore attempted
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((fn) => fn())
}

export function subscribeBackend(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function backendUrl(): string | null {
  return serverUrl
}

export function backendSession(): Session | null {
  return session
}

/** True once the persisted session (if any) has been restored. */
export function backendReady(): boolean {
  return serverUrl === null || ready
}

export function setBackendUrl(url: string | null): void {
  serverUrl = url ? url.replace(/\/+$/, '') : null
  if (serverUrl) localStorage.setItem(URL_KEY, serverUrl)
  else localStorage.removeItem(URL_KEY)
  client = null
  session = null
  ready = false
  if (serverUrl) void authClient() // kicks off session restore
  notify()
}

function authClient(): GoTrueClient {
  if (client) return client
  if (!serverUrl) throw new Error('backend not configured')
  client = new GoTrueClient({
    url: `${serverUrl}/auth`,
    storageKey: 'whisker-auth',
    autoRefreshToken: true,
    persistSession: true,
  })
  client.onAuthStateChange((_event, s) => {
    session = s
    ready = true
    notify()
  })
  void client.getSession().then(({ data }) => {
    session = data.session
    ready = true
    notify()
  })
  return client
}

// Restore the session on module load if a backend is configured.
if (serverUrl) void authClient()

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await authClient().signInWithPassword({ email, password })
  return error ? error.message : null
}

/** Returns an error message, or null on success. When email confirmation is
 *  enabled server-side there is no session yet — the caller shows a hint. */
export async function signUp(email: string, password: string): Promise<string | null> {
  const { error } = await authClient().signUp({ email, password })
  return error ? error.message : null
}

export async function signOut(): Promise<void> {
  await authClient().signOut()
}

// ---- boards REST API -------------------------------------------------------

interface ServerBoard {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${serverUrl}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : null),
    },
  })
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: ${res.status}`)
  return res
}

function toMeta(b: ServerBoard): BoardMeta {
  return {
    id: b.id,
    name: b.name,
    createdAt: Date.parse(b.createdAt),
    updatedAt: Date.parse(b.updatedAt),
  }
}

export async function listServerBoards(): Promise<BoardMeta[]> {
  const res = await apiFetch('/api/boards')
  const boards = (await res.json()) as ServerBoard[]
  return boards.map(toMeta).sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function createServerBoard(name: string): Promise<BoardMeta> {
  const res = await apiFetch('/api/boards', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  return toMeta((await res.json()) as ServerBoard)
}

export async function renameServerBoard(id: string, name: string): Promise<void> {
  await apiFetch(`/api/boards/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export async function deleteServerBoard(id: string): Promise<void> {
  await apiFetch(`/api/boards/${id}`, { method: 'DELETE' })
}

/** ws(s):// endpoint for the sync provider, or null in local-only mode. */
export function syncEndpoint(): string | null {
  if (!serverUrl) return null
  return serverUrl.replace(/^http/, 'ws') + '/sync'
}
