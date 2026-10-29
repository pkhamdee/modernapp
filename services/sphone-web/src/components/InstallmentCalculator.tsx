import { useEffect, useId, useState } from 'react'
import { catalogPaths, type InstallmentPlans } from '../api/catalog.ts'
import { useApi } from '../api/client.ts'
import { formatBaht } from '../format.ts'
import { Status } from './Status.tsx'

/** Waits until typing pauses before asking sphone-api again. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

/**
 * Term and Down Payment controls on the Product page. sphone-api decides which Terms are offered
 * (Product Category cap, ฿500 floor) and computes each Installment; this only displays them.
 */
export function InstallmentCalculator({ productId, price }: { productId: number; price: number }) {
  const ids = useId()
  const [downPaymentText, setDownPaymentText] = useState('')
  const [chosenTerm, setChosenTerm] = useState<number | null>(null)

  const downPayment = downPaymentText.trim() === '' ? 0 : Number(downPaymentText)
  const downPaymentValid = Number.isFinite(downPayment) && downPayment >= 0 && downPayment < price
  const debouncedDownPayment = useDebounced(downPayment, 300)

  const plans = useApi<InstallmentPlans>(
    downPaymentValid && debouncedDownPayment === downPayment
      ? catalogPaths.installmentPlans(productId, debouncedDownPayment)
      : null,
  )

  const offered = plans.status === 'success' ? plans.data.plans : []
  // Keep the chosen Term while it is still offered; otherwise show the longest (lowest Installment).
  const selected = offered.find((p) => p.term === chosenTerm) ?? offered.at(-1)

  return (
    <section className="calculator" aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>คำนวณค่างวด</h2>

      <div className="field">
        <label htmlFor={`${ids}-down`}>เงินดาวน์ (ไม่บังคับ)</label>
        <input
          id={`${ids}-down`}
          type="number"
          inputMode="numeric"
          min={0}
          max={price - 1}
          step={1}
          placeholder="0"
          value={downPaymentText}
          onChange={(e) => setDownPaymentText(e.target.value)}
          aria-invalid={!downPaymentValid}
          aria-describedby={`${ids}-down-hint`}
        />
        {downPaymentValid ? (
          <span id={`${ids}-down-hint`} className="field-hint">
            ยอดจัดผ่อน {formatBaht(price - downPayment)}
          </span>
        ) : (
          <span id={`${ids}-down-hint`} className="field-error" role="alert">
            เงินดาวน์ต้องไม่ติดลบและต้องน้อยกว่าราคาสินค้า
          </span>
        )}
      </div>

      {!downPaymentValid ? null : plans.status !== 'success' ? (
        <Status state={plans} />
      ) : offered.length === 0 ? (
        <p className="status">ไม่มีจำนวนงวดที่ผ่อนได้ (ค่างวดขั้นต่ำ {formatBaht(500)}) ลองลดเงินดาวน์</p>
      ) : (
        <>
          <fieldset className="field">
            <legend>จำนวนงวด</legend>
            <div className="term-options">
              {offered.map((plan) => (
                <label key={plan.term} className="term-option">
                  <input
                    type="radio"
                    name={`${ids}-term`}
                    value={plan.term}
                    checked={plan.term === selected?.term}
                    onChange={() => setChosenTerm(plan.term)}
                  />
                  <span>{plan.term} งวด</span>
                </label>
              ))}
            </div>
          </fieldset>

          {selected && (
            <dl className="installment-result" aria-live="polite">
              <div>
                <dt>ค่างวดต่อเดือน</dt>
                <dd className="installment-amount">{formatBaht(selected.installment)}</dd>
              </div>
              <div>
                <dt>ยอดชำระทั้งหมด (รวมเงินดาวน์)</dt>
                <dd>{formatBaht(selected.totalPayable)}</dd>
              </div>
            </dl>
          )}
        </>
      )}
    </section>
  )
}
