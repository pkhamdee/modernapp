import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import {
  auctionPaths,
  auctionStatusLabel,
  LOT_POLL_MS,
  lotStatusLabel,
  MINIMUM_INCREMENT,
  placeBid,
  type Lot,
} from '../api/auctions.ts'
import { authPaths, type Me } from '../api/auth.ts'
import { ApiError, useApi, useReloadableApi } from '../api/client.ts'
import { useAuth } from '../auth/context.ts'
import { ProductPhoto } from '../components/ProductPhoto.tsx'
import { Status } from '../components/Status.tsx'
import { formatBaht, formatDateTime } from '../format.ts'
import { NotFoundPage } from './NotFoundPage.tsx'

const VERIFY_FIRST = 'ต้องยืนยันตัวตนด้วยบัตรประชาชนก่อนจึงจะร่วมประมูลได้ ยืนยันได้โดยยื่นคำขอผ่อนสินค้าพร้อมรูปบัตรประชาชน'

/**
 * One Lot (/auction/lots/:id): the bidding panel (current highest Bid, polled; minimum increment; closing time; Bid
 * form), then the photos and condition notes. From 1024px the photos sit to the left of the panel (#54).
 */
export function LotPage() {
  const { id = '' } = useParams()
  const [lot, reload] = useReloadableApi<Lot>(auctionPaths.lot(id))

  // Polling only (no push updates): check the current highest Bid every few seconds while the page is open.
  const open = lot.status === 'success' && lot.data.auctionStatus !== 'closed'
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(reload, LOT_POLL_MS)
    return () => window.clearInterval(timer)
  }, [open, reload])

  if (lot.status === 'error' && lot.error instanceof ApiError && lot.error.status === 404) return <NotFoundPage />
  if (lot.status !== 'success') return <Status state={lot} />

  const l = lot.data
  return (
    <article className="product-detail detail-layout lot-detail">
      <Link to="/auction" className="back-link">
        ← การประมูล
      </Link>
      {/* The bidding panel comes first: on a phone it is on screen without scrolling, the photos follow it. */}
      <section className="detail-panel" aria-label="การเสนอราคา">
        <h1>{l.title}</h1>
        <p className="lot-status-line">
          <span className={`auction-status auction-status-${l.auctionStatus}`}>
            {auctionStatusLabel[l.auctionStatus]}
          </span>{' '}
          <span className="muted">เสนอราคาแล้ว {l.bidCount} ครั้ง</span>
        </p>
        <dl className="terms">
          <div>
            <dt>{l.highestBid === null ? 'ราคาเริ่มต้น' : 'ราคาสูงสุดตอนนี้'}</dt>
            <dd className="product-detail-price" aria-live="polite">
              {formatBaht(l.highestBid ?? l.startingPrice)}
            </dd>
          </div>
          <div>
            <dt>เพิ่มขั้นต่ำครั้งละ</dt>
            <dd>{formatBaht(MINIMUM_INCREMENT)}</dd>
          </div>
          <div className="terms-wide">
            <dt>{l.auctionStatus === 'upcoming' ? 'เปิดประมูล' : 'ปิดประมูล'}</dt>
            <dd>{formatDateTime(l.auctionStatus === 'upcoming' ? l.opensAt : l.closesAt)}</dd>
          </div>
        </dl>
        {l.lotStatus !== 'in-auction' && (
          <p className={l.youWon ? 'form-notice' : 'muted'}>
            ผลการประมูล: {lotStatusLabel[l.lotStatus]}
            {l.reofferedAsLotId !== null && (
              <>
                {' '}
                · <Link to={`/auction/lots/${l.reofferedAsLotId}`}>นำกลับมาประมูลใหม่</Link>
              </>
            )}
          </p>
        )}
        {l.youWon === true && <WinnerNotice lot={l} />}
        {l.youAreHighestBidder === true && l.auctionStatus !== 'closed' && (
          <p className="form-notice" role="status">
            คุณเป็นผู้เสนอราคาสูงสุดตอนนี้
          </p>
        )}
        {l.youAreHighestBidder === false && l.bidCount > 0 && l.auctionStatus === 'open' && (
          <p className="muted">ราคาของคุณยังไม่ใช่ราคาสูงสุด</p>
        )}
        {l.auctionStatus === 'open' && <BidForm lot={l} onBid={reload} />}
        <p className="muted">ผู้ชนะชำระเงินสดที่สาขาภายใน 3 วัน (ไม่สามารถผ่อนชำระได้) · ไม่มีการต่อเวลาประมูล</p>
      </section>
      <div className="detail-media">
        <div className="lot-photos">
          {l.photoUrls.map((url, i) => (
            <ProductPhoto key={url} src={url} alt={`${l.title} รูปที่ ${i + 1}`} large={i === 0} />
          ))}
        </div>
        <h2 className="lot-condition-heading">สภาพเครื่อง</h2>
        <p className="muted">{l.conditionNotes}</p>
      </div>
    </article>
  )
}

