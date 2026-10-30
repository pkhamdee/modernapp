import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { staffSignIn } from '../../api/auth.ts'
import { ApiError } from '../../api/client.ts'
import { useAuth } from '../../auth/context.ts'
import { safeNext } from '../../auth/session.ts'

/** Staff sign in with a username and password (accounts are provisioned per environment, not self-registered). */
export function StaffSignInPage() {
  const { session, signIn } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const next = safeNext(searchParams.get('next'), '/staff/products')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)

  if (session?.role === 'Staff') return <Navigate to={next} replace />

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!username.trim() || !password) {
      setError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน')
      return
    }
    setSigningIn(true)
    setError(null)
    try {
      signIn(await staffSignIn(username.trim(), password))
      navigate(next, { replace: true })
    } catch (e) {
      setError(
        e instanceof ApiError && e.error === 'credentials-invalid'
          ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
          : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      )
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <section className="card">
      <h1>เข้าสู่ระบบพนักงาน</h1>
      <p className="muted">สำหรับพนักงาน eShop Co. เท่านั้น</p>
      {session?.role === 'Customer' && (
        <p className="form-notice">คุณเข้าสู่ระบบในฐานะลูกค้าอยู่ การเข้าสู่ระบบพนักงานจะออกจากบัญชีลูกค้า</p>
      )}
      <form onSubmit={onSubmit} className="form" noValidate>
        <label className="form-field">
          <span>ชื่อผู้ใช้</span>
          <input
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-invalid={error !== null}
            required
          />
        </label>
        <label className="form-field">
          <span>รหัสผ่าน</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error !== null}
            aria-describedby={error ? 'staff-sign-in-error' : undefined}
            required
          />
        </label>
        {error && (
          <p id="staff-sign-in-error" className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={signingIn}>
          {signingIn ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </section>
  )
}
