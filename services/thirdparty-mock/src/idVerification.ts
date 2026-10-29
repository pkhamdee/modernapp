import { Router } from 'express'
import { log } from './log.ts'
import { dateOfBirthFor, fullNameFor, ID_NUMBER, outcomeFor } from './testIdNumbers.ts'

// Mock ID Verification. sphone-api sends
//   POST /id-verification/checks { "idNumber": "1101700000101", "photo": "<base64>", "contentType": "image/jpeg" }
// and gets { "verified": true, "fullName": "...", "dateOfBirth": "YYYY-MM-DD" } or { "verified": false, "reason": "..." }.
// The outcome is driven by the ID number's last two digits (testIdNumbers.ts); the photo is only checked to be present.

export function idVerificationRouter(): Router {
  const router = Router()

  router.post('/id-verification/checks', (request, response) => {
    const { idNumber, photo } = (request.body ?? {}) as { idNumber?: unknown; photo?: unknown }
    if (typeof idNumber !== 'string' || !ID_NUMBER.test(idNumber) || typeof photo !== 'string' || photo.length === 0) {
      response.status(400).json({ error: 'expected { "idNumber": "13 digits", "photo": "<base64>", "contentType": "image/..." }' })
      return
    }

    const outcome = outcomeFor(idNumber)
    log('info', 'id verification', { suffix: outcome.suffix, result: outcome.idVerification })
    if (outcome.idVerification === 'failed') {
      response.json({ verified: false, reason: 'ID number and card photo do not match a living person' })
      return
    }
    response.json({ verified: true, fullName: fullNameFor(idNumber), dateOfBirth: dateOfBirthFor(outcome.age) })
  })

  return router
}
