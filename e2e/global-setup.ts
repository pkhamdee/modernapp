import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { request } from '@playwright/test'
import { baseURL, environment } from './environment'

// The tests set Auction times from this machine's clock while the cluster judges them by its own (#65). A Mac
// that sleeps mid-run leaves the Rancher Desktop VM's clock behind (the VM runs no time sync), and the demo then
// fails in confusing ways. The HTTP Date header has 1 s resolution, so a few seconds is the honest tolerance.
const MAX_CLOCK_SKEW_SECONDS = 5

export default async function globalSetup() {
  await expectClusterClockInSync()
  readStaffCredentials()
}

/** Fails fast when the cluster's clock (the gateway's Date header) differs from this machine's. */
async function expectClusterClockInSync() {
  const api = await request.newContext({ ignoreHTTPSErrors: true })
  try {
    const sentAt = Date.now()
    const response = await api.head(`${baseURL}/`)
    const receivedAt = Date.now()
    const date = response.headers()['date']
    if (!date) throw new Error(`${baseURL}/ sent no Date header, so the cluster's clock can't be checked.`)
    const skew = Math.round((Date.parse(date) - (sentAt + receivedAt) / 2) / 1000)
    if (Math.abs(skew) > MAX_CLOCK_SKEW_SECONDS) {
      throw new Error(
        `The cluster's clock is ${Math.abs(skew)} s ${skew < 0 ? 'behind' : 'ahead of'} this machine's ` +
          `(${baseURL} says ${date}). Auction times would be wrong, so the demo can't pass. Did the Mac sleep? ` +
          `Compare \`rdctl shell date -u\` with \`date -u\` and restart Rancher Desktop (docs/setup.md, Troubleshooting).`,
      )
    }
  } finally {
    await api.dispose()
  }
}

/**
 * Staff credentials for the back-office steps. STAFF_USERNAME / STAFF_PASSWORD win (CI passes them from
 * secrets); otherwise they are decrypted from the environment's SOPS Secret
 * deploy/apps/<env>/eshop-api-staff.sops.yaml with the local age key. They only ever live in this process's
 * environment (inherited by the test workers) and are never printed.
 */
function readStaffCredentials() {
  if (process.env.STAFF_USERNAME && process.env.STAFF_PASSWORD) return

  const file = resolve(import.meta.dirname, '..', 'deploy', 'apps', environment, 'eshop-api-staff.sops.yaml')
  const env = {
    ...process.env,
    SOPS_AGE_KEY_FILE: process.env.SOPS_AGE_KEY_FILE ?? join(homedir(), '.config', 'sops', 'age', 'keys.txt'),
  }
  const read = (key: string) =>
    execFileSync('sops', ['-d', '--extract', `["stringData"]["${key}"]`, file], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

  try {
    process.env.STAFF_USERNAME = read('username')
    process.env.STAFF_PASSWORD = read('password')
  } catch {
    throw new Error(
      `No Staff credentials: set STAFF_USERNAME and STAFF_PASSWORD, or install sops with the age key ` +
        `(SOPS_AGE_KEY_FILE, default ~/.config/sops/age/keys.txt) so ${file} can be decrypted.`,
    )
  }
}
