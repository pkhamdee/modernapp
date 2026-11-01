// Calls to the temporary copy through its gateway, and its two sign-ins, shared by ready.mjs (is the copy ready?) and
// ../dast-session.mjs (a session for a signed-in ZAP scan). Both run on the copy's Compose network, with this file
// mounted beside them.
//
//   const gateway = gatewayClient('http://gateway:8080', fail)
//   await gateway.json('GET', '/api/product-categories')          // parsed JSON; fail() on a non-2xx answer
//   await gateway.call('GET', '/')                                 // the Response, whatever its status
//   await signInCustomer(gateway)  /  await signInStaff(gateway, username, password)   // the bearer token

export function gatewayClient(base, fail) {
  async function call(method, path, { body, token } = {}) {
    const headers = { accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (token) headers.authorization = `Bearer ${token}`
    return fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
  }

  async function json(method, path, options) {
    const response = await call(method, path, options)
    if (!response.ok) fail(`${method} ${path}: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`)
    return response.status === 202 || response.status === 204 ? null : response.json()
  }

  return { call, json, fail }
}

// A Customer signed in by SMS code: a code requested for a fresh mobile number, read from thirdparty-mock's inbox
// and verified (the first sign-in creates the Customer). Random number: one live code per number, so no two
// sign-ins (or Locust users) may share one.
export async function signInCustomer(gateway) {
  const mobileNumber = `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` // 09 then 8 digits
  await gateway.json('POST', '/api/auth/sms-code', { body: { mobileNumber } })
  const inbox = await gateway.json('GET', `/thirdparty-mock/sms/messages?to=${mobileNumber}`)
  const code = inbox[0]?.text.match(/\d{6}/)?.[0]
  if (!code) gateway.fail(`no SMS code in the mock inbox for ${mobileNumber}`)
  const { token } = await gateway.json('POST', '/api/auth/sms-code/verify', { body: { mobileNumber, code } })
  return expectRole(gateway, token, 'customer')
}

// Staff signed in with the copy's throwaway account.
export async function signInStaff(gateway, username, password) {
  if (!username || !password) gateway.fail('the Staff username and password are required')
  const { token } = await gateway.json('POST', '/api/auth/staff/sign-in', { body: { username, password } })
  return expectRole(gateway, token, 'staff')
}

// The token, once /api/auth/me confirms it carries the role.
async function expectRole(gateway, token, role) {
  const me = await gateway.json('GET', '/api/auth/me', { token })
  if (me.role.toLowerCase() !== role) gateway.fail(`the ${role} session has role ${me.role}`)
  return token
}
