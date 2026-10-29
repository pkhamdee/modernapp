import type { Session } from '../auth/session.ts'
import { apiPost } from './client.ts'

// Mirrors sphone-api's /api/auth endpoints.

export interface Me {
  role: Session['role']
  mobileNumber: string | null
  customerId: number | null
  /** Customers: passed ID Verification (needed to bid in Auctions). */
  idVerified: boolean
  /** Staff only. */
  username: string | null
}

export const authPaths = {
  me: () => '/auth/me',
}

/** Sends a sign-in code by SMS. Rejects with ApiError error "mobile-number-invalid". */
export function requestSmsCode(mobileNumber: string): Promise<void> {
  return apiPost<void>('/auth/sms-code', { mobileNumber })
}

/** Exchanges the SMS code for a Customer session. ApiError error: code-invalid | code-expired | code-locked. */
export function verifySmsCode(mobileNumber: string, code: string): Promise<Session> {
  return apiPost<Session>('/auth/sms-code/verify', { mobileNumber, code })
}

/** Staff sign-in with username and password. ApiError error: credentials-invalid. */
export function staffSignIn(username: string, password: string): Promise<Session> {
  return apiPost<Session>('/auth/staff/sign-in', { username, password })
}

/** 0812345678 → 081-234-5678 */
export function formatMobileNumber(mobileNumber: string): string {
  return mobileNumber.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3')
}
