import { useState } from 'react'
import { Link } from 'react-router'
import {
  backOfficePaths,
  reinstateProduct,
  retireProduct,
  type BackOfficeProduct,
  type BackOfficeProductCategory,
} from '../../api/backOffice.ts'
import { useApi, useReloadableApi } from '../../api/client.ts'
import { ProductPhoto } from '../../components/ProductPhoto.tsx'
import { ResponsiveList } from '../../components/ResponsiveList.tsx'
import { Status } from '../../components/Status.tsx'
import { formatBaht } from '../../format.ts'

/** Every Product, retired ones included, grouped by Product Category; retire or reinstate in place. */
export function StaffProductsPage() {
  const categories = useApi<BackOfficeProductCategory[]>(backOfficePaths.productCategories())
  const [products, reload] = useReloadableApi<BackOfficeProduct[]>(backOfficePaths.products())
  const [category, setCategory] = useState<string>('')
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggleRetired(product: BackOfficeProduct) {
    if (!product.isRetired && !window.confirm(`เลิกขาย "${product.name}"? สินค้าจะหายไปจากหน้าร้าน`)) return
    setBusy(product.id)
    setError(null)
    try {
      await (product.isRetired ? reinstateProduct(product.id) : retireProduct(product.id))
      reload()
    } catch {
      setError('บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setBusy(null)
    }
  }

  if (products.status !== 'success' || categories.status !== 'success') {
    return <Status state={products.status !== 'success' ? products : categories} />
  }

  const shown = products.data.filter((p) => !category || p.productCategoryCode === category)
  const categoryName = (code: string) => categories.data.find((c) => c.code === code)?.name ?? code

  return (
    <section>
      <div className="staff-toolbar">
        <h1>สินค้า</h1>
        <Link to="/staff/products/new" className="button button-small">
          + เพิ่มสินค้า
        </Link>
      </div>
      <label className="form-field">
        <span>ประเภทสินค้า</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">ทั้งหมด</option>
          {categories.data.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {shown.length > 0 && (
        <ResponsiveList
          label="สินค้า"
          rows={shown}
          rowKey={(p) => p.id}
          dimmed={(p) => p.isRetired}
          columns={[
            {
              label: 'สินค้า',
              cell: (p) => (
                <span className="list-title">
                  <ProductPhoto src={p.imageUrl} alt="" />
                  {p.name}
                </span>
              ),
            },
            { label: 'ประเภทสินค้า', cell: (p) => categoryName(p.productCategoryCode) },
            { label: 'ราคา', cell: (p) => formatBaht(p.price), align: 'end' },
            { label: 'สถานะ', cell: (p) => (p.isRetired ? 'เลิกขายแล้ว' : 'ขายอยู่') },
            {
              label: 'จัดการ',
              cell: (p) => (
                <div className="staff-actions">
                  <Link to={`/staff/products/${p.id}`} className="button button-small button-outline">
                    แก้ไข
                  </Link>
                  <button
                    type="button"
                    className="button button-small button-outline"
                    disabled={busy === p.id}
                    onClick={() => toggleRetired(p)}
                  >
                    {p.isRetired ? 'กลับมาขาย' : 'เลิกขาย'}
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}
      {shown.length === 0 && <p className="muted">ยังไม่มีสินค้าในประเภทนี้</p>}
    </section>
  )
}
