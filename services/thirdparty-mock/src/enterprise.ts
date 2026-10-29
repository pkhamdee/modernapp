import { Router, type Request, type Response } from 'express'
import sql from 'mssql'
import { escapeHtml, page } from './html.ts'
import { log } from './log.ts'

// Admin tool of the mock Enterprise System (story 62). The Enterprise System itself is the real SQL Server in
// the thirdparty namespace (deploy/thirdparty/mssql), databases enterprise_dev and enterprise_prod, fake
// schema hp.contract / hp.payment. sphone-sync-master pushes Contracts there; this page lists them and lets a
// developer do what the Enterprise System's own staff would: record a Payment, mark overdue, cancel.
// The pull (#10) brings those changes back to S Phone.
//
//   GET  /enterprise/                                  pick an environment
//   GET  /enterprise/{dev|prod}/                       Contracts (newest first) with their Payments, and forms
//   GET  /enterprise/{dev|prod}/contracts              same as JSON (handy in scripts)
//   POST /enterprise/{dev|prod}/contracts/{no}/payments  {amount?, channel?}  amount defaults to one Installment
//   POST /enterprise/{dev|prod}/contracts/{no}/status    {status: ACTIVE|OVERDUE}
//   POST /enterprise/{dev|prod}/contracts/{no}/cancel    {reason?}
// HTML forms get a 303 back to the list; JSON callers get JSON.
//
// Connection: ENTERPRISE_SQL_SERVER (default "mssql"), ENTERPRISE_SQL_USER (default "enterprise_admin"),
// ENTERPRISE_SQL_PASSWORD (from the mssql-credentials Secret). Without a password the pages say so.

const ENVIRONMENTS = { dev: 'enterprise_dev', prod: 'enterprise_prod' } as const
type Environment = keyof typeof ENVIRONMENTS

const pools = new Map<Environment, Promise<sql.ConnectionPool>>()

function pool(environment: Environment): Promise<sql.ConnectionPool> {
  let existing = pools.get(environment)
  if (!existing) {
    const password = process.env.ENTERPRISE_SQL_PASSWORD
    if (!password) throw new Error('ENTERPRISE_SQL_PASSWORD is not set: the mock Enterprise System is not configured')
    existing = new sql.ConnectionPool({
      server: process.env.ENTERPRISE_SQL_SERVER ?? 'mssql',
      port: Number(process.env.ENTERPRISE_SQL_PORT ?? 1433),
      user: process.env.ENTERPRISE_SQL_USER ?? 'enterprise_admin',
      password,
      database: ENVIRONMENTS[environment],
      options: { encrypt: true, trustServerCertificate: true },
      pool: { max: 2 },
    })
      .connect()
      .catch((error: unknown) => {
        pools.delete(environment)
        throw error
      })
    pools.set(environment, existing)
  }
  return existing
}

interface ContractRow {
  contract_no: string
  customer_name: string
  customer_id_no: string
  customer_mobile_no: string
  product_name: string
  cash_price: number
  down_payment: number
  term_months: number
  installment_amount: number
  total_payable: number
  contract_date: Date
  status: string
  cancelled_at: Date | null
  cancel_reason: string | null
  received_at: Date
  last_updated_at: Date
  paid: number
  payments: number
}

interface PaymentRow {
  payment_id: number
  contract_no: string
  installment_no: number | null
  amount: number
  paid_at: Date
  channel: string
}

const LIST_LIMIT = 100

