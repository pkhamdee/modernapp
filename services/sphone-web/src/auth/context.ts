import { createContext, useContext } from 'react'
import type { Session } from './session.ts'

export interface Auth {
  session: Session | null
  signIn: (session: Session) => void
  signOut: () => void
}

export const AuthContext = createContext<Auth | null>(null)

/** The current session and sign-in/out actions. Must be used inside <AuthProvider>. */
export function useAuth(): Auth {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>')
  return auth
}
