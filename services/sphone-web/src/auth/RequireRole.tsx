import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './context.ts'
import { signInPath, type Role } from './session.ts'

/**
 * Layout-route guard: renders the nested routes only for a session with `role`; otherwise sends the
 * visitor to that role's sign-in page with `?next=` so they come back here afterwards.
 * Use as `{ element: <RequireRole role="Customer" />, children: [...] }` in routes.tsx.
 */
export function RequireRole({ role }: { role: Role }) {
  const { session } = useAuth()
  const location = useLocation()

  if (session?.role === role) return <Outlet />

  const next = encodeURIComponent(location.pathname + location.search)
  return <Navigate to={`${signInPath(role)}?next=${next}`} replace />
}
