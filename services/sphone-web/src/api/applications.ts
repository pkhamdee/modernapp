import { apiPost } from './client.ts'

// Mirrors sphone-api's Eligibility and Application endpoints (GLOSSARY: Eligibility, Application, Credit Decision).

export type IneligibleReason = 'active-contract' | 'application-in-progress' | 'recently-rejected'

export interface Eligibility {
  eligible: boolean
  reason: IneligibleReason | null
  /** ISO time from which a recently Rejected Customer may apply again. */
  reapplyFrom: string | null
}

export type ApplicationStatus = 'reviewing' | 'approved' | 'rejected' | 'not-eligible'

export type ApplicationReason =
  | 'id-verification-failed'
  | 'credit-check-failed'
  | 'over-credit-limit'
  | 'timed-out'
  | 'under-20'

export interface Application {
  id: number
  status: ApplicationStatus
  reason: ApplicationReason | null
  /** When the Customer may apply again after a Rejection (null after a time-out). */
  reapplyFrom: string | null
  submittedAt: string
  decidedAt: string | null
  product: { id: number; name: string }
  /** Locked when the Application was submitted. */
  price: number
  downPayment: number
  term: number
  installment: number
  totalPayable: number
  handover: 'delivery' | 'store-pickup'
  deliveryAddress: string | null
  deliveryProvince: string | null
  branch: { code: string; name: string } | null
  /** From ID Verification. */
  fullName: string | null
  dateOfBirth: string | null
  creditLimit: number | null
}

export const applicationPaths = {
  eligibility: () => '/eligibility',
  deliveryProvinces: () => '/delivery-provinces',
  application: (id: string | number) => `/applications/${encodeURIComponent(String(id))}`,
}

export interface ApplicationInput {
  productId: number
  term: number
  downPayment: number
  idNumber: string
  idCardPhoto: File
  handover: 'delivery' | 'store-pickup'
  branchCode?: string
  deliveryAddress?: string
  deliveryProvince?: string
}

/**
 * Submits an Application (multipart, with the ID card photo). Resolves with the Application, still "reviewing".
 * ApiError 409 error: IneligibleReason (+ reapplyFrom); 400 error: id-number-invalid, photo-required,
 * photo-invalid, plan-not-offered, delivery-outside-bmr, delivery-address-required, branch-not-found.
 */
export function submitApplication(input: ApplicationInput): Promise<Application> {
  const form = new FormData()
  form.set('productId', String(input.productId))
  form.set('term', String(input.term))
  form.set('downPayment', String(input.downPayment))
  form.set('idNumber', input.idNumber)
  form.set('idCardPhoto', input.idCardPhoto)
  form.set('handover', input.handover)
  if (input.branchCode) form.set('branchCode', input.branchCode)
  if (input.deliveryAddress) form.set('deliveryAddress', input.deliveryAddress)
  if (input.deliveryProvince) form.set('deliveryProvince', input.deliveryProvince)
  return apiPost<Application>('/applications', form)
}

const dateFormat = new Intl.DateTimeFormat('th-TH', { dateStyle: 'long', timeZone: 'Asia/Bangkok' })

/** "28 พฤศจิกายน 2569" */
export function formatThaiDate(iso: string): string {
  return dateFormat.format(new Date(iso))
}

export function ineligibleMessage(reason: IneligibleReason | string | undefined | null, reapplyFrom?: string | null): string {
  switch (reason) {
    case 'active-contract':
      return 'คุณมีสัญญาเช่าซื้อที่ยังไม่สิ้นสุด จึงยังสมัครใหม่ไม่ได้'
    case 'application-in-progress':
      return 'คำขอก่อนหน้าของคุณกำลังอยู่ระหว่างพิจารณา'
    case 'recently-rejected':
      return reapplyFrom
        ? `คำขอของคุณถูกปฏิเสธเมื่อไม่ถึง 30 วันที่ผ่านมา สมัครใหม่ได้ตั้งแต่ ${formatThaiDate(reapplyFrom)}`
        : 'คำขอของคุณถูกปฏิเสธเมื่อไม่ถึง 30 วันที่ผ่านมา'
    default:
      return 'ขณะนี้คุณยังสมัครไม่ได้'
  }
}
