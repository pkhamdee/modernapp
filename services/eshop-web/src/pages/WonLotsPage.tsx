import { Link } from 'react-router'
import { auctionPaths, lotStatusLabel, type Lot } from '../api/auctions.ts'
import { useApi } from '../api/client.ts'
import { Status } from '../components/Status.tsx'
import { formatBaht, formatDateTime } from '../format.ts'
import { WinnerNotice } from './LotPage.tsx'

/** The signed-in Customer's won Lots (/won-lots): what to pay, where and by when. */
export function WonLotsPage() {
  const lots = useApi<Lot[]>(auctionPaths.wonLots())

  return (
    <section>
      <h1>ประมูลที่ชนะ</h1>
      {lots.status !== 'success' ? (
        <Status state={lots} />
      ) : lots.data.length === 0 ? (
        <p className="muted">
          ยังไม่มีรายการที่คุณชนะ <Link to="/auction">ดูการประมูล</Link>
        </p>
      ) : (
        lots.data.map((lot) => (
          <article key={lot.id} className="card">
            <h2>
              <Link to={`/auction/lots/${lot.id}`}>{lot.title}</Link>
            </h2>
            <p className="muted">
              ราคาที่ชนะ {formatBaht(lot.highestBid ?? 0)} · ปิดประมูล {formatDateTime(lot.closesAt)} ·{' '}
              {lotStatusLabel[lot.lotStatus]}
            </p>
            <WinnerNotice lot={lot} />
          </article>
        ))
      )}
    </section>
  )
}
