// Mirrors sphone-api's Contract endpoints (GLOSSARY: Contract, Installment). Read-only: the Enterprise
// System owns a Contract once pushed (ADR-0001).

export type ContractStatus = 'active' | 'overdue' | 'paid-off' | 'cancelled'

export interface ScheduledInstallment {
  number: number
  amount: number
  /** null until Handover: the first Installment is due one month after it. */
  dueDate: string | null
}

export interface Contract {
  /** SP-YYYYMM-NNNNNN */
  number: string
  status: ContractStatus
  acceptedAt: string
  product: { id: number; name: string }
  price: number
  downPayment: number
  term: number
  installment: number
  totalPayable: number
  handover: 'delivery' | 'store-pickup'
  deliveryAddress: string | null
  deliveryProvince: string | null
  branch: { code: string; name: string } | null
  /** Where the Handover is; `stopped` once the Contract was cancelled before the goods were handed over. */
  handoverStage: CustomerHandoverStage
  handedOverAt: string | null
  installments: ScheduledInstallment[]
}

export type CustomerHandoverStage = 'preparing' | 'ready-for-pickup' | 'out-for-delivery' | 'handed-over' | 'stopped'

/** The Handover stage as the Customer reads it. */
export const CUSTOMER_HANDOVER_STAGE_LABELS: Record<CustomerHandoverStage, string> = {
  preparing: 'กำลังเตรียมสินค้า',
  'ready-for-pickup': 'สินค้าพร้อมแล้ว รับได้ที่สาขา',
  'out-for-delivery': 'กำลังจัดส่งสินค้า',
  'handed-over': 'รับสินค้าแล้ว',
  stopped: 'หยุดการส่งมอบ เนื่องจากสัญญาถูกยกเลิก',
}

export interface ContractSummary {
  number: string
  status: ContractStatus
  acceptedAt: string
  product: { id: number; name: string }
  installment: number
  term: number
}

export const contractPaths = {
  contracts: () => '/contracts',
  contract: (number: string) => `/contracts/${encodeURIComponent(number)}`,
}

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  active: 'ปกติ',
  overdue: 'ค้างชำระ',
  'paid-off': 'ชำระครบแล้ว',
  cancelled: 'ยกเลิก',
}
