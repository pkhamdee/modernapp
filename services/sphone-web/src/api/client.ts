import { useEffect, useState } from 'react'
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

  constructor(status: number, message: string, error?: string, reapplyFrom?: string) {
    super(message)
    this.status = status
    this.error = error
    this.reapplyFrom = reapplyFrom
  }
}

interface ProblemBody {
  error?: string
  title?: string
  reapplyFrom?: string | null
}

// Sends the signed-in session's token. A 401 on an authenticated call means the token is no longer
// valid, so the session is dropped (RequireRole then sends the user to sign in again).
async function request<T>(method: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const session = loadSession()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (session) headers.Authorization = `Bearer ${session.token}`
  const isForm = body instanceof FormData
  // FormData sets its own multipart Content-Type (with the boundary).
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    if (response.status === 401 && session) saveSession(null)
    const problem = (await response.json().catch(() => null)) as ProblemBody | null
    throw new ApiError(
      response.status,
      problem?.title ?? `${method} ${path} failed with ${response.status}`,
      problem?.error,
      problem?.reapplyFrom ?? undefined,
    )
  }
  // 202/204 may have no body (e.g. "SMS code sent"); a 202 with a body (a submitted Application) returns it.
  const text = await response.text()
  return (text === '' ? undefined : JSON.parse(text)) as T
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>('GET', path, undefined, signal)
}

/** POSTs JSON, or multipart form data when `body` is a FormData. */
export function apiPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>('POST', path, body, signal)
}

export type ApiState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError | Error }
  | { status: 'success'; data: T }

/** Fetches `path` from sphone-api and re-fetches when it changes. Pass null to skip. */
export function useApi<T>(path: string | null): ApiState<T> {
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
  }, [path])

  // A result for a previous path is stale: show loading until the new one arrives.
  return result.path === path ? result.state : { status: 'loading' }
}
