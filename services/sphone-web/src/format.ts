const baht = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  maximumFractionDigits: 0,
})

export const formatBaht = (amount: number) => baht.format(amount)

/** 0.015 -> "1.5%" */
export const formatMonthlyRate = (fraction: number) =>
  `${(fraction * 100).toLocaleString('th-TH', { maximumFractionDigits: 2 })}%`

const dateTime = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' })

/** ISO timestamp → Thai date and time in Asia/Bangkok, e.g. "2 พ.ย. 2569 10:00". */
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso))
