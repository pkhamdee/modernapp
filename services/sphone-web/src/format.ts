const baht = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  maximumFractionDigits: 0,
})

export const formatBaht = (amount: number) => baht.format(amount)

/** 0.015 -> "1.5%" */
export const formatMonthlyRate = (fraction: number) =>
  `${(fraction * 100).toLocaleString('th-TH', { maximumFractionDigits: 2 })}%`
