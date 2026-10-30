import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  applicationPaths,
  ineligibleMessage,
  submitApplication,
  type Eligibility,
} from '../api/applications.ts'
import { catalogPaths, type InstallmentPlans, type ProductDetail } from '../api/catalog.ts'
import { ApiError, useApi } from '../api/client.ts'
import { Status } from '../components/Status.tsx'
import { formatBaht } from '../format.ts'

interface Branch {
  code: string
  name: string
  address: string
  province: string
}

const MAX_PHOTO_BYTES = 10 * 1024 * 1024

/**
 * Application form: one ID number, one ID card photo, and Delivery (Bangkok Metropolitan Region only) or
 * Store Pickup at a Branch. Term and Down Payment come from the Product page's calculator (?term=&downPayment=).
 * Eligibility is checked first, so an ineligible Customer is told before filling anything in.
 */
export function ApplyPage() {
  const { id = '' } = useParams()
  const [searchParams] = useSearchParams()
  const term = Number(searchParams.get('term') ?? '0')
  const downPayment = Number(searchParams.get('downPayment') ?? '0')

  const eligibility = useApi<Eligibility>(applicationPaths.eligibility())
  const product = useApi<ProductDetail>(catalogPaths.product(id))
  const plans = useApi<InstallmentPlans>(
    Number.isFinite(downPayment) && downPayment >= 0 ? catalogPaths.installmentPlans(id, downPayment) : null,
  )
  const branches = useApi<Branch[]>('/branches')
  const provinces = useApi<string[]>(applicationPaths.deliveryProvinces())

  if (eligibility.status !== 'success') return <Status state={eligibility} />
  if (product.status !== 'success') return <Status state={product} />
  if (plans.status !== 'success') return <Status state={plans} />
  if (branches.status !== 'success') return <Status state={branches} />
  if (provinces.status !== 'success') return <Status state={provinces} />

  const backToProduct = (
    <Link to={`/products/${product.data.id}`} className="back-link">
      ← {product.data.name}
    </Link>
  )

  if (!eligibility.data.eligible) {
    return (
      <section className="card">
        {backToProduct}
        <h1>ยังสมัครไม่ได้</h1>
        <p role="alert">{ineligibleMessage(eligibility.data.reason, eligibility.data.reapplyFrom)}</p>
        {eligibility.data.offerId !== null && (
          <Link to={`/offers/${eligibility.data.offerId}`} className="button apply-button">
            ดูข้อเสนอ
          </Link>
        )}
      </section>
    )
  }

  const plan = plans.data.plans.find((p) => p.term === term)
  if (!plan) {
    return (
      <section className="card">
        {backToProduct}
        <h1>เลือกแผนผ่อนชำระก่อน</h1>
        <p>กรุณาเลือกจำนวนงวดและเงินดาวน์ในหน้าสินค้า</p>
      </section>
    )
  }

  return (
    <ApplyForm
      backLink={backToProduct}
      product={product.data}
      term={plan.term}
      downPayment={downPayment}
      installment={plan.installment}
      totalPayable={plan.totalPayable}
      branches={branches.data}
      provinces={provinces.data}
    />
  )
}

