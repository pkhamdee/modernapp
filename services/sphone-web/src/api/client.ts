import { useEffect, useState } from 'react'

// All calls go to the same origin under /api: the Gateway routes them to sphone-api in the
// cluster, and Vite proxies them to a local sphone-api in development.
const API_BASE = '/api'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) {
    throw new ApiError(response.status, `GET ${path} failed with ${response.status}`)
  }
  return (await response.json()) as T
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
