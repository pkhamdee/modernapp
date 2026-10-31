// A signed-in session for a ZAP API scan (scripts/gates/dast.sh), obtained the way a real user gets one, through the
// temporary copy's gateway. Run inside the copy's network: `node dast-session.mjs customer|staff`.
//
//   customer  signs in by SMS code: requests a code for a fresh mobile number, reads it from thirdparty-mock's inbox,
//             verifies it (the first sign-in creates the Customer, so every scan has its own Customer)
//   staff     signs in with the throwaway Staff account that exists only in the copy (STAFF_USERNAME, STAFF_PASSWORD)
//
// Prints the bearer token on stdout and nothing else; checks with /api/auth/me that it carries the role. Any failure
// is a message on stderr and exit 1, so a broken sign-in stops the gate before a scan runs signed out by mistake.

const gateway = process.env.DAST_GATEWAY ?? 'http://gateway:8080'

function fail(message) {
  console.error(`dast-session: ${message}`)
  process.exit(1)
}

async function json(method, path, { body, token } = {}) {
  const headers = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const response = await fetch(gateway + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) fail(`${method} ${path}: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`)
  return response.status === 202 ? null : response.json()
}

async function customer() {
  // 06-09 then 8 digits; random, so no two scans (or Locust users) share a number and its one live code.
  const mobileNumber = `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  await json('POST', '/api/auth/sms-code', { body: { mobileNumber } })
  const inbox = await json('GET', `/thirdparty-mock/sms/messages?to=${mobileNumber}`)
  const code = inbox[0]?.text.match(/\d{6}/)?.[0]
  if (!code) fail(`no SMS code in the mock inbox for ${mobileNumber}`)
  return (await json('POST', '/api/auth/sms-code/verify', { body: { mobileNumber, code } })).token
}

async function staff() {
  const username = process.env.STAFF_USERNAME
  const password = process.env.STAFF_PASSWORD
  if (!username || !password) fail('STAFF_USERNAME and STAFF_PASSWORD are required')
  return (await json('POST', '/api/auth/staff/sign-in', { body: { username, password } })).token
}

const roles = { customer, staff }
const role = process.argv[2]
if (!roles[role]) fail(`usage: dast-session.mjs ${Object.keys(roles).join('|')}`)
const token = await roles[role]()
const me = await json('GET', '/api/auth/me', { token })
if (me.role.toLowerCase() !== role) fail(`the ${role} session has role ${me.role}`)
process.stdout.write(`${token}\n`)
