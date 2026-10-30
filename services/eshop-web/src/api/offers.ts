import { apiPost } from './client.ts'
import type { Contract } from './contracts.ts'

// Mirrors eshop-api's Offer endpoints (GLOSSARY: Offer). An Offer is open for 7 days after approval.

export type OfferStatus = 'open' | 'accepted' | 'declined' | 'expired'

export interface Offer {
  id: number
  status: OfferStatus
  /** ISO time the Offer expires (7 days after approval). */
  expiresAt: string
  applicationId: number
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
  /** Set once accepted. */
  contractNumber: string | null
}

export const offerPaths = {
  offer: (id: string | number) => `/offers/${encodeURIComponent(String(id))}`,
}

/** Sends an SMS code to the Customer's phone for accepting. ApiError 409 error: offer-accepted|offer-declined|offer-expired. */
export function requestAcceptanceCode(offerId: number): Promise<void> {
  return apiPost<void>(`${offerPaths.offer(offerId)}/sms-code`)
}

/**
 * Accepts with the SMS code; resolves with the new Contract. ApiError 400 error: code-invalid|code-expired|code-locked;
 * 409 error: offer-accepted|offer-declined|offer-expired|active-contract.
 */
export function acceptOffer(offerId: number, code: string): Promise<Contract> {
  return apiPost<Contract>(`${offerPaths.offer(offerId)}/accept`, { code })
}

export function declineOffer(offerId: number): Promise<Offer> {
  return apiPost<Offer>(`${offerPaths.offer(offerId)}/decline`)
}
