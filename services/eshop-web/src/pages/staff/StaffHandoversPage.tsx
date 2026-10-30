import { useSearchParams } from 'react-router'
import { backOfficePaths, type BackOfficeBranch } from '../../api/backOffice.ts'
import { useApi } from '../../api/client.ts'
import { HANDOVER_STAGE_LABELS, handoverPaths, type Handover } from '../../api/handovers.ts'
import { ResponsiveList } from '../../components/ResponsiveList.tsx'
import { Status } from '../../components/Status.tsx'
import { formatBaht } from '../../format.ts'

/** Contracts awaiting Handover, oldest first, filterable by Branch and by Delivery or Store Pickup. */
export function StaffHandoversPage() {
  const [params, setParams] = useSearchParams()
  const branch = params.get('branch') ?? ''
  const method = params.get('method') ?? ''
  const branches = useApi<BackOfficeBranch[]>(backOfficePaths.branches())
  const handovers = useApi<Handover[]>(handoverPaths.awaiting({ branch, method }))

  function setFilter(name: 'branch' | 'method', value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value)
    else next.delete(name)
    // Store Pickup is the only method with a Branch.
    if (name === 'branch' && value) next.set('method', 'store-pickup')
    if (name === 'method' && value === 'delivery') next.delete('branch')
    setParams(next, { replace: true })
  }

  return (
    <section>
      <div className="staff-toolbar">
        <h1>รอส่งมอบสินค้า</h1>
      </div>
      <div className="staff-inline-fields">
        <label className="form-field">
          วิธีรับสินค้า
          <select value={method} onChange={(e) => setFilter('method', e.target.value)}>
            <option value="">ทั้งหมด</option>
            <option value="store-pickup">รับที่สาขา</option>
            <option value="delivery">จัดส่ง</option>
          </select>
        </label>
        <label className="form-field">
          สาขา
          <select value={branch} onChange={(e) => setFilter('branch', e.target.value)}>
            <option value="">ทุกสาขา</option>
            {branches.status === 'success' &&
              branches.data.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
      </div>

      {handovers.status !== 'success' ? (
        <Status state={handovers} />
      ) : handovers.data.length === 0 ? (
        <p className="muted">ไม่มีสัญญาที่รอส่งมอบสินค้า</p>
      ) : (
        <ResponsiveList
          label="รอส่งมอบสินค้า"
          rows={handovers.data}
          rowKey={(h) => h.contractNumber}
          rowLink={(h) => `/staff/handovers/${h.contractNumber}`}
          columns={[
            { label: 'สัญญา', cell: (h) => h.contractNumber },
            { label: 'สินค้า', cell: (h) => h.product.name },
            { label: 'ลูกค้า', cell: (h) => h.customer.fullName },
            {
              label: 'วิธีรับสินค้า',
              cell: (h) =>
                h.method === 'delivery' ? `จัดส่ง ${h.deliveryProvince ?? ''}` : `รับที่${h.branch?.name ?? 'สาขา'}`,
            },
            { label: 'ขั้นตอน', cell: (h) => HANDOVER_STAGE_LABELS[h.stage] },
            {
              label: 'เงินดาวน์',
              cell: (h) =>
                h.downPayment > 0
                  ? `${formatBaht(h.downPayment)} · ${h.downPaymentReceived === null ? 'ยังไม่ได้รับ' : 'รับแล้ว'}`
                  : 'ไม่มี',
            },
          ]}
        />
      )}
    </section>
  )
}
