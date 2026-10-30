import { apiPost, apiPut } from './client.ts'

// Mirrors sphone-api's Auction endpoints: public /api/auctions and /api/lots (browse, poll, bid) and the
// Staff-only /api/back-office/auctions, /lots and /lot-photos.

export type AuctionStatus = 'upcoming' | 'open' | 'closed'

export interface Lot {
  id: number
  auctionId: number
  title: string
  conditionNotes: string
  startingPrice: number
  imageIds: string[]
  photoUrls: string[]
  /** null until the first Bid. */
  highestBid: number | null
  bidCount: number
  /** The smallest Bid accepted now: the starting price, or the highest Bid + ฿100. */
  minimumBid: number
  opensAt: string
  closesAt: string
  auctionStatus: AuctionStatus
  /** Only for a signed-in Customer; null otherwise. */
  youAreHighestBidder: boolean | null
  lotStatus: LotStatus
  /** Only for a signed-in Customer; true once the Auction has closed with their Bid the highest. */
  youWon: boolean | null
  /** The winner must pay cash at a Branch by then (close + 3 days); null without a winner. */
  paymentDueAt: string | null
  /** Always true: won Lots are paid in cash at a Branch, never on hire purchase. */
  cashOnly: boolean
  /** The Lot that offers this one again in a later Auction. */
  reofferedAsLotId: number | null
  /** Back office only: the winner and what happened after the close. */
  sale: LotSale | null
}

/** in-auction until the close; then unsold (no Bids) or awaiting-payment → sold | forfeited. */
export type LotStatus = 'in-auction' | 'unsold' | 'awaiting-payment' | 'sold' | 'forfeited'

export interface LotSale {
  winnerCustomerId: number
  winnerFullName: string | null
  winnerMobileNumber: string | null
  amount: number
  paymentDueAt: string
  paidAt: string | null
  paymentBranchCode: string | null
  paymentRecordedBy: string | null
  forfeitedAt: string | null
  /** The 3 days have passed without payment. */
  mayForfeit: boolean
}

export interface Auction {
  id: number
  opensAt: string
  closesAt: string
  status: AuctionStatus
  lots: Lot[]
}

export interface LotInput {
  title: string
  conditionNotes: string
  /** Whole baht. */
  startingPrice: number
  /** From uploadLotPhoto, in display order (1 to 10). */
  imageIds: string[]
}

/** Bids must beat the current highest Bid by at least this much (baht). */
export const MINIMUM_INCREMENT = 100

/** How often a Lot page checks the current highest Bid (no push updates in the MVP). */
export const LOT_POLL_MS = 3000

export const auctionPaths = {
  current: () => '/auctions/current',
  lot: (id: number | string) => `/lots/${id}`,
  wonLots: () => '/lots/won',
  backOfficeAuctions: () => '/back-office/auctions',
  backOfficeAuction: (id: number | string) => `/back-office/auctions/${id}`,
}

/**
 * Places a Bid. Rejects with ApiError error: bid-too-low (someone bid the same or more; reload for the new
 * minimum) | id-verification-required | under-20 | auction-not-open | auction-closed | bid-amount-invalid.
 */
export const placeBid = (lotId: number, amount: number) => apiPost<Lot>(`/lots/${lotId}/bids`, { amount })

/** Both optional: defaults to the next Monday 10:00 to Sunday 20:00 (Asia/Bangkok). */
export const createAuction = (times: { opensAt?: string; closesAt?: string }) =>
  apiPost<Auction>('/back-office/auctions', times)

export const addLot = (auctionId: number, input: LotInput) => apiPost<Lot>(`/back-office/auctions/${auctionId}/lots`, input)

/** Only until the Lot's first Bid (ApiError error "lot-has-bids" after that). */
export const editLot = (lotId: number, input: LotInput) => apiPut<Lot>(`/back-office/lots/${lotId}`, input)

/** Uploads a Lot photo (JPEG, PNG or WebP, at most 10 MB) to the image service's public area. */
export const uploadLotPhoto = (file: File) => apiPost<{ imageId: string; imageUrl: string }>('/back-office/lot-photos', file)

/** Records the winner's cash payment and Handover at a Branch (ApiError error "lot-not-awaiting-payment"). */
export const recordLotPayment = (lotId: number, branchCode: string) =>
  apiPost<Lot>(`/back-office/lots/${lotId}/payment`, { branchCode })

/** Only after 3 days unpaid (ApiError error "payment-window-open" before, "lot-not-awaiting-payment"). */
export const forfeitLot = (lotId: number) => apiPost<Lot>(`/back-office/lots/${lotId}/forfeit`)

/** Offers a Forfeited or unsold Lot again in a later, not yet closed Auction (error "lot-not-reofferable"). */
export const reofferLot = (lotId: number, auctionId: number, startingPrice?: number) =>
  apiPost<Lot>(`/back-office/lots/${lotId}/re-offer`, { auctionId, startingPrice })

export const lotStatusLabel: Record<LotStatus, string> = {
  'in-auction': 'อยู่ระหว่างประมูล',
  unsold: 'ไม่มีผู้ประมูล',
  'awaiting-payment': 'รอผู้ชนะชำระเงิน',
  sold: 'ชำระเงินและส่งมอบแล้ว',
  forfeited: 'ริบสิทธิ์ (ไม่ชำระภายใน 3 วัน)',
}

export const auctionStatusLabel: Record<AuctionStatus, string> = {
  upcoming: 'ยังไม่เปิด',
  open: 'กำลังประมูล',
  closed: 'ปิดประมูลแล้ว',
}
