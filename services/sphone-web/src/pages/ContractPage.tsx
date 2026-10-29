import { useEffect } from 'react'
import { Link, useParams } from 'react-router'
import { formatThaiDate } from '../api/applications.ts'
import { useApi, useReloadableApi } from '../api/client.ts'
import {
  CONTRACT_POLL_MS,
  CONTRACT_STATUS_LABELS,
  contractPaths,
  CUSTOMER_HANDOVER_STAGE_LABELS,
  PAYMENT_CHANNEL_LABELS,
  type Contract,
  type ContractSummary,
} from '../api/contracts.ts'
import { Status } from '../components/Status.tsx'
import { formatBaht } from '../format.ts'

/**
 * One Contract: number, Product, status and Payments as known by the Enterprise System, and the Installment
 * schedule (due dates are set at Handover). Re-read every sync interval so new Payments show up by themselves.
 */
export function ContractPage() {
  const { number = '' } = useParams()
  const [contract, reload] = useReloadableApi<Contract>(contractPaths.contract(number))

  useEffect(() => {
    const timer = window.setInterval(reload, CONTRACT_POLL_MS)
    return () => window.clearInterval(timer)
  }, [reload])

  if (contract.status !== 'success') return <Status state={contract} />
  const c = contract.data

  return (
    <section className="card application">
      <Link to="/contracts" className="back-link">
        ← สัญญาของฉัน
      </Link>
      <h1>สัญญาเช่าซื้อ</h1>
      <p className="contract-number">{c.number}</p>
      <dl className="terms">
        <div>
          <dt>สินค้า</dt>
          <dd>{c.product.name}</dd>
        </div>
        <div>
          <dt>สถานะ</dt>
          <dd>
            {CONTRACT_STATUS_LABELS[c.status]}
            {c.cancelledAt && ` เมื่อ ${formatThaiDate(c.cancelledAt)}`}
          </dd>
        </div>
        <div>
          <dt>ราคา</dt>
          <dd>{formatBaht(c.price)}</dd>
        </div>
        <div>
          <dt>เงินดาวน์ (ชำระวันรับสินค้า)</dt>
          <dd>{formatBaht(c.downPayment)}</dd>
        </div>
        <div>
          <dt>ค่างวด</dt>
          <dd>
            {formatBaht(c.installment)} × {c.term} งวด
          </dd>
        </div>
        <div>
          <dt>ยอดชำระทั้งหมด</dt>
          <dd>{formatBaht(c.totalPayable)}</dd>
        </div>
        <div>
          <dt>ทำสัญญาเมื่อ</dt>
          <dd>{formatThaiDate(c.acceptedAt)}</dd>
        </div>
        <div>
          <dt>การรับสินค้า</dt>
          <dd>
            {c.handover === 'delivery'
              ? `จัดส่งที่ ${c.deliveryAddress ?? ''} ${c.deliveryProvince ?? ''}`
              : `รับที่${c.branch?.name ?? 'สาขา'}`}
          </dd>
        </div>
        <div>
          <dt>สถานะการส่งมอบ</dt>
          <dd className="handover-stage">
            {CUSTOMER_HANDOVER_STAGE_LABELS[c.handoverStage]}
            {c.handedOverAt && ` เมื่อ ${formatThaiDate(c.handedOverAt)}`}
          </dd>
        </div>
      </dl>

      <h2>ตารางผ่อนชำระ</h2>
      {c.installments.some((i) => i.dueDate === null) && (
        <p className="muted">กำหนดชำระจะแสดงหลังรับสินค้า งวดแรกครบกำหนด 1 เดือนหลังวันรับสินค้า</p>
      )}
      <table className="schedule">
        <thead>
          <tr>
            <th scope="col">งวดที่</th>
            <th scope="col">กำหนดชำระ</th>
            <th scope="col">ค่างวด</th>
          </tr>
        </thead>
        <tbody>
          {c.installments.map((i) => (
            <tr key={i.number}>
              <td>{i.number}</td>
              <td>{i.dueDate ? formatThaiDate(i.dueDate) : 'รอรับสินค้า'}</td>
              <td>{formatBaht(i.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>การชำระเงิน</h2>
      {c.payments.length === 0 ? (
        <p className="muted">ยังไม่มีการชำระค่างวด</p>
      ) : (
        <table className="schedule">
          <thead>
            <tr>
              <th scope="col">วันที่ชำระ</th>
              <th scope="col">งวดที่</th>
              <th scope="col">ช่องทาง</th>
              <th scope="col">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            {c.payments.map((p, index) => (
              <tr key={`${p.paidAt}-${index}`}>
                <td>{formatThaiDate(p.paidAt)}</td>
                <td>{p.installmentNumber ?? '–'}</td>
                <td>{PAYMENT_CHANNEL_LABELS[p.channel] ?? p.channel}</td>
                <td>{formatBaht(p.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                ชำระแล้วทั้งหมด
              </th>
              <td>{formatBaht(c.amountPaid)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      <p className="muted">สถานะและการชำระเงินมาจากระบบสัญญาของบริษัท อาจล่าช้าได้ไม่เกิน 30 วินาที</p>
    </section>
  )
}

/** The signed-in Customer's Contracts. */
export function ContractsPage() {
  const contracts = useApi<ContractSummary[]>(contractPaths.contracts())

  if (contracts.status !== 'success') return <Status state={contracts} />

  return (
    <section className="card">
      <h1>สัญญาของฉัน</h1>
      {contracts.data.length === 0 ? (
        <p className="muted">ยังไม่มีสัญญาเช่าซื้อ</p>
      ) : (
        <ul className="contract-list">
          {contracts.data.map((c) => (
            <li key={c.number}>
              <Link to={`/contracts/${c.number}`}>
                <strong>{c.number}</strong>
                <span>{c.product.name}</span>
                <span className="muted">
                  {formatBaht(c.installment)} × {c.term} งวด · {CONTRACT_STATUS_LABELS[c.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
