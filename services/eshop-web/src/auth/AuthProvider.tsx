import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AuthContext, type Auth } from './context.ts'
import { loadSession, saveSession, SESSION_CHANGED_EVENT, type Session } from './session.ts'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession)

  useEffect(() => {
    // Follow changes made elsewhere: the API client dropping an expired token, or another tab.
    const changed = (event: Event) => setSession((event as CustomEvent<Session | null>).detail)
    const otherTab = () => setSession(loadSession())
    window.addEventListener(SESSION_CHANGED_EVENT, changed)
    window.addEventListener('storage', otherTab)
    return () => {
      window.removeEventListener(SESSION_CHANGED_EVENT, changed)
      window.removeEventListener('storage', otherTab)
    }
  }, [])

  useEffect(() => {
    if (!session) return
    // Sign out on the dot when the token expires (setTimeout caps at ~24.8 days; tokens are shorter).
    const timer = window.setTimeout(() => saveSession(null), Date.parse(session.expiresAt) - Date.now())
    return () => window.clearTimeout(timer)
  }, [session])

  const auth = useMemo<Auth>(
    () => ({
      session,
      signIn: (next) => saveSession(next),
      signOut: () => saveSession(null),
    }),
    [session],
  )

  return <AuthContext value={auth}>{children}</AuthContext>
}
