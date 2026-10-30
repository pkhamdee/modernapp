import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { applicationPaths, type Application } from '../api/applications.ts'
import { ApiError, apiGet } from '../api/client.ts'
import { formatBaht, formatDate } from '../format.ts'
import { NotFoundPage } from './NotFoundPage.tsx'

const CHECK_BACK_MS = 2000

/**
 * One Application. While it is being reviewed this is the "กำลังพิจารณา" screen, which checks back every
 * 2 seconds until the Credit Decision arrives (eshop-api decides within 60 seconds).
 */
export function ApplicationPage() {
  const { id = '' } = useParams()
  const [application, setApplication] = useState<Application | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    async function check() {
      try {
        const current = await apiGet<Application>(applicationPaths.application(id), controller.signal)
        setApplication(current)
        setError(null)
        if (current.status === 'reviewing') timer = setTimeout(check, CHECK_BACK_MS)
      } catch (e) {
        if (controller.signal.aborted) return
        setError(e)
        // A network blip shouldn't end the wait; a 404 or 410 (not eligible) should.
        if (!(e instanceof ApiError && (e.status === 404 || e.status === 410))) timer = setTimeout(check, CHECK_BACK_MS)
      }
    }

    void check()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [id])

  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />
  // Under 20 (known once the ID is verified): Eligibility failed, so no Application exists.
  if (error instanceof ApiError && error.status === 410) {
    return (
      <section className="card application column-narrow">
        <div className="decision decision-rejected" role="alert">
          <h1>ไม่ผ่านคุณสมบัติผู้สมัคร</h1>
          <p>ผู้สมัครต้องมีอายุ 20 ปีขึ้นไป</p>
          <Link to="/">กลับหน้าแรก</Link>
        </div>
      </section>
    )
  }
  if (!application) {
    return (
      <p className="status" role="status">
        กำลังโหลด…
      </p>
    )
  }

  return (
    <section className="card application column-narrow">
      <Decision application={application} />
      <dl className="terms">
        <div>
          <dt>สินค้า</dt>
          <dd>{application.product.name}</dd>
        </div>
        <div>
          <dt>ราคา (ล็อกไว้ ณ วันที่สมัคร)</dt>
          <dd>{formatBaht(application.price)}</dd>
        </div>
        <div>
          <dt>เงินดาวน์</dt>
          <dd>{formatBaht(application.downPayment)}</dd>
        </div>
        <div>
          <dt>ค่างวด</dt>
          <dd>
            {formatBaht(application.installment)} × {application.term} งวด
          </dd>
        </div>
        <div>
          <dt>ยอดชำระทั้งหมด</dt>
          <dd>{formatBaht(application.totalPayable)}</dd>
        </div>
        <div>
          <dt>การรับสินค้า</dt>
          <dd>
            {application.handover === 'delivery'
              ? `จัดส่งที่ ${application.deliveryAddress ?? ''} ${application.deliveryProvince ?? ''}`
              : `รับที่${application.branch?.name ?? 'สาขา'}`}
          </dd>
        </div>
        {application.fullName && (
          <div>
            <dt>ชื่อ (จากบัตรประชาชน)</dt>
            <dd>{application.fullName}</dd>
          </div>
        )}
      </dl>
      {error !== null && (
        <p className="form-notice" role="status">
          กำลังเชื่อมต่อใหม่…
        </p>
      )}
    </section>
  )
}

function Decision({ application }: { application: Application }) {
  switch (application.status) {
    case 'reviewing':
      return (
        <div className="decision decision-reviewing" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <h1>กำลังพิจารณา</h1>
          <p className="muted">ปกติใช้เวลาไม่เกิน 1 นาที หน้านี้จะอัปเดตเอง ไม่ต้องรีเฟรช</p>
        </div>
      )
    case 'approved':
      return (
        <div className="decision decision-approved" role="status">
          <h1>อนุมัติแล้ว</h1>
          {application.creditLimit !== null && (
            <p className="muted">วงเงินของคุณ {formatBaht(application.creditLimit)}</p>
          )}
          {application.offer && (
            <Link to={`/offers/${application.offer.id}`} className="button decision-retry">
              {application.offer.status === 'open' ? 'ดูข้อเสนอและยืนยัน' : 'ดูข้อเสนอ'}
            </Link>
          )}
        </div>
      )
    default:
      return (
        <div className="decision decision-rejected" role="alert">
          <h1>ไม่ผ่านการพิจารณา</h1>
          {application.reason === 'timed-out' ? (
            <>
              <p>ระบบตรวจสอบตอบกลับช้าเกินไป คุณสามารถสมัครใหม่ได้ทันที</p>
              <Link to={`/products/${application.product.id}`} className="button decision-retry">
                สมัครใหม่
              </Link>
            </>
          ) : (
            <p>
              {application.reason === 'id-verification-failed'
                ? 'ไม่สามารถยืนยันตัวตนจากบัตรประชาชนได้'
                : application.reason === 'over-credit-limit'
                  ? `ยอดจัดผ่อนเกินวงเงินของคุณ${application.creditLimit !== null ? ` (${formatBaht(application.creditLimit)})` : ''}`
                  : 'ผลการตรวจสอบเครดิตไม่ผ่านเกณฑ์'}
              {application.reapplyFrom && <> สมัครใหม่ได้ตั้งแต่ {formatDate(application.reapplyFrom)}</>}
            </p>
          )}
        </div>
      )
  }
}
