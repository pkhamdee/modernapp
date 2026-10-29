import { Router, type RequestHandler } from 'express'

// Adjustable artificial response delay, shared by every mocked third party that opts in by putting
// `simulatedDelay` in front of its router (ID Verification and Credit Check, so a Credit Decision can be
// demoed quick or timing out). SMS deliberately does not use it: sign-in should stay fast.

const MAX_DELAY_MS = 120_000
let delayMs = 0

export function currentDelayMs(): number {
  return delayMs
}

export const simulatedDelay: RequestHandler = (_request, _response, next) => {
  if (delayMs === 0) {
    next()
    return
  }
  setTimeout(next, delayMs)
}

function parseDelay(value: unknown): number | undefined {
  const ms = typeof value === 'string' ? Number(value) : value
  return typeof ms === 'number' && Number.isInteger(ms) && ms >= 0 && ms <= MAX_DELAY_MS ? ms : undefined
}

/** GET/PUT /admin/delay as JSON ({ "ms": 5000 }); POST from the home page's form. */
export function delayRouter(): Router {
  const router = Router()

  router.get('/admin/delay', (_request, response) => {
    response.json({ ms: delayMs })
  })

  router.put('/admin/delay', (request, response) => {
    const ms = parseDelay((request.body as { ms?: unknown } | undefined)?.ms)
    if (ms === undefined) {
      response.status(400).json({ error: `ms must be an integer from 0 to ${MAX_DELAY_MS}` })
      return
    }
    delayMs = ms
    response.json({ ms: delayMs })
  })

  router.post('/admin/delay', (request, response) => {
    const ms = parseDelay((request.body as { ms?: unknown } | undefined)?.ms)
    if (ms !== undefined) delayMs = ms
    response.redirect(303, '../')
  })

  return router
}
