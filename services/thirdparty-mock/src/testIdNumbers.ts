// Test ID numbers: the LAST TWO DIGITS of a 13-digit national ID number pick the outcome of
// ID Verification and Credit Check, so every Credit Decision path can be demoed (spec #1, stories 63-64).
// Any other suffix behaves like …01. No checksum is required.

export interface TestOutcome {
  suffix: string
  idVerification: 'verified' | 'failed'
  /** Age (whole years) of the verified person on the day of the check. */
  age: number
  creditCheck: 'passed' | 'failed'
  creditLimit: number
  description: string
}

export const TEST_OUTCOMES: readonly TestOutcome[] = [
  { suffix: '01', idVerification: 'verified', age: 35, creditCheck: 'passed', creditLimit: 50_000, description: 'ผ่าน วงเงิน ฿50,000 (Approved)' },
  { suffix: '02', idVerification: 'verified', age: 35, creditCheck: 'failed', creditLimit: 0, description: 'Credit Check ไม่ผ่าน (Rejected)' },
  { suffix: '03', idVerification: 'verified', age: 35, creditCheck: 'passed', creditLimit: 5_000, description: 'ผ่าน วงเงิน ฿5,000 (เกินวงเงิน → Rejected สำหรับสินค้าราคาสูง)' },
  { suffix: '04', idVerification: 'failed', age: 0, creditCheck: 'failed', creditLimit: 0, description: 'ID Verification ไม่ผ่าน (Rejected)' },
  { suffix: '05', idVerification: 'verified', age: 18, creditCheck: 'passed', creditLimit: 50_000, description: 'อายุ 18 ปี (ไม่ผ่านคุณสมบัติ: อายุต่ำกว่า 20)' },
]

export const ID_NUMBER = /^[0-9]{13}$/

export function outcomeFor(idNumber: string): TestOutcome {
  return TEST_OUTCOMES.find((o) => idNumber.endsWith(o.suffix)) ?? TEST_OUTCOMES[0]
}

/** Example ID number for a suffix, e.g. 1101700000101 for …01. */
export function exampleIdNumber(suffix: string): string {
  return `11017000001${suffix}`
}

const FIRST_NAMES = ['สมชาย', 'สมหญิง', 'วิชัย', 'มาลี', 'ประเสริฐ', 'สุดา', 'อนันต์', 'กมลา']
const LAST_NAMES = ['ใจดี', 'รักไทย', 'มั่นคง', 'ศรีสวัสดิ์', 'สุขสันต์', 'บุญมี']

/** A stable fake Thai name for an ID number. */
export function fullNameFor(idNumber: string): string {
  const n = Number(idNumber.slice(-6, -2))
  return `${FIRST_NAMES[n % FIRST_NAMES.length]} ${LAST_NAMES[n % LAST_NAMES.length]}`
}

/** Date of birth (YYYY-MM-DD) that makes the person `age` today, born a few months before today's date. */
export function dateOfBirthFor(age: number, today = new Date()): string {
  const birth = new Date(Date.UTC(today.getUTCFullYear() - age, today.getUTCMonth(), today.getUTCDate()))
  birth.setUTCMonth(birth.getUTCMonth() - 3)
  return birth.toISOString().slice(0, 10)
}
