import { useCallback, useEffect, useState } from 'react'
import { loadSession, saveSession } from '../auth/session.ts'

// All calls go to the same origin under /api: the Gateway routes them to sphone-api in the
// cluster, and Vite proxies them to a local sphone-api in development.
const API_BASE = '/api'

export class ApiError extends Error {
  readonly status: number
  /** sphone-api's machine-readable reason (ProblemDetails `error`), e.g. "code-expired". */
  readonly error: string | undefined
  /** When a Customer refused for Eligibility may apply again (ProblemDetails `reapplyFrom`), if given. */
  readonly reapplyFrom: string | undefined
  /** Field errors from a 400 ValidationProblem, e.g. { price: ["…"] }. */
  readonly errors: Record<string, string[]>

  constructor(
    status: number,
    message: string,
    error?: string,
    reapplyFrom?: string,
    errors: Record<string, string[]> = {},
  ) {
    super(message)
    this.status = status
    this.error = error
    this.reapplyFrom = reapplyFrom
    this.errors = errors
  }
}

interface ProblemBody {
  error?: string
  title?: string
  reapplyFrom?: string | null
  errors?: Record<string, string[]>
}

// Sends the signed-in session's token. A 401 on an authenticated call means the token is no longer
// valid, so the session is dropped (RequireRole then sends the user to sign in again).
// Bodies: FormData → multipart (the browser sets the boundary); a Blob (e.g. a photo File) → sent
// raw with its own Content-Type; anything else → JSON.
async function request<T>(method: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const session = loadSession()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (session) headers.Authorization = `Bearer ${session.token}`
  let payload: BodyInit | undefined
  if (body instanceof FormData) {
    payload = body
  } else if (body instanceof Blob) {
    headers['Content-Type'] = body.type || 'application/octet-stream'
    payload = body
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const response = await fetch(`${API_BASE}${path}`, { method, headers, body: payload, signal })

  if (!response.ok) {
    if (response.status === 401 && session) saveSession(null)
    const problem = (await response.json().catch(() => null)) as ProblemBody | null
    throw new ApiError(
      response.status,
      problem?.title ?? `${method} ${path} failed with ${response.status}`,
      problem?.error,
      problem?.reapplyFrom ?? undefined,
      problem?.errors,
    )
  }
  // 202/204 may have no body (e.g. "SMS code sent"); a 202 with a body (a submitted Application) returns it.
  const text = await response.text()
  return (text === '' ? undefined : JSON.parse(text)) as T
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>('GET', path, undefined, signal)
}

/**
 * GETs a binary body (e.g. a private image) with the session's token. An <img src> can't send the
 * token, so callers turn the Blob into an object URL and revoke it when done.
 */
export async function apiGetBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const session = loadSession()
  const headers: Record<string, string> = {}
  if (session) headers.Authorization = `Bearer ${session.token}`
  const response = await fetch(`${API_BASE}${path}`, { headers, signal, cache: 'no-store' })
  if (!response.ok) {
    if (response.status === 401 && session) saveSession(null)
    throw new ApiError(response.status, `GET ${path} failed with ${response.status}`)
  }
  return response.blob()
}

/** POSTs JSON, multipart form data when `body` is a FormData, or a raw Blob/File. */
export function apiPost<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>('POST', path, body, signal)
}

export function apiPut<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>('PUT', path, body, signal)
}

export type ApiState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError | Error }
  | { status: 'success'; data: T }

/** Fetches `path` from sphone-api and re-fetches when it changes. Pass null to skip. */
export function useApi<T>(path: string | null): ApiState<T> {
  return useReloadableApi<T>(path)[0]
}

/**
 * Like useApi, plus a `reload` function that fetches `path` again (e.g. after a back-office edit).
 * The previous data stays on screen while reloading.
 */
export function useReloadableApi<T>(path: string | null): [ApiState<T>, () => void] {
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{ path: string | null; state: ApiState<T> }>({
    path: null,
    state: { status: 'loading' },
  })

  useEffect(() => {
    if (path === null) return
    const controller = new AbortController()
    apiGet<T>(path, controller.signal).then(
      (data) => setResult({ path, state: { status: 'success', data } }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        setResult({ path, state: { status: 'error', error: error instanceof Error ? error : new Error(String(error)) } })
      },
    )
    return () => controller.abort()
  }, [path, version])

  const reload = useCallback(() => setVersion((v) => v + 1), [])

  // A result for a previous path is stale: show loading until the new one arrives.
  return [result.path === path ? result.state : { status: 'loading' }, reload]
}

/** The first field error of a 400 ValidationProblem, or the problem's title, for showing under a form. */
export function problemMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback
  const first = Object.values(error.errors)[0]?.[0]
  if (first) return first
  return error.status >= 500 || error.status === 0 ? fallback : error.message
}