function ApplyForm(props: {
  backLink: ReactNode
  product: ProductDetail
  term: number
  downPayment: number
  installment: number
  totalPayable: number
  branches: Branch[]
  provinces: string[]
}) {
  const navigate = useNavigate()
  const [idNumber, setIdNumber] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [handover, setHandover] = useState<'store-pickup' | 'delivery'>('store-pickup')
  const [branchCode, setBranchCode] = useState(props.branches[0]?.code ?? '')
  const [deliveryProvince, setDeliveryProvince] = useState(props.provinces[0] ?? '')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const digits = idNumber.replace(/\D/g, '')
    if (!/^\d{13}$/.test(digits)) return setError('กรุณากรอกเลขประจำตัวประชาชน 13 หลัก')
    if (!photo) return setError('กรุณาถ่ายหรือแนบรูปบัตรประชาชน 1 รูป')
    if (photo.size > MAX_PHOTO_BYTES) return setError('รูปบัตรประชาชนต้องมีขนาดไม่เกิน 10 MB')
    if (handover === 'delivery' && deliveryAddress.trim() === '') return setError('กรุณากรอกที่อยู่สำหรับจัดส่ง')

    setSending(true)
    setError(null)
    try {
      const application = await submitApplication({
        productId: props.product.id,
        term: props.term,
        downPayment: props.downPayment,
        idNumber: digits,
        idCardPhoto: photo,
        handover,
        branchCode: handover === 'store-pickup' ? branchCode : undefined,
        deliveryAddress: handover === 'delivery' ? deliveryAddress.trim() : undefined,
        deliveryProvince: handover === 'delivery' ? deliveryProvince : undefined,
      })
      navigate(`/applications/${application.id}`, { replace: true })
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.status === 409
            ? ineligibleMessage(e.error, e.reapplyFrom)
            : e.message
          : 'ส่งคำขอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      )
      setSending(false)
    }
  }

  return (
    <section className="card">
      {props.backLink}
      <h1>สมัครผ่อน {props.product.name}</h1>
      <dl className="terms">
        <div>
          <dt>ราคา</dt>
          <dd>{formatBaht(props.product.price)}</dd>
        </div>
        <div>
          <dt>เงินดาวน์</dt>
          <dd>{formatBaht(props.downPayment)}</dd>
        </div>
        <div>
          <dt>ผ่อน</dt>
          <dd>
            {formatBaht(props.installment)} × {props.term} งวด
          </dd>
        </div>
        <div>
          <dt>ยอดชำระทั้งหมด</dt>
          <dd>{formatBaht(props.totalPayable)}</dd>
        </div>
      </dl>

      <form onSubmit={onSubmit} className="form" noValidate>
        <label className="form-field">
          <span>เลขประจำตัวประชาชน</span>
          <input
            inputMode="numeric"
            autoComplete="off"
            placeholder="13 หลัก"
            maxLength={17}
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
            required
          />
        </label>

        <label className="form-field">
          <span>รูปถ่ายบัตรประชาชน (1 รูป)</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            required
          />
          <small className="form-notice">ชื่อและวันเกิดจะดึงจากการตรวจสอบบัตร ไม่ต้องกรอกเอง รูปนี้เก็บเป็นความลับ</small>
        </label>

        <fieldset className="form-field form-choice">
          <legend>การรับสินค้า</legend>
          <label>
            <input
              type="radio"
              name="handover"
              checked={handover === 'store-pickup'}
              onChange={() => setHandover('store-pickup')}
            />{' '}
            รับสินค้าที่สาขา
          </label>
          <label>
            <input type="radio" name="handover" checked={handover === 'delivery'} onChange={() => setHandover('delivery')} />{' '}
            จัดส่งฟรี (เฉพาะกรุงเทพฯ และปริมณฑล)
          </label>
          <small className="form-notice">อยู่ต่างจังหวัด? เลือกรับสินค้าที่สาขาใกล้บ้าน</small>
        </fieldset>

        {handover === 'store-pickup' ? (
          <label className="form-field">
            <span>สาขา</span>
            <select value={branchCode} onChange={(e) => setBranchCode(e.target.value)}>
              {props.branches.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name} ({b.province})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="form-field">
              <span>จังหวัด</span>
              <select value={deliveryProvince} onChange={(e) => setDeliveryProvince(e.target.value)}>
                {props.provinces.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>ที่อยู่สำหรับจัดส่ง</span>
              <textarea
                rows={3}
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder="บ้านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ รหัสไปรษณีย์"
                required
              />
            </label>
          </>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={sending}>
          {sending ? 'กำลังส่งคำขอ…' : 'ส่งคำขอ'}
        </button>
      </form>
    </section>
  )
}
