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
  backOfficeAuctions: () => '/back-office/auctions',
  backOfficeAuction: (id: number | string) => `/back-office/auctions/${id}`,
}

/**
 * Places a Bid. Rejects with ApiError error: bid-too-low (someone bid the same or more; reload for the new
 * minimum) | id-verification-required | auction-not-open | auction-closed | bid-amount-invalid.
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

export const auctionStatusLabel: Record<AuctionStatus, string> = {
  upcoming: 'ยังไม่เปิด',
  open: 'กำลังประมูล',
  closed: 'ปิดประมูลแล้ว',
}
