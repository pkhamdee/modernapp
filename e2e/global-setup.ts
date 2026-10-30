import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { environment } from './environment'

/**
 * Staff credentials for the back-office steps. STAFF_USERNAME / STAFF_PASSWORD win (CI passes them from
 * secrets); otherwise they are decrypted from the environment's SOPS Secret
 * deploy/apps/<env>/eshop-api-staff.sops.yaml with the local age key. They only ever live in this process's
 * environment (inherited by the test workers) and are never printed.
 */
export default function globalSetup() {
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