async function listContracts(environment: Environment): Promise<{ contracts: ContractRow[]; payments: PaymentRow[] }> {
  const db = await pool(environment)
  const contracts = await db.request().input('limit', sql.Int, LIST_LIMIT).query<ContractRow>(`
    SELECT TOP (@limit) c.contract_no, c.customer_name, c.customer_id_no, c.customer_mobile_no, c.product_name,
           c.cash_price, c.down_payment, c.term_months, c.installment_amount, c.total_payable, c.contract_date,
           c.status, c.cancelled_at, c.cancel_reason, c.received_at, c.last_updated_at,
           COALESCE(p.paid, 0) AS paid, COALESCE(p.payments, 0) AS payments
    FROM hp.contract c
    OUTER APPLY (SELECT SUM(amount) AS paid, COUNT(*) AS payments FROM hp.payment WHERE contract_no = c.contract_no) p
    ORDER BY c.received_at DESC, c.contract_no DESC`)
  const numbers = contracts.recordset.map((c) => c.contract_no)
  if (numbers.length === 0) return { contracts: [], payments: [] }
  const payments = await db.request().input('numbers', sql.NVarChar(sql.MAX), numbers.join(',')).query<PaymentRow>(`
    SELECT payment_id, contract_no, installment_no, amount, paid_at, channel
    FROM hp.payment WHERE contract_no IN (SELECT value FROM STRING_SPLIT(@numbers, ','))
    ORDER BY paid_at, payment_id`)
  return { contracts: contracts.recordset, payments: payments.recordset }
}

class NotFound extends Error {}
class Refused extends Error {}

async function recordPayment(environment: Environment, contractNo: string, amountInput: unknown, channelInput: unknown) {
  const db = await pool(environment)
  const transaction = new sql.Transaction(db)
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
  try {
    const found = await new sql.Request(transaction)
      .input('no', sql.VarChar(16), contractNo)
      .query<{ status: string; installment_amount: number; term_months: number; paid: number; payments: number }>(`
        SELECT c.status, c.installment_amount, c.term_months,
               COALESCE((SELECT SUM(amount) FROM hp.payment WHERE contract_no = c.contract_no), 0) AS paid,
               (SELECT COUNT(*) FROM hp.payment WHERE contract_no = c.contract_no) AS payments
        FROM hp.contract c WITH (UPDLOCK) WHERE c.contract_no = @no`)
    const contract = found.recordset[0]
    if (!contract) throw new NotFound(`no Contract ${contractNo}`)
    if (contract.status === 'CANCELLED' || contract.status === 'PAID_OFF') {
      throw new Refused(`Contract ${contractNo} is ${contract.status}`)
    }
    const amount = amountInput === undefined || amountInput === '' ? contract.installment_amount : Number(amountInput)
    if (!Number.isFinite(amount) || amount <= 0) throw new Refused('amount must be a positive number')
    const channel = typeof channelInput === 'string' && ['COUNTER', 'TRANSFER', 'PROMPTPAY'].includes(channelInput)
      ? channelInput
      : 'COUNTER'

    const financed = contract.installment_amount * contract.term_months
    const paidOff = contract.paid + amount >= financed - 0.005
    await new sql.Request(transaction)
      .input('no', sql.VarChar(16), contractNo)
      .input('installment_no', sql.Int, Math.min(contract.payments + 1, contract.term_months))
      .input('amount', sql.Decimal(12, 2), amount)
      .input('channel', sql.VarChar(10), channel)
      .query(`INSERT INTO hp.payment (contract_no, installment_no, amount, paid_at, channel)
              VALUES (@no, @installment_no, @amount, SYSDATETIMEOFFSET(), @channel)`)
    // A Payment brings an overdue Contract back to ACTIVE; the last one pays it off.
    await new sql.Request(transaction)
      .input('no', sql.VarChar(16), contractNo)
      .input('status', sql.VarChar(10), paidOff ? 'PAID_OFF' : 'ACTIVE')
      .query('UPDATE hp.contract SET status = @status WHERE contract_no = @no AND status <> @status')
    await transaction.commit()
    log('info', 'enterprise payment recorded', { environment, contractNo, amount, paidOff })
    return { contractNo, amount, status: paidOff ? 'PAID_OFF' : 'ACTIVE' }
  } catch (error) {
    await transaction.rollback().catch(() => {})
    throw error
  }
}

