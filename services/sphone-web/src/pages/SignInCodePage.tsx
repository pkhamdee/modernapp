import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { formatMobileNumber, requestSmsCode, verifySmsCode } from '../api/auth.ts'
import { ApiError } from '../api/client.ts'
import { useAuth } from '../auth/context.ts'
import { safeNext } from '../auth/session.ts'

const MESSAGES: Record<string, string> = {
  'code-invalid': 'รหัสไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่',
  'code-expired': 'รหัสหมดอายุแล้ว กรุณาขอรหัสใหม่',
  'code-locked': 'ใส่รหัสผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่',
}

/** Step 2 of Customer sign-in: enter the 6-digit SMS code. */
export function SignInCodePage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const next = safeNext(searchParams.get('next'))
  const mobileNumber = (location.state as { mobileNumber?: string } | null)?.mobileNumber
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Reloading this page loses the number (kept in navigation state only): start again.
  if (!mobileNumber) return <Navigate to={`/sign-in?next=${encodeURIComponent(next)}`} replace />

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!/^\d{6}$/.test(code)) {
      setError('กรุณากรอกรหัส 6 หลัก')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      signIn(await verifySmsCode(mobileNumber!, code))
      navigate(next, { replace: true })
    } catch (e) {
      setError((e instanceof ApiError && e.error && MESSAGES[e.error]) || 'ยืนยันรหัสไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
      setBusy(false)
    }
  }

  async function resend() {
    setBusy(true)
    setError(null)
    try {
      await requestSmsCode(mobileNumber!)
      setCode('')
      setNotice('ส่งรหัสใหม่แล้ว')
    } catch {
      setError('ส่งรหัสไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h1>กรอกรหัสยืนยัน</h1>
      <p className="muted">
        ส่งรหัส 6 หลักไปที่ {formatMobileNumber(mobileNumber)} แล้ว รหัสใช้ได้ภายใน 5 นาที
      </p>
      <form onSubmit={onSubmit} className="form" noValidate>
        <label className="form-field">
          <span>รหัส SMS</span>
          <input
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            aria-invalid={error !== null}
            aria-describedby={error ? 'code-error' : undefined}
            required
          />
        </label>
        {error && (
          <p id="code-error" className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="form-notice" role="status">
            {notice}
          </p>
        )}
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'กำลังตรวจสอบ…' : 'ยืนยัน'}
        </button>
        <button type="button" className="button button-secondary" onClick={resend} disabled={busy}>
          ขอรหัสใหม่
        </button>
      </form>
      <p>
        <Link to={`/sign-in?next=${encodeURIComponent(next)}`} className="back-link">
          ← เปลี่ยนเบอร์มือถือ
        </Link>
      </p>
    </section>
  )
}
