import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { auctionPaths, auctionStatusLabel, createAuction, type Auction } from '../../api/auctions.ts'
import { problemMessage, useApi } from '../../api/client.ts'
import { ResponsiveList } from '../../components/ResponsiveList.tsx'
import { Status } from '../../components/Status.tsx'
import { formatDateTime } from '../../format.ts'

/** "2026-11-02T10:00" typed in a datetime-local field means Bangkok time. */
const bangkokIso = (local: string) => (local ? `${local}:00+07:00` : undefined)

/** Auctions, newest first, and creating one (the weekly schedule unless Staff choose other times). */
export function StaffAuctionsPage() {
  const auctions = useApi<Auction[]>(auctionPaths.backOfficeAuctions())
  const navigate = useNavigate()
  const [custom, setCustom] = useState(false)
  const [opensAt, setOpensAt] = useState('')
  const [closesAt, setClosesAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const auction = await createAuction(custom ? { opensAt: bangkokIso(opensAt), closesAt: bangkokIso(closesAt) } : {})
      navigate(`/staff/auctions/${auction.id}`)
    } catch (e) {
      setError(problemMessage(e, 'สร้างการประมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'))
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="staff-toolbar">
        <h1>การประมูล</h1>
      </div>
      <form onSubmit={onCreate} className="card form" noValidate>
        <h2>สร้างการประมูลใหม่</h2>
        <p className="muted">ตามรอบปกติ: เปิดวันจันทร์ 10:00 น. ปิดวันอาทิตย์ 20:00 น. (เวลาประเทศไทย) ของสัปดาห์ถัดไป</p>
        <label className="form-choice">
          <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} /> กำหนดเวลาเอง
        </label>
        {custom && (
          <div className="staff-inline-fields">
            <label className="form-field">
              <span>เปิดประมูล</span>
              <input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
            </label>
            <label className="form-field">
              <span>ปิดประมูล</span>
              <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
            </label>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={saving}>
          {saving ? 'กำลังสร้าง…' : 'สร้างการประมูล'}
        </button>
      </form>

      {auctions.status !== 'success' ? (
        <Status state={auctions} />
      ) : auctions.data.length === 0 ? (
        <p className="muted">ยังไม่มีการประมูล</p>
      ) : (
        <ResponsiveList
          label="การประมูล"
          rows={auctions.data}
          rowKey={(a) => a.id}
          rowLink={(a) => `/staff/auctions/${a.id}`}
          columns={[
            { label: 'การประมูล', cell: (a) => `การประมูล #${a.id}` },
            { label: 'สถานะ', cell: (a) => auctionStatusLabel[a.status] },
            { label: 'เปิดประมูล', cell: (a) => formatDateTime(a.opensAt) },
            { label: 'ปิดประมูล', cell: (a) => formatDateTime(a.closesAt) },
            { label: 'รายการ', cell: (a) => `${a.lots.length} รายการ`, align: 'end' },
          ]}
        />
      )}
    </section>
  )
}