async function changeStatus(environment: Environment, contractNo: string, statusInput: unknown, reasonInput: unknown) {
  const status = typeof statusInput === 'string' ? statusInput.toUpperCase() : ''
  if (!['ACTIVE', 'OVERDUE', 'CANCELLED'].includes(status)) throw new Refused('status must be ACTIVE, OVERDUE or CANCELLED')
  const reason = typeof reasonInput === 'string' && reasonInput.trim() ? reasonInput.trim().slice(0, 200) : null
  const db = await pool(environment)
  const result = await db.request()
    .input('no', sql.VarChar(16), contractNo)
    .input('status', sql.VarChar(10), status)
    .input('reason', sql.NVarChar(200), reason)
    .query(`
      UPDATE hp.contract
      SET status = @status,
          cancelled_at = CASE WHEN @status = 'CANCELLED' THEN SYSDATETIMEOFFSET() ELSE NULL END,
          cancel_reason = CASE WHEN @status = 'CANCELLED' THEN COALESCE(@reason, N'ยกเลิกโดยระบบหลัก') ELSE NULL END
      WHERE contract_no = @no AND status NOT IN ('CANCELLED', 'PAID_OFF')`)
  if (result.rowsAffected[0] === 0) {
    const exists = await db.request().input('no', sql.VarChar(16), contractNo)
      .query('SELECT 1 AS found FROM hp.contract WHERE contract_no = @no')
    if (exists.recordset.length === 0) throw new NotFound(`no Contract ${contractNo}`)
    throw new Refused(`Contract ${contractNo} is already cancelled or paid off`)
  }
  log('info', 'enterprise contract status changed', { environment, contractNo, status })
  return { contractNo, status }
}

export function enterpriseRouter(): Router {
  const router = Router()

  router.get('/enterprise', (_request, response) => {
    response.redirect(302, 'enterprise/')
  })

  router.get('/enterprise/', (_request, response) => {
    response.type('html').send(page('Enterprise System', `<h1>Mock Enterprise System</h1>
<p class="muted">SQL Server in the thirdparty namespace. sphone-sync-master pushes accepted Contracts here every 30 s.</p>
<ul>
  <li><a href="dev/">enterprise_dev</a> (sphone-dev)</li>
  <li><a href="prod/">enterprise_prod</a> (sphone-prod)</li>
</ul>`))
  })

  router.get('/enterprise/:env/', handle(async (environment, _request, response) => {
    const { contracts, payments } = await listContracts(environment)
    response.type('html').send(contractsPage(environment, contracts, payments))
  }))

  router.get('/enterprise/:env/contracts', handle(async (environment, _request, response) => {
    const { contracts, payments } = await listContracts(environment)
    response.json(contracts.map((c) => ({ ...c, paymentList: payments.filter((p) => p.contract_no === c.contract_no) })))
  }))

  router.post('/enterprise/:env/contracts/:no/payments', handle(async (environment, request, response) => {
    const body = (request.body ?? {}) as { amount?: unknown; channel?: unknown }
    const result = await recordPayment(environment, contractNo(request), body.amount, body.channel)
    reply(request, response, 201, result)
  }))

  router.post('/enterprise/:env/contracts/:no/status', handle(async (environment, request, response) => {
    const body = (request.body ?? {}) as { status?: unknown }
    reply(request, response, 200, await changeStatus(environment, contractNo(request), body.status, undefined))
  }))

  router.post('/enterprise/:env/contracts/:no/cancel', handle(async (environment, request, response) => {
    const body = (request.body ?? {}) as { reason?: unknown }
    reply(request, response, 200, await changeStatus(environment, contractNo(request), 'CANCELLED', body.reason))
  }))

  return router
}

function contractNo(request: Request): string {
  return String(request.params.no ?? '')
}

function isForm(request: Request): boolean {
  return request.is('application/x-www-form-urlencoded') === 'application/x-www-form-urlencoded'
}

