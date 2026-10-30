const baht = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  maximumFractionDigits: 0,
})

export const formatBaht = (amount: number) => baht.format(amount)

/** Flat Rate (อัตราดอกเบี้ยคงที่) per month: 0.015 -> "1.5%" */
export const formatFlatRate = (fraction: number) =>
  `${(fraction * 100).toLocaleString('th-TH', { maximumFractionDigits: 2 })}%`

// Every date eShop shows is in Asia/Bangkok, whatever the device's time zone.
const date = new Intl.DateTimeFormat('th-TH', { dateStyle: 'long', timeZone: 'Asia/Bangkok' })
const dateTime = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' })

/** ISO timestamp or date → Thai date in Asia/Bangkok, e.g. "28 พฤศจิกายน 2569". */
export const formatDate = (iso: string) => date.format(new Date(iso))

/** ISO timestamp → Thai date and time in Asia/Bangkok, e.g. "2 พ.ย. 2569 10:00". */
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso))
