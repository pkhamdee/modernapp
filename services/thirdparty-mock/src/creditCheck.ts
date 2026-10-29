import { Router } from 'express'
import { log } from './log.ts'
import { ID_NUMBER, outcomeFor } from './testIdNumbers.ts'

// Mock Credit Check. sphone-api sends
//   POST /credit-check/checks { "idNumber": "1101700000101", "fullName": "...", "dateOfBirth": "YYYY-MM-DD" }
// and gets { "passed": true, "creditLimit": 50000 } or { "passed": false }, driven by the ID number's last two digits.

export function creditCheckRouter(): Router {
  const router = Router()

  router.post('/credit-check/checks', (request, response) => {
    const { idNumber } = (request.body ?? {}) as { idNumber?: unknown }
    if (typeof idNumber !== 'string' || !ID_NUMBER.test(idNumber)) {
      response.status(400).json({ error: 'expected { "idNumber": "13 digits", "fullName": "...", "dateOfBirth": "YYYY-MM-DD" }' })
      return
    }

    const outcome = outcomeFor(idNumber)
    log('info', 'credit check', { suffix: outcome.suffix, result: outcome.creditCheck })
    response.json(
      outcome.creditCheck === 'passed' ? { passed: true, creditLimit: outcome.creditLimit } : { passed: false },
    )
  })

  return router
}
