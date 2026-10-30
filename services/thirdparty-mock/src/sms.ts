import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { escapeHtml, page } from './html.ts'
import { log } from './log.ts'

// Mock SMS gateway. eshop-api sends   POST /sms/messages { "to": "0812345678", "text": "..." }
// and nothing is delivered: messages are kept in memory (newest first, capped) and shown on the
// mock inbox page GET /sms/inbox, grouped per mobile number, so codes can be read without a phone.

export interface SmsMessage {
  id: string
  to: string
  text: string
  receivedAt: string
}

const MAX_MESSAGES = 1000
const messages: SmsMessage[] = []

const MOBILE_NUMBER = /^0[0-9]{9}$/

export function smsRouter(): Router {
  const router = Router()

  router.post('/sms/messages', (request, response) => {
    const { to, text } = (request.body ?? {}) as { to?: unknown; text?: unknown }
    if (typeof to !== 'string' || !MOBILE_NUMBER.test(to) || typeof text !== 'string' || text.length === 0) {
      response.status(400).json({ error: 'expected { "to": "0XXXXXXXXX", "text": "..." }' })
      return
    }
    const message: SmsMessage = { id: randomUUID(), to, text, receivedAt: new Date().toISOString() }
    messages.unshift(message)
    messages.length = Math.min(messages.length, MAX_MESSAGES)
    log('info', 'sms received', { id: message.id, to })
    response.status(202).json({ id: message.id })
  })

  // JSON view of the inbox, newest first; ?to= filters to one mobile number.
  router.get('/sms/messages', (request, response) => {
    response.json(filterByNumber(request.query.to))
  })

  router.get('/sms/inbox', (request, response) => {
    const to = typeof request.query.to === 'string' ? request.query.to.trim() : ''
    response.type('html').send(inboxPage(to, filterByNumber(to)))
  })

  return router
}

function filterByNumber(to: unknown): SmsMessage[] {
  return typeof to === 'string' && to.trim() !== '' ? messages.filter((m) => m.to === to.trim()) : messages
}

function inboxPage(to: string, shown: SmsMessage[]): string {
  const byNumber = new Map<string, SmsMessage[]>()
  for (const message of shown) {
    byNumber.set(message.to, [...(byNumber.get(message.to) ?? []), message])
  }

  const sections = [...byNumber.entries()]
    .map(
      ([number, list]) => `<section>
<h2><a href="?to=${encodeURIComponent(number)}">${escapeHtml(number)}</a></h2>
<ol>${list
        .map((m) => `<li><time datetime="${m.receivedAt}">${escapeHtml(formatTime(m.receivedAt))}</time>${escapeHtml(m.text)}</li>`)
        .join('')}</ol>
</section>`,
    )
    .join('\n')

  return page(
    'กล่องข้อความ SMS',
    `<h1>กล่องข้อความ SMS (mock)</h1>
<p><a href="../">← thirdparty-mock</a></p>
<form method="get">
  <label>เบอร์มือถือ <input name="to" value="${escapeHtml(to)}" inputmode="numeric" placeholder="08XXXXXXXX"></label>
  <button type="submit">ค้นหา</button>
  ${to ? '<a href="inbox">ทั้งหมด</a>' : ''}
</form>
<p class="muted">อัปเดตอัตโนมัติทุก 5 วินาที · ${shown.length} ข้อความ</p>
${sections || '<p>ยังไม่มีข้อความ</p>'}`,
    { refreshSeconds: 5 },
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false })
}
