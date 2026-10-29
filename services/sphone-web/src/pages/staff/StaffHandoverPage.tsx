import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { formatThaiDate } from '../../api/applications.ts'
import { problemMessage, useReloadableApi } from '../../api/client.ts'
import { CONTRACT_STATUS_LABELS } from '../../api/contracts.ts'
import {
  fetchIdCardPhoto,
  HANDOVER_STAGE_LABELS,
  handoverPaths,
  MOVE_TO_LABELS,
  moveHandover,
  recordDownPayment,
  type Handover,
} from '../../api/handovers.ts'
import { Status } from '../../components/Status.tsx'
import { formatBaht } from '../../format.ts'

/**
 * One Handover: who and what, the Customer's ID card photo (to check identity), recording the Down Payment
 * and moving the stage on. The server refuses skipping a stage, going back, or handing over before the Down
 * Payment is recorded; a Contract cancelled in the Enterprise System stops the Handover.
 */
export function StaffHandoverPage() {
  const { number = '' } = useParams()
  const [handover, reload] = useReloadableApi<Handover>(handoverPaths.handover(number))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (handover.status !== 'success') return <Status state={handover} />
  const h = handover.data
  const downPaymentOutstanding = h.downPayment > 0 && h.downPaymentReceived === null

  async function act(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      reload()
    } catch (e) {
      setError(problemMessage(e, 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card application">
      <Link to="/staff/handovers" className="back-link">
        ← รอส่งมอบสินค้า
      </Link>
      <h1>ส่งมอบสินค้า</h1>
      <p className="contract-number">{h.contractNumber}</p>
      {h.stopped && (
        <p className="form-error" role="alert">
          สัญญานี้ถูกยกเลิกในระบบหลักขององค์กร จึงหยุดการส่งมอบสินค้า
        </p>
      )}
      <dl className="terms">
        <div>
          <dt>ขั้นตอน</dt>
          <dd>{h.stopped ? HANDOVER_STAGE_LABELS.stopped : HANDOVER_STAGE_LABELS[h.stage]}</dd>
        </div>
        <div>
          <dt>สถานะสัญญา</dt>
          <dd>{CONTRACT_STATUS_LABELS[h.contractStatus]}</dd>
        </div>
        <div>
          <dt>สินค้า</dt>
          <dd>{h.product.name}</dd>
        </div>
        <div>
          <dt>ลูกค้า</dt>
          <dd>
            {h.customer.fullName} · {h.customer.mobileNumber}
          </dd>
        </div>
        <div>
          <dt>เลขประจำตัวประชาชน</dt>
          <dd>{h.customer.idNumber}</dd>
        </div>
        <div>
          <dt>การรับสินค้า</dt>
          <dd>
            {h.method === 'delivery'
              ? `จัดส่งที่ ${h.deliveryAddress ?? ''} ${h.deliveryProvince ?? ''}`
              : `รับที่${h.branch?.name ?? 'สาขา'}`}
          </dd>
        </div>
        <div>
          <dt>เงินดาวน์</dt>
          <dd>
            {h.downPayment > 0
              ? `${formatBaht(h.downPayment)} · ${h.downPaymentReceived === null ? 'ยังไม่ได้รับ' : 'รับแล้ว'}`
              : 'ไม่มีเงินดาวน์'}
          </dd>
        </div>
        {h.handedOverAt && (
          <div>
            <dt>ส่งมอบเมื่อ</dt>
            <dd>{formatThaiDate(h.handedOverAt)}</dd>
          </div>
        )}
      </dl>

      <IdCardPhoto handover={h} />

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="staff-actions">
        {!h.stopped && downPaymentOutstanding && (
          <button
            type="button"
            className="button button-small button-outline"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`ยืนยันว่าได้รับเงินดาวน์ ${formatBaht(h.downPayment)} แล้ว?`))
                void act(() => recordDownPayment(h.contractNumber, h.downPayment))
            }}
          >
            บันทึกรับเงินดาวน์ {formatBaht(h.downPayment)}
          </button>
        )}
        {h.nextStages.map((stage) => (
          <button
            key={stage}
            type="button"
            className="button button-small"
            disabled={busy || (stage === 'handed-over' && downPaymentOutstanding)}
            onClick={() => void act(() => moveHandover(h.contractNumber, stage))}
          >
            {MOVE_TO_LABELS[stage]}
          </button>
        ))}
      </div>
      {h.nextStages.includes('handed-over') && downPaymentOutstanding && (
        <p className="muted">บันทึกรับเงินดาวน์ก่อนส่งมอบสินค้า</p>
      )}
    </section>
  )
}

/** Shown on request: fetched with the Staff token into an object URL that is revoked afterwards. */
function IdCardPhoto({ handover }: { handover: Handover }) {
  const [shown, setShown] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!shown) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    fetchIdCardPhoto(handover).then(
      (blob) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      },
      () => {
        if (!controller.signal.aborted) setFailed(true)
      },
    )
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(null)
    }
  }, [shown, handover])

  return (
    <div className="id-card-photo">
      <button type="button" className="button button-small button-outline" onClick={() => setShown((s) => !s)}>
        {shown ? 'ซ่อนรูปบัตรประชาชน' : 'ดูรูปบัตรประชาชน'}
      </button>
      {shown && failed && <p className="form-error">โหลดรูปบัตรประชาชนไม่สำเร็จ</p>}
      {shown && url && <img src={url} alt={`รูปบัตรประชาชนของ ${handover.customer.fullName}`} />}
    </div>
  )
}
