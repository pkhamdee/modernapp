import { useState, type FormEvent } from 'react'
import { backOfficePaths, TERMS, updateProductCategory, type BackOfficeProductCategory } from '../../api/backOffice.ts'
import { problemMessage, useReloadableApi } from '../../api/client.ts'
import { ResponsiveList } from '../../components/ResponsiveList.tsx'
import { Status } from '../../components/Status.tsx'
import { formatFlatRate } from '../../format.ts'

/** Each Product Category's Flat Rate and longest Term. A change applies to the calculator immediately. */
export function StaffProductCategoriesPage() {
  const [categories, reload] = useReloadableApi<BackOfficeProductCategory[]>(backOfficePaths.productCategories())

  if (categories.status !== 'success') return <Status state={categories} />

  return (
    <section>
      <h1>ประเภทสินค้า</h1>
      <p className="muted">
        อัตราดอกเบี้ยคงที่ต่อเดือนและจำนวนงวดสูงสุด มีผลกับเครื่องคำนวณค่างวดทันที
        แต่ไม่เปลี่ยนคำขอเช่าซื้อหรือข้อเสนอที่ส่งไปแล้ว
      </p>
      <ResponsiveList
        label="ประเภทสินค้า"
        rows={categories.data}
        rowKey={(c) => c.code}
        columns={[
          { label: 'ประเภทสินค้า', cell: (c) => c.name },
          { label: 'อัตราดอกเบี้ยคงที่', cell: (c) => `${formatFlatRate(c.flatRate)} ต่อเดือน` },
          { label: 'งวดสูงสุด', cell: (c) => `${c.longestTerm} งวด`, align: 'end' },
          { label: 'สินค้าที่ขายอยู่', cell: (c) => `${c.activeProducts} รายการ`, align: 'end' },
          {
            label: 'เปลี่ยนการตั้งค่า',
            block: true,
            // Keyed by the saved settings, so the fields start again from them after a save.
            cell: (c) => <CategorySettings key={`${c.code}-${c.flatRate}-${c.longestTerm}`} category={c} onSaved={reload} />,
          },
        ]}
      />
    </section>
  )
}

function CategorySettings({ category, onSaved }: { category: BackOfficeProductCategory; onSaved: () => void }) {
  // Edited as a percentage (1.5) and sent as a fraction (0.015).
  const [percent, setPercent] = useState(String(Number((category.flatRate * 100).toFixed(2))))
  const [longestTerm, setLongestTerm] = useState(category.longestTerm)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const rate = Number(percent)
    if (!Number.isFinite(rate) || rate <= 0 || rate > 10) {
      setMessage({ error: true, text: 'อัตราดอกเบี้ยคงที่ต้องมากกว่า 0% และไม่เกิน 10% ต่อเดือน' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      await updateProductCategory(category.code, { flatRate: Number((rate / 100).toFixed(4)), longestTerm })
      setMessage({ error: false, text: 'บันทึกแล้ว' })
      onSaved()
    } catch (e) {
      setMessage({ error: true, text: problemMessage(e, 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="category-settings" aria-label={`ตั้งค่า${category.name}`} noValidate>
      <div className="staff-inline-fields">
        <label className="form-field">
          <span>อัตราดอกเบี้ยคงที่ (% ต่อเดือน)</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0.01}
            max={10}
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
          />
        </label>
        <label className="form-field">
          <span>งวดสูงสุด</span>
          <select value={longestTerm} onChange={(e) => setLongestTerm(Number(e.target.value))}>
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {t} งวด
              </option>
            ))}
          </select>
        </label>
      </div>
      {message && (
        <p className={message.error ? 'form-error' : 'form-notice'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      <button type="submit" className="button button-small" disabled={saving}>
        {saving ? 'กำลังบันทึก…' : 'บันทึก'}
      </button>
    </form>
  )
}
