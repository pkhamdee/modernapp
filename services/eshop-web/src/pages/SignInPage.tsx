import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { requestSmsCode } from '../api/auth.ts'
import { ApiError } from '../api/client.ts'
import { useAuth } from '../auth/context.ts'
import { safeNext } from '../auth/session.ts'

/** Step 1 of Customer sign-in: enter the mobile number; an SMS code is sent to it. */
export function SignInPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const next = safeNext(searchParams.get('next'))
  const [mobileNumber, setMobileNumber] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  if (session?.role === 'Customer') return <Navigate to={next} replace />

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const number = mobileNumber.replace(/\D/g, '')
    if (!/^0[6-9]\d{8}$/.test(number)) {
      setError('กรุณากรอกเบอร์มือถือ 10 หลัก เช่น 0812345678')
      return
    }
    setSending(true)
    setError(null)
    try {
      await requestSmsCode(number)
      navigate(`/sign-in/code?next=${encodeURIComponent(next)}`, { state: { mobileNumber: number } })
    } catch (e) {
      setError(
        e instanceof ApiError && e.error === 'mobile-number-invalid'
          ? 'เบอร์มือถือไม่ถูกต้อง'
          : 'ส่งรหัสไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="card form-column">
      <h1>เข้าสู่ระบบ</h1>
      <p className="muted">กรอกเบอร์มือถือ เราจะส่งรหัสยืนยันทาง SMS ไม่ต้องตั้งรหัสผ่าน</p>
      <form onSubmit={onSubmit} className="form" noValidate>
        <label className="form-field">
          <span>เบอร์มือถือ</span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="0812345678"
            maxLength={12}
            value={mobileNumber}
            onChange={(e) => setMobileNumber(e.target.value)}
            aria-invalid={error !== null}
            aria-describedby={error ? 'sign-in-error' : undefined}
            required
          />
        </label>
        {error && (
          <p id="sign-in-error" className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={sending}>
          {sending ? 'กำลังส่งรหัส…' : 'ขอรหัส SMS'}
        </button>
      </form>
    </section>
  )
}
