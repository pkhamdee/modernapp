import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  addProduct,
  backOfficePaths,
  editProduct,
  uploadProductPhoto,
  type BackOfficeProduct,
  type BackOfficeProductCategory,
} from '../../api/backOffice.ts'
import { problemMessage, useApi } from '../../api/client.ts'
import { ProductPhoto } from '../../components/ProductPhoto.tsx'
import { Status } from '../../components/Status.tsx'

const MAX_PHOTO_BYTES = 10 * 1024 * 1024

/** Add (/staff/products/new) or edit (/staff/products/:id) a Product, with photo upload. */
export function StaffProductFormPage() {
  const { id } = useParams()
  const productId = id === undefined ? null : Number(id)
  const categories = useApi<BackOfficeProductCategory[]>(backOfficePaths.productCategories())
  // The back-office list is the only place retired Products are visible, so edit loads from it.
  const products = useApi<BackOfficeProduct[]>(productId === null ? null : backOfficePaths.products())

  if (categories.status !== 'success') return <Status state={categories} />
  if (productId === null) return <ProductForm categories={categories.data} product={null} />
  if (products.status !== 'success') return <Status state={products} />

  const product = products.data.find((p) => p.id === productId)
  if (!product) {
    return (
      <section className="card">
        <h1>ไม่พบสินค้า</h1>
        <Link to="/staff/products">กลับไปหน้าสินค้า</Link>
      </section>
    )
  }
  return <ProductForm key={product.id} categories={categories.data} product={product} />
}

function ProductForm({ categories, product }: { categories: BackOfficeProductCategory[]; product: BackOfficeProduct | null }) {
  const navigate = useNavigate()
  const [category, setCategory] = useState(product?.productCategoryCode ?? categories[0]?.code ?? '')
  const [name, setName] = useState(product?.name ?? '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [price, setPrice] = useState(product ? String(product.price) : '')
  const [photo, setPhoto] = useState<{ imageId: string; imageUrl: string } | null>(
    product?.imageId && product.imageUrl ? { imageId: product.imageId, imageUrl: product.imageUrl } : null,
  )
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onPhoto(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_PHOTO_BYTES) {
      setError('รูปภาพต้องมีขนาดไม่เกิน 10 MB')
      return
    }
    setUploading(true)
    setError(null)
    try {
      setPhoto(await uploadProductPhoto(file))
    } catch (e) {
      setError(problemMessage(e, 'อัปโหลดรูปไม่สำเร็จ ใช้ได้เฉพาะไฟล์ JPEG, PNG หรือ WebP'))
    } finally {
      setUploading(false)
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = Number(price)
    if (!name.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError('กรุณากรอกชื่อสินค้าและราคาที่มากกว่า 0 บาท')
      return
    }
    setSaving(true)
    setError(null)
    const input = { productCategoryCode: category, name, description, price: amount, imageId: photo?.imageId ?? null }
    try {
      await (product ? editProduct(product.id, input) : addProduct(input))
      navigate('/staff/products')
    } catch (e) {
      setError(problemMessage(e, 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'))
      setSaving(false)
    }
  }

  return (
    <section className="card staff-form">
      <Link to="/staff/products" className="back-link">
        ‹ สินค้าทั้งหมด
      </Link>
      <h1>{product ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'}</h1>
      {product && (
        <p className="muted">การเปลี่ยนราคาไม่มีผลกับคำขอเช่าซื้อและข้อเสนอที่ส่งไปแล้ว</p>
      )}
      <form onSubmit={onSubmit} className="form" noValidate>
        <label className="form-field">
          <span>ชื่อสินค้า</span>
          <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} required />
        </label>
        <div className="staff-field-pair">
          <label className="form-field">
            <span>ประเภทสินค้า</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>ราคา (บาท)</span>
            <input
              type="number"
              inputMode="decimal"
              min={1}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </label>
        </div>
        <label className="form-field">
          <span>รายละเอียด</span>
          <textarea value={description} maxLength={2000} rows={3} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="form-field">
          <span>รูปสินค้า</span>
          <div className="photo-field">
            <ProductPhoto src={photo?.imageUrl ?? null} alt="รูปสินค้า" />
            <div className="photo-actions">
              <label className="button button-small button-outline file-button">
                {uploading ? 'กำลังอัปโหลด…' : photo ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={uploading}
                  onChange={(e) => onPhoto(e.target.files?.[0])}
                />
              </label>
              {photo && (
                <button type="button" className="button button-small button-outline" onClick={() => setPhoto(null)}>
                  ลบรูป
                </button>
              )}
            </div>
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={saving || uploading}>
          {saving ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </form>
    </section>
  )
}
