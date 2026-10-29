// The signed-in session: sphone-api's token plus what we show about it. Kept in localStorage so a
// reload stays signed in; dropped when it expires or sphone-api answers 401.

export type Role = 'Customer' | 'Staff'

export interface Session {
  token: string
  /** ISO timestamp from sphone-api. */
  expiresAt: string
  role: Role
  /** Customers only. */
  mobileNumber?: string | null
}

const STORAGE_KEY = 'sphone.session'
export const SESSION_CHANGED_EVENT = 'sphone:session-changed'

function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Record<string, unknown>
  return typeof s.token === 'string' && typeof s.expiresAt === 'string' && (s.role === 'Customer' || s.role === 'Staff')
}

export function loadSession(): Session | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!isSession(parsed) || Date.parse(parsed.expiresAt) <= Date.now()) return null
    return parsed
  } catch {
    return null
  }
}

export function saveSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode): the session lives only in memory for this page.
  }
  window.dispatchEvent(new CustomEvent(SESSION_CHANGED_EVENT, { detail: session }))
}

/** Where each role signs in. Staff sign-in (#6) lives under the /staff branch. */
export function signInPath(role: Role): string {
  return role === 'Staff' ? '/staff/sign-in' : '/sign-in'
}

/** A `?next=` return target, allowing only same-app paths (no open redirects). */
export function safeNext(next: string | null, fallback = '/account'): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback
}