/** What the winner must do next: pay cash at a Branch within 3 days (cash only, no hire purchase). */
export function WinnerNotice({ lot }: { lot: Lot }) {
  switch (lot.lotStatus) {
    case 'awaiting-payment':
      return (
        <div className="form-notice winner-notice" role="status">
          <strong>คุณชนะการประมูล!</strong>
          {/* The deadline on its own line: unpaid after 3 days, the Lot is Forfeited (#54). */}
          {lot.paymentDueAt && (
            <p className="payment-deadline">
              ชำระเงินภายใน <strong>{formatDateTime(lot.paymentDueAt)}</strong>
            </p>
          )}
          <p>
            กรุณาชำระเงินสด {formatBaht(lot.highestBid ?? 0)} ที่สาขาของ eShop ภายใน 3 วันหลังปิดประมูล พร้อมบัตรประชาชน
            แล้วรับเครื่องได้ทันที (ชำระเงินสดเท่านั้น ไม่สามารถผ่อนชำระได้)
          </p>
        </div>
      )
    case 'sold':
      return (
        <p className="form-notice" role="status">
          คุณชนะการประมูลและชำระเงินแล้ว ขอบคุณที่ใช้บริการ
        </p>
      )
    case 'forfeited':
      return (
        <p className="form-error" role="status">
          คุณชนะการประมูลแต่ไม่ได้ชำระเงินภายใน 3 วัน จึงถูกริบสิทธิ์
        </p>
      )
    default:
      return null
  }
}

function BidForm({ lot, onBid }: { lot: Lot; onBid: () => void }) {
  const { session } = useAuth()
  const location = useLocation()
  const isCustomer = session?.role === 'Customer'
  const me = useApi<Me>(isCustomer ? authPaths.me() : null)
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  if (!isCustomer) {
    return (
      <p className="form-notice">
        <Link to={`/sign-in?next=${encodeURIComponent(location.pathname)}`}>เข้าสู่ระบบ</Link> เพื่อร่วมประมูล
      </p>
    )
  }
  if (me.status === 'success' && !me.data.idVerified) {
    return (
      <p className="form-notice" role="alert">
        {VERIFY_FIRST} <Link to="/">เลือกสินค้า</Link>
      </p>
    )
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = Number(amount || lot.minimumBid)
    if (!Number.isInteger(value) || value < lot.minimumBid) {
      setMessage({ text: `กรุณาเสนอราคาอย่างน้อย ${formatBaht(lot.minimumBid)} (จำนวนเต็มบาท)`, ok: false })
      return
    }
    setSending(true)
    setMessage(null)
    try {
      await placeBid(lot.id, value)
      setAmount('')
      setMessage({ text: `เสนอราคา ${formatBaht(value)} สำเร็จ`, ok: true })
    } catch (e) {
      setMessage({ text: bidErrorMessage(e), ok: false })
    } finally {
      setSending(false)
      onBid()
    }
  }

  return (
    <form onSubmit={onSubmit} className="form" noValidate>
      <label className="form-field">
        <span>ราคาที่เสนอ (บาท) ขั้นต่ำ {formatBaht(lot.minimumBid)}</span>
        <input
          type="number"
          inputMode="numeric"
          min={lot.minimumBid}
          step={1}
          placeholder={String(lot.minimumBid)}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      {message && (
        <p className={message.ok ? 'form-notice' : 'form-error'} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
      <button type="submit" className="button" disabled={sending}>
        {sending ? 'กำลังส่ง…' : `เสนอราคา ${formatBaht(Number(amount) || lot.minimumBid)}`}
      </button>
    </form>
  )
}

function bidErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return 'เสนอราคาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
  switch (e.error) {
    case 'bid-too-low':
      return 'มีผู้เสนอราคาเท่ากันหรือสูงกว่าแล้ว ราคาต้องสูงกว่าราคาสูงสุดอย่างน้อย 100 บาท'
    case 'id-verification-required':
      return VERIFY_FIRST
    case 'under-20':
      return 'ผู้ร่วมประมูลต้องมีอายุ 20 ปีขึ้นไป'
    case 'auction-not-open':
      return 'การประมูลยังไม่เปิด'
    case 'auction-closed':
      return 'การประมูลปิดแล้ว ไม่สามารถเสนอราคาได้'
    case 'bid-amount-invalid':
      return 'ราคาที่เสนอต้องเป็นจำนวนเต็มบาท'
    default:
      return 'เสนอราคาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
  }
}
