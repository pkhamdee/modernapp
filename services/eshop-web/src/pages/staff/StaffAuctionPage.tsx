import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import {
  addLot,
  auctionPaths,
  auctionStatusLabel,
  editLot,
  forfeitLot,
  lotStatusLabel,
  recordLotPayment,
  reofferLot,
  uploadLotPhoto,
  type Auction,
  type Lot,
} from '../../api/auctions.ts'
import { formatMobileNumber } from '../../api/auth.ts'
import { backOfficePaths, type BackOfficeBranch } from '../../api/backOffice.ts'
import { problemMessage, useApi, useReloadableApi } from '../../api/client.ts'
import { ProductPhoto } from '../../components/ProductPhoto.tsx'
import { ResponsiveList } from '../../components/ResponsiveList.tsx'
import { Status } from '../../components/Status.tsx'
import { formatBaht, formatDateTime } from '../../format.ts'

const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const MAX_PHOTOS = 10

/** One Auction (/staff/auctions/:id): its Lots with bids so far, adding a Lot, and correcting one before its first Bid. */
export function StaffAuctionPage() {
  const { id = '' } = useParams()
  const [auction, reload] = useReloadableApi<Auction>(auctionPaths.backOfficeAuction(id))
  const [editing, setEditing] = useState<number | 'new' | null>(null)

  if (auction.status !== 'success') return <Status state={auction} />
  const a = auction.data
  const closed = a.status === 'closed'

  return (
    <section>
      <Link to="/staff/auctions" className="back-link">
        ‹ การประมูลทั้งหมด
      </Link>
      <div className="staff-toolbar">
        <h1>การประมูล #{a.id}</h1>
        {!closed && editing === null && (
          <button type="button" className="button button-small" onClick={() => setEditing('new')}>
            + เพิ่มรายการ
          </button>
        )}
      </div>
      <p className="muted">
        {auctionStatusLabel[a.status]} · {formatDateTime(a.opensAt)} – {formatDateTime(a.closesAt)}
      </p>
      {editing === 'new' && (
        <LotForm
          auctionId={a.id}
          lot={null}
          onDone={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
      {typeof editing === 'number' && (
        <LotForm
          auctionId={a.id}
          lot={a.lots.find((lot) => lot.id === editing) ?? null}
          onDone={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
      {a.lots.length > 0 && (
        <ResponsiveList
          label="รายการประมูล"
          rows={a.lots}
          rowKey={(lot) => lot.id}
          columns={[
            {
              label: 'รายการ',
              cell: (lot) => (
                <span className="list-title">
                  <ProductPhoto src={lot.photoUrls[0] ?? null} alt="" />
                  {lot.title}
                </span>
              ),
            },
            { label: 'ราคาเริ่มต้น', cell: (lot) => formatBaht(lot.startingPrice), align: 'end' },
            { label: 'รูป', cell: (lot) => `${lot.photoUrls.length} รูป`, align: 'end' },
            {
              label: 'การเสนอราคา',
              cell: (lot) =>
                lot.highestBid === null
                  ? 'ยังไม่มีผู้เสนอราคา'
                  : `สูงสุด ${formatBaht(lot.highestBid)} (${lot.bidCount} ครั้ง)`,
            },
            {
              label: 'จัดการ',
              block: true,
              cell: (lot) => (
                <div className="lot-manage">
                  <div className="staff-actions">
                    <Link to={`/auction/lots/${lot.id}`} className="button button-small button-outline">
                      ดูหน้าประมูล
                    </Link>
                    {!closed && lot.bidCount === 0 && editing === null && (
                      <button
                        type="button"
                        className="button button-small button-outline"
                        onClick={() => setEditing(lot.id)}
                      >
                        แก้ไข
                      </button>
                    )}
                  </div>
                  {closed && <LotAfterClose lot={lot} auctionId={a.id} onChange={reload} />}
                </div>
              ),
            },
          ]}
        />
      )}
      {a.lots.length === 0 && editing === null && <p className="muted">ยังไม่มีรายการประมูล</p>}
    </section>
  )
}

/**
 * A closed Auction's Lot: the winner and the 3-day cash payment, recording payment + Handover at a Branch,
 * marking it Forfeited after 3 days unpaid, and offering a Forfeited or unsold Lot again in a later Auction.
 */
function LotAfterClose({ lot, auctionId, onChange }: { lot: Lot; auctionId: number; onChange: () => void }) {
  const sale = lot.sale
  const awaiting = lot.lotStatus === 'awaiting-payment'
  const reofferable = (lot.lotStatus === 'forfeited' || lot.lotStatus === 'unsold') && lot.reofferedAsLotId === null
  const branches = useApi<BackOfficeBranch[]>(awaiting ? backOfficePaths.branches() : null)
  const auctions = useApi<Auction[]>(reofferable ? auctionPaths.backOfficeAuctions() : null)
  const [branchCode, setBranchCode] = useState('')
  const [targetAuction, setTargetAuction] = useState('')
  const [startingPrice, setStartingPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function act(action: () => Promise<unknown>, fallback: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChange()
    } catch (e) {
      setError(problemMessage(e, fallback))
    } finally {
      setBusy(false)
    }
  }

  const laterAuctions =
    auctions.status === 'success' ? auctions.data.filter((x) => x.id !== auctionId && x.status !== 'closed') : []
  const activeBranches = branches.status === 'success' ? branches.data.filter((b) => !b.isRetired) : []

  return (
    <div className="lot-after-close">
      <strong>{lotStatusLabel[lot.lotStatus]}</strong>
      {sale && (
        <span className="muted">
          ผู้ชนะ {sale.winnerFullName ?? `ลูกค้า #${sale.winnerCustomerId}`}
          {sale.winnerMobileNumber ? ` (${formatMobileNumber(sale.winnerMobileNumber)})` : ''} · {formatBaht(sale.amount)} ·
          ชำระภายใน {formatDateTime(sale.paymentDueAt)}
          {sale.paidAt && ` · ชำระแล้ว ${formatDateTime(sale.paidAt)} ที่ ${sale.paymentBranchCode} โดย ${sale.paymentRecordedBy}`}
          {sale.forfeitedAt && ` · ริบสิทธิ์ ${formatDateTime(sale.forfeitedAt)}`}
        </span>
      )}
      {lot.reofferedAsLotId !== null && (
        <Link to={`/auction/lots/${lot.reofferedAsLotId}`}>นำกลับมาประมูลแล้ว (รายการ #{lot.reofferedAsLotId})</Link>
      )}
      {awaiting && (
        <div className="staff-actions">
          <select value={branchCode} onChange={(e) => setBranchCode(e.target.value)} aria-label="สาขาที่รับชำระ">
            <option value="">เลือกสาขาที่รับชำระ</option>
            {activeBranches.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button button-small"
            disabled={busy || !branchCode}
            onClick={() => act(() => recordLotPayment(lot.id, branchCode), 'บันทึกการชำระเงินไม่สำเร็จ')}
          >
            บันทึกรับเงินสดและส่งมอบ
          </button>
          <button
            type="button"
            className="button button-small button-outline"
            disabled={busy || !sale?.mayForfeit}
            title={sale?.mayForfeit ? undefined : 'ริบสิทธิ์ได้เมื่อครบ 3 วันแล้วยังไม่ชำระ'}
            onClick={() => {
              if (window.confirm('ริบสิทธิ์ผู้ชนะรายการนี้? (ไม่ส่งต่อให้ผู้เสนอราคาอันดับสอง)')) {
                void act(() => forfeitLot(lot.id), 'ริบสิทธิ์ไม่สำเร็จ')
              }
            }}
          >
            ริบสิทธิ์
          </button>
        </div>
      )}
      {reofferable && (
        <div className="staff-actions">
          <select value={targetAuction} onChange={(e) => setTargetAuction(e.target.value)} aria-label="การประมูลครั้งถัดไป">
            <option value="">เลือกการประมูลครั้งถัดไป</option>
            {laterAuctions.map((x) => (
              <option key={x.id} value={x.id}>
                #{x.id} · {formatDateTime(x.opensAt)}
              </option>
            ))}
          </select>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            placeholder={`ราคาเริ่มต้น ${lot.startingPrice}`}
            value={startingPrice}
            onChange={(e) => setStartingPrice(e.target.value)}
            aria-label="ราคาเริ่มต้นใหม่ (บาท)"
          />
          <button
            type="button"
            className="button button-small"
            disabled={busy || !targetAuction}
            onClick={() =>
              act(
                () => reofferLot(lot.id, Number(targetAuction), startingPrice ? Number(startingPrice) : undefined),
                'นำกลับมาประมูลไม่สำเร็จ',
              )
            }
          >
            นำกลับมาประมูล
          </button>
        </div>
      )}
      {reofferable && auctions.status === 'success' && laterAuctions.length === 0 && (
        <span className="muted">สร้างการประมูลครั้งถัดไปก่อน แล้วจึงนำรายการนี้กลับมาประมูล</span>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function LotForm({ auctionId, lot, onDone }: { auctionId: number; lot: Lot | null; onDone: () => void }) {
  const [title, setTitle] = useState(lot?.title ?? '')
  const [conditionNotes, setConditionNotes] = useState(lot?.conditionNotes ?? '')
  const [startingPrice, setStartingPrice] = useState(lot ? String(lot.startingPrice) : '')
  const [photos, setPhotos] = useState<{ imageId: string; imageUrl: string }[]>(
    lot ? lot.imageIds.map((imageId, i) => ({ imageId, imageUrl: lot.photoUrls[i] ?? '' })) : [],
  )
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onPhotos(files: FileList | null) {
    if (!files || files.length === 0) return
    const chosen = Array.from(files)
    if (chosen.some((f) => f.size > MAX_PHOTO_BYTES)) {
      setError('รูปภาพต้องมีขนาดไม่เกิน 10 MB')
      return
    }
    if (photos.length + chosen.length > MAX_PHOTOS) {
      setError(`แนบรูปได้ไม่เกิน ${MAX_PHOTOS} รูป`)
      return
    }
    setUploading(true)
    setError(null)
    try {
      const uploaded: { imageId: string; imageUrl: string }[] = []
      for (const file of chosen) uploaded.push(await uploadLotPhoto(file))
      setPhotos((current) => [...current, ...uploaded])
    } catch (e) {
      setError(problemMessage(e, 'อัปโหลดรูปไม่สำเร็จ ใช้ได้เฉพาะไฟล์ JPEG, PNG หรือ WebP'))
    } finally {
      setUploading(false)
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const price = Number(startingPrice)
    if (!title.trim() || !Number.isInteger(price) || price <= 0 || photos.length === 0) {
      setError('กรุณากรอกรุ่น ราคาเริ่มต้น (จำนวนเต็มบาท) และแนบรูปอย่างน้อย 1 รูป')
      return
    }
    setSaving(true)
    setError(null)
    const input = { title, conditionNotes, startingPrice: price, imageIds: photos.map((p) => p.imageId) }
    try {
      await (lot ? editLot(lot.id, input) : addLot(auctionId, input))
      onDone()
    } catch (e) {
      setError(problemMessage(e, 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="card form staff-form" noValidate>
      <h2>{lot ? 'แก้ไขรายการประมูล' : 'เพิ่มรายการประมูล'}</h2>
      <p className="muted">iPhone มือสอง 1 เครื่อง พร้อมกล่อง</p>
      <div className="staff-field-pair">
        <label className="form-field">
          <span>รุ่น ความจุ และสี</span>
          <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="form-field">
          <span>ราคาเริ่มต้น (บาท)</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={startingPrice}
            onChange={(e) => setStartingPrice(e.target.value)}
            required
          />
        </label>
      </div>
      <label className="form-field">
        <span>สภาพเครื่อง</span>
        <textarea value={conditionNotes} maxLength={2000} rows={3} onChange={(e) => setConditionNotes(e.target.value)} />
      </label>
      <div className="form-field">
        <span>รูปถ่าย ({photos.length}/{MAX_PHOTOS})</span>
        <div className="lot-photo-grid">
          {photos.map((p, i) => (
            <div key={p.imageId} className="lot-photo-item">
              <ProductPhoto src={p.imageUrl} alt={`รูปที่ ${i + 1}`} />
              <button
                type="button"
                className="button button-small button-outline"
                onClick={() => setPhotos((current) => current.filter((x) => x.imageId !== p.imageId))}
              >
                ลบรูป
              </button>
            </div>
          ))}
        </div>
        <label className="button button-small button-outline file-button">
          {uploading ? 'กำลังอัปโหลด…' : 'เพิ่มรูป'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={uploading || photos.length >= MAX_PHOTOS}
            onChange={(e) => onPhotos(e.target.files)}
          />
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="staff-actions">
        <button type="submit" className="button" disabled={saving || uploading}>
          {saving ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
        <button type="button" className="button button-secondary" onClick={onDone} disabled={saving}>
          ยกเลิก
        </button>
      </div>
    </form>
  )
}
