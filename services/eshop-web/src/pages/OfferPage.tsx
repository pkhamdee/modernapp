import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { formatMobileNumber } from '../api/auth.ts'
import { ApiError, useReloadableApi } from '../api/client.ts'
import { acceptOffer, declineOffer, offerPaths, requestAcceptanceCode, type Offer } from '../api/offers.ts'
import { useAuth } from '../auth/context.ts'
import { Status } from '../components/Status.tsx'
import { formatBaht, formatDateTime } from '../format.ts'

const MESSAGES: Record<string, string> = {
  'code-invalid': 'รหัสไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่',
  'code-expired': 'รหัสหมดอายุแล้ว กรุณาขอรหัสใหม่',
  'code-locked': 'ใส่รหัสผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่',
  'offer-expired': 'ข้อเสนอนี้หมดอายุแล้ว',
  'offer-declined': 'คุณได้ปฏิเสธข้อเสนอนี้แล้ว',
  'offer-accepted': 'ข้อเสนอนี้ได้รับการยอมรับแล้ว',
  'active-contract': 'คุณมีสัญญาเช่าซื้อที่ยังไม่สิ้นสุดอยู่แล้ว',
}

/**
 * The Offer of an Approved Application: the locked price, Down Payment, Term, Installment and total payable.
 * The Customer accepts by confirming an SMS code (which creates the Contract) or declines. Open for 7 days.
 */
export function OfferPage() {
  const { id = '' } = useParams()
  const [offer, reload] = useReloadableApi<Offer>(offerPaths.offer(id))

  if (offer.status !== 'success') return <Status state={offer} />
  const o = offer.data

  return (
    <section className="card application form-column">
      <h1>ข้อเสนอเช่าซื้อ</h1>
      <OfferState offer={o} />
      <dl className="terms">
        <div>
          <dt>สินค้า</dt>
          <dd>{o.product.name}</dd>
        </div>
        <div>
          <dt>ราคา (ล็อกไว้ ณ วันที่สมัคร)</dt>
          <dd>{formatBaht(o.price)}</dd>
        </div>
        <div>
          <dt>เงินดาวน์</dt>
          <dd>{formatBaht(o.downPayment)}</dd>
        </div>
        <div>
          <dt>จำนวนงวด</dt>
          <dd>{o.term} งวด</dd>
        </div>
        <div>
          <dt>ค่างวด</dt>
          <dd>{formatBaht(o.installment)} / เดือน</dd>
        </div>
        <div>
          <dt>ยอดชำระทั้งหมด</dt>
          <dd>{formatBaht(o.totalPayable)}</dd>
        </div>
        <div>
          <dt>การรับสินค้า</dt>
          <dd>
            {o.handover === 'delivery'
              ? `จัดส่งที่ ${o.deliveryAddress ?? ''} ${o.deliveryProvince ?? ''}`
              : `รับที่${o.branch?.name ?? 'สาขา'}`}
          </dd>
        </div>
      </dl>
      {o.status === 'open' && <AcceptOrDecline offer={o} onChanged={reload} />}
    </section>
  )
}

function OfferState({ offer }: { offer: Offer }) {
  switch (offer.status) {
    case 'open':
      return <p className="muted">ข้อเสนอนี้ใช้ได้ถึง {formatDateTime(offer.expiresAt)}</p>
    case 'accepted':
      return (
        <div className="decision decision-approved" role="status">
          <p>ยอมรับข้อเสนอแล้ว</p>
          {offer.contractNumber && (
            <Link to={`/contracts/${offer.contractNumber}`} className="button decision-retry">
              ดูสัญญา {offer.contractNumber}
            </Link>
          )}
        </div>
      )
    case 'declined':
      return (
        <div className="decision decision-rejected" role="status">
          <p>คุณได้ปฏิเสธข้อเสนอนี้แล้ว</p>
          <Link to="/">เลือกสินค้าอื่น</Link>
        </div>
      )
    default:
      return (
        <div className="decision decision-rejected" role="status">
          <p>ข้อเสนอนี้หมดอายุแล้ว (เกิน 7 วันหลังอนุมัติ)</p>
          <Link to={`/products/${offer.product.id}`}>สมัครใหม่</Link>
        </div>
      )
  }
}

function AcceptOrDecline({ offer, onChanged }: { offer: Offer; onChanged: () => void }) {
  const navigate = useNavigate()
  const { session } = useAuth()
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function fail(e: unknown, fallback: string) {
    setError((e instanceof ApiError && e.error && MESSAGES[e.error]) || fallback)
    // The Offer may have changed underneath (expired, accepted elsewhere): show its current state.
    if (e instanceof ApiError && e.status === 409) onChanged()
  }

  async function sendCode() {
    setBusy(true)
    setError(null)
    try {
      await requestAcceptanceCode(offer.id)
      setCode('')
      setCodeSent(true)
    } catch (e) {
      fail(e, 'ส่งรหัสไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setBusy(false)
    }
  }

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!/^\d{6}$/.test(code)) {
      setError('กรุณากรอกรหัส 6 หลัก')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const contract = await acceptOffer(offer.id, code)
      navigate(`/contracts/${contract.number}`, { replace: true })
    } catch (e) {
      fail(e, 'ยืนยันไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
      setBusy(false)
    }
  }

  async function decline() {
    if (!window.confirm('ยืนยันการปฏิเสธข้อเสนอนี้?')) return
    setBusy(true)
    setError(null)
    try {
      await declineOffer(offer.id)
      onChanged()
    } catch (e) {
      fail(e, 'ปฏิเสธข้อเสนอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setBusy(false)
    }
  }

  const phone = session?.mobileNumber ? formatMobileNumber(session.mobileNumber) : 'มือถือของคุณ'

  return (
    <div className="form offer-actions">
      {codeSent ? (
        <form onSubmit={accept} className="form" noValidate>
          <p className="muted">ส่งรหัส 6 หลักไปที่ {phone} แล้ว รหัสใช้ได้ภายใน 5 นาที</p>
          <label className="form-field">
            <span>รหัส SMS เพื่อยืนยันการยอมรับข้อเสนอ</span>
            <input
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              aria-invalid={error !== null}
              aria-describedby={error ? 'offer-error' : undefined}
            />
          </label>
          <button type="submit" className="button" disabled={busy}>
            ยืนยันและทำสัญญา
          </button>
          <button type="button" className="button button-secondary" onClick={sendCode} disabled={busy}>
            ส่งรหัสใหม่
          </button>
        </form>
      ) : (
        <button type="button" className="button" onClick={sendCode} disabled={busy}>
          ยอมรับข้อเสนอ (รับรหัสทาง SMS)
        </button>
      )}
      <button type="button" className="button button-outline" onClick={decline} disabled={busy}>
        ปฏิเสธข้อเสนอ
      </button>
      {error && (
        <p id="offer-error" className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
