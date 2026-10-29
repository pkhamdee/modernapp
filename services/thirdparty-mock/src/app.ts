import express from 'express'
import { currentDelayMs, delayRouter } from './delay.ts'
import { page } from './html.ts'
import { log } from './log.ts'
import { smsRouter } from './sms.ts'

// thirdparty-mock: ONE service pretending to be every third party sphone-api talks to.
// Each mocked party is a module exporting a Router, mounted below. To add one (e.g. ID Verification
// or Credit Check for #7): create src/<party>.ts exporting `<party>Router()`, mount it here behind
// `simulatedDelay` (from delay.ts) if its responses should honour the adjustable delay, and link it
// from the home page.
export function createApp(): express.Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json())
  app.use(express.urlencoded({ extended: false }))

  app.use((request, response, next) => {
    const started = performance.now()
    response.on('finish', () => {
      if (request.path === '/healthz') return
      log('info', 'request', {
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - started),
      })
    })
    next()
  })

  app.get('/healthz', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.get('/', (_request, response) => {
    response.type('html').send(homePage())
  })

  app.use(delayRouter())
  app.use(smsRouter())
  // app.use(simulatedDelay, idVerificationRouter())   <- #7
  // app.use(simulatedDelay, creditCheckRouter())      <- #7

  return app
}

function homePage(): string {
  return page(
    'thirdparty-mock',
    `<h1>thirdparty-mock</h1>
<ul>
  <li><a href="sms/inbox">กล่องข้อความ SMS (mock inbox)</a></li>
</ul>
<section>
  <h2>Response delay</h2>
  <form method="post" action="admin/delay">
    <label>ms <input name="ms" type="number" min="0" max="120000" step="100" value="${currentDelayMs()}"></label>
    <button type="submit">Save</button>
  </form>
  <p class="muted">Applies to ID Verification and Credit Check (not SMS).</p>
</section>`,
  )
}
