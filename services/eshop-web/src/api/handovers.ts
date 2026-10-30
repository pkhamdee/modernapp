import { apiGetBlob, apiPost } from './client.ts'
import type { ContractStatus } from './contracts.ts'

// Mirrors eshop-api's Staff-only /api/back-office/handovers endpoints (GLOSSARY: Handover, Down Payment).
// Only the Handover changes; the Contract itself stays as pushed to the Enterprise System (ADR-0001).

export type HandoverStage = 'preparing' | 'ready-for-pickup' | 'out-for-delivery' | 'handed-over'
export type HandoverMethod = 'delivery' | 'store-pickup'

export interface Handover {
  contractNumber: string
  contractStatus: ContractStatus
  stage: HandoverStage
  /** The stage Staff may move to now (empty once handed over or stopped). */
  nextStages: HandoverStage[]
  /** The Contract was cancelled in the Enterprise System, so the Handover stops. */
  stopped: boolean
  method: HandoverMethod
  branch: { code: string; name: string } | null
  deliveryAddress: string | null
  deliveryProvince: string | null
  customer: { fullName: string; mobileNumber: string; idNumber: string }
  product: { id: number; name: string }
  downPayment: number
  downPaymentReceived: number | null
  downPaymentReceivedAt: string | null
  stageChangedAt: string
  handedOverAt: string | null
  acceptedAt: string
  /** Needs the Staff token: fetch with fetchIdCardPhoto, never link it. */
  idCardPhotoUrl: string
}

export const HANDOVER_STAGE_LABELS: Record<HandoverStage | 'stopped', string> = {
  preparing: 'กำลังเตรียมสินค้า',
  'ready-for-pickup': 'พร้อมให้รับที่สาขา',
  'out-for-delivery': 'กำลังจัดส่ง',
  'handed-over': 'ส่งมอบแล้ว',
  stopped: 'หยุดการส่งมอบ (สัญญาถูกยกเลิก)',
}

/** What the button that moves a Handover to this stage says. */
export const MOVE_TO_LABELS: Record<HandoverStage, string> = {
  preparing: 'เตรียมสินค้า',
  'ready-for-pickup': 'สินค้าพร้อมให้รับที่สาขา',
  'out-for-delivery': 'ออกจัดส่งแล้ว',
  'handed-over': 'ส่งมอบสินค้าแล้ว',
}

export const handoverPaths = {
  awaiting: (filter: { branch?: string; method?: string }) => {
    const query = new URLSearchParams()
    if (filter.branch) query.set('branch', filter.branch)
    if (filter.method) query.set('method', filter.method)
    const qs = query.toString()
    return `/back-office/handovers${qs ? `?${qs}` : ''}`
  },
  handover: (number: string) => `/back-office/handovers/${encodeURIComponent(number)}`,
}

export const moveHandover = (number: string, stage: HandoverStage) =>
  apiPost<Handover>(`${handoverPaths.handover(number)}/stage`, { stage })

export const recordDownPayment = (number: string, amount: number) =>
  apiPost<Handover>(`${handoverPaths.handover(number)}/down-payment`, { amount })

/** The Customer's ID card photo (private image area) as a Blob; idCardPhotoUrl starts with /api. */
export const fetchIdCardPhoto = (handover: Handover) => apiGetBlob(handover.idCardPhotoUrl.replace(/^\/api/, ''))