// Forms post to {env}/contracts/{no}/{action}; relative to that, the list page {env}/ is ../../.
function reply(request: Request, response: Response, status: number, body: unknown): void {
  if (isForm(request)) response.redirect(303, '../../')
  else response.status(status).json(body)
}

function handle(action: (environment: Environment, request: Request, response: Response) => Promise<void>) {
  return async (request: Request, response: Response) => {
    const environment = String(request.params.env ?? '')
    if (!(environment in ENVIRONMENTS)) {
      response.status(404).json({ error: 'environment must be dev or prod' })
      return
    }
    try {
      await action(environment as Environment, request, response)
    } catch (error) {
      const status = error instanceof NotFound ? 404 : error instanceof Refused ? 409 : 503
      const message = error instanceof Error ? error.message : String(error)
      if (status === 503) log('error', 'enterprise database error', { environment, error: message })
      if (isForm(request) || request.accepts(['json', 'html']) === 'html') {
        response.status(status).type('html').send(page('Enterprise System', `<h1>Enterprise System</h1>
<p>${escapeHtml(message)}</p><p class="muted">Use the browser's back button.</p>`))
      } else {
        response.status(status).json({ error: message })
      }
    }
  }
}

const baht = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function contractsPage(environment: Environment, contracts: ContractRow[], payments: PaymentRow[]): string {
  const rows = contracts.map((c) => {
    const own = payments.filter((p) => p.contract_no === c.contract_no)
    const open = c.status === 'ACTIVE' || c.status === 'OVERDUE'
    const no = encodeURIComponent(c.contract_no)
    const actions = open
      ? `<form method="post" action="contracts/${no}/payments">
    <label>฿ <input name="amount" type="number" min="0.01" step="0.01" value="${c.installment_amount}"></label>
    <button type="submit">Simulate Payment</button>
  </form>
  <form method="post" action="contracts/${no}/status">
    <input type="hidden" name="status" value="${c.status === 'OVERDUE' ? 'ACTIVE' : 'OVERDUE'}">
    <button type="submit">${c.status === 'OVERDUE' ? 'Mark active' : 'Mark overdue'}</button>
  </form>
  <form method="post" action="contracts/${no}/cancel">
    <input name="reason" placeholder="reason (optional)" maxlength="200">
    <button type="submit">Cancel Contract</button>
  </form>`
      : ''
    return `<section>
  <h2>${escapeHtml(c.contract_no)} · ${escapeHtml(c.status)}</h2>
  <p>${escapeHtml(c.customer_name)} · ${escapeHtml(c.customer_mobile_no)} · ID ${escapeHtml(c.customer_id_no)}<br>
  ${escapeHtml(c.product_name)} · ฿${baht.format(c.cash_price)} · down ฿${baht.format(c.down_payment)} ·
  ${c.term_months} × ฿${baht.format(c.installment_amount)} · total ฿${baht.format(c.total_payable)}<br>
  <span class="muted">received ${c.received_at.toISOString()} · last updated ${c.last_updated_at.toISOString()}</span>
  ${c.cancel_reason ? `<br>cancelled: ${escapeHtml(c.cancel_reason)}` : ''}</p>
  <p>Paid ฿${baht.format(c.paid)} in ${c.payments} Payment(s)</p>
  ${own.length ? `<ol>${own.map((p) => `<li><time>${p.paid_at.toISOString()}</time>#${p.installment_no ?? '-'} ฿${baht.format(p.amount)} ${escapeHtml(p.channel)}</li>`).join('')}</ol>` : ''}
  ${actions}
</section>`
  })
  return page(`Enterprise ${environment}`, `<p><a href="../">Enterprise System</a> · <a href="../../">thirdparty-mock</a></p>
<h1>enterprise_${environment}: Contracts</h1>
<p class="muted">Newest ${LIST_LIMIT}, as pushed by sphone-sync-master. Changes here reach S Phone by the pull.</p>
${rows.length ? rows.join('\n') : '<p>No Contracts yet.</p>'}`)
}
