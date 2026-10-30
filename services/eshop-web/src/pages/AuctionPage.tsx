import { Link } from 'react-router'
import { auctionPaths, auctionStatusLabel, type Auction } from '../api/auctions.ts'
import { ApiError, useApi } from '../api/client.ts'
import { ProductPhoto } from '../components/ProductPhoto.tsx'
import { Status } from '../components/Status.tsx'
import { formatBaht, formatDateTime } from '../format.ts'

/** The current weekly Auction (/auction): its Lots with photos and the current highest Bid. */
export function AuctionPage() {
  const auction = useApi<Auction>(auctionPaths.current())

  if (auction.status === 'error' && auction.error instanceof ApiError && auction.error.status === 404) {
    return (
      <section className="hero">
        <h1>ประมูล iPhone มือสอง</h1>
        <p>ยังไม่มีการประมูลในขณะนี้ เปิดประมูลทุกวันจันทร์ 10:00 น. ถึงวันอาทิตย์ 20:00 น.</p>
      </section>
    )
  }
  if (auction.status !== 'success') return <Status state={auction} />

  const { status, opensAt, closesAt, lots } = auction.data

  return (
    <>
      <section className="hero">
        <h1>ประมูล iPhone มือสอง ครบกล่อง</h1>
        <p>
          <span className={`auction-status auction-status-${status}`}>{auctionStatusLabel[status]}</span>{' '}
          {formatDateTime(opensAt)} – {formatDateTime(closesAt)}
        </p>
        <p>ผู้ชนะชำระเงินสดที่สาขาภายใน 3 วัน (ไม่สามารถผ่อนชำระได้)</p>
      </section>

      {lots.length === 0 ? (
        <p className="status">ยังไม่มีรายการประมูล</p>
      ) : (
        <ul className="product-list">
          {lots.map((lot) => (
            <li key={lot.id}>
              <Link to={`/auction/lots/${lot.id}`} className="product-card">
                <ProductPhoto src={lot.photoUrls[0] ?? null} alt={lot.title} />
                <span className="product-name">{lot.title}</span>
                {lot.highestBid === null ? (
                  <span className="product-from">ราคาเริ่มต้น {formatBaht(lot.startingPrice)}</span>
                ) : (
                  <span className="product-price">{formatBaht(lot.highestBid)}</span>
                )}
                <span className="product-from">{lot.bidCount} ครั้งที่เสนอราคา</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
