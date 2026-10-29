import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { addLot, auctionPaths, auctionStatusLabel, editLot, uploadLotPhoto, type Auction, type Lot } from '../../api/auctions.ts'
import { problemMessage, useReloadableApi } from '../../api/client.ts'
import { ProductPhoto } from '../../components/ProductPhoto.tsx'
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
      <ul className="staff-list">
        {a.lots.map((lot) =>
          editing === lot.id ? (
            <li key={lot.id}>
              <LotForm
                auctionId={a.id}
                lot={lot}
                onDone={() => {
                  setEditing(null)
                  reload()
                }}
              />
            </li>
          ) : (
            <li key={lot.id} className="staff-item">
              <ProductPhoto src={lot.photoUrls[0] ?? null} alt="" />
              <div className="staff-item-body">
                <strong>{lot.title}</strong>
                <span className="muted">
                  เริ่มต้น {formatBaht(lot.startingPrice)} · {lot.photoUrls.length} รูป ·{' '}
                  {lot.highestBid === null ? 'ยังไม่มีผู้เสนอราคา' : `สูงสุด ${formatBaht(lot.highestBid)} (${lot.bidCount} ครั้ง)`}
                </span>
                <div className="staff-actions">
                  <Link to={`/auction/lots/${lot.id}`} className="button button-small button-outline">
                    ดูหน้าประมูล
                  </Link>
                  {!closed && lot.bidCount === 0 && editing === null && (
                    <button type="button" className="button button-small button-outline" onClick={() => setEditing(lot.id)}>
                      แก้ไข
                    </button>
                  )}
                </div>
              </div>
            </li>
          ),
        )}
      </ul>
      {a.lots.length === 0 && editing === null && <p className="muted">ยังไม่มีรายการประมูล</p>}
    </section>
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
    <form onSubmit={onSubmit} className="card form" noValidate>
      <h2>{lot ? 'แก้ไขรายการประมูล' : 'เพิ่มรายการประมูล'}</h2>
      <p className="muted">iPhone มือสอง 1 เครื่อง พร้อมกล่อง</p>
      <label className="form-field">
        <span>รุ่น ความจุ และสี</span>
        <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label className="form-field">
        <span>สภาพเครื่อง</span>
        <textarea value={conditionNotes} maxLength={2000} rows={3} onChange={(e) => setConditionNotes(e.target.value)} />
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
