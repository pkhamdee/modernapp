// Is the temporary copy ready for the gates? Run inside the copy's network by `temporary-copy.sh up`
// (`docker compose --profile check run ready`), so it needs no published port.
//
// 1. Health: waits (up to READY_TIMEOUT_SECONDS) until every part answers its own probe, as the cluster's
//    readiness probes would: PostgreSQL through eshop-api's /healthz/ready, eshop-node-api, thirdparty-mock,
//    eshop-web, and the gateway.
// 2. Seeded and usable, through the gateway as a browser would: the demo catalog is there with photos, a Customer
//    signs in by SMS code read from the mock's inbox, and the throwaway Staff account signs in.
// 3. Seeds what dev has beyond the catalog and the image's own seed: an open Auction with a Lot, created through the
//    Staff API (once: skipped when the copy already has an Auction), so Locust and ZAP have one to work on.
// Prints one line per check and exits non-zero on the first failure.

const gateway = 'http://gateway:8080'
const deadline = Date.now() + Number(process.env.READY_TIMEOUT_SECONDS ?? 180) * 1000

const probes = [
  ['eshop-api', 'http://eshop-api:8080/healthz/ready'],
  ['eshop-node-api', 'http://eshop-node-api:8080/healthz/ready'],
  ['thirdparty-mock', 'http://thirdparty-mock:8080/healthz'],
  ['eshop-web', 'http://eshop-web:8080/healthz'],
  ['gateway', `${gateway}/gateway-healthz`],
]

function fail(message) {
  console.error(`FAIL ${message}`)
  process.exit(1)
}

async function waitHealthy(name, url) {
  let last = 'no answer yet'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (response.ok) {
        console.log(`ok   ${name} healthy (${url})`)
        return
      }
      last = `HTTP ${response.status}`
    } catch (error) {
      last = error.cause?.code ?? error.message
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  fail(`${name} not healthy within the timeout (${url}: ${last})`)
}

async function call(method, path, { body, token } = {}) {
  const headers = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const response = await fetch(gateway + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  return response
}

async function json(method, path, options) {
  const response = await call(method, path, options)
  if (!response.ok) fail(`${method} ${path}: HTTP ${response.status}`)
  return response.json()
}

for (const [name, url] of probes) await waitHealthy(name, url)

// Seeded: the same demo catalog as dev, each Product with its photo served through /images.
const categories = await json('GET', '/api/product-categories')
if (categories.length === 0) fail('no Product Categories: demo data not seeded')
const products = await json('GET', `/api/product-categories/${categories[0].code}/products`)
if (products.length === 0) fail(`no Products in ${categories[0].code}: demo data not seeded`)
const photo = products.find((product) => product.imageUrl)
if (!photo) fail('no demo Product photo')
const image = await call('GET', photo.imageUrl)
if (!image.ok || !(image.headers.get('content-type') ?? '').startsWith('image/')) {
  fail(`${photo.imageUrl}: HTTP ${image.status} ${image.headers.get('content-type')}`)
}
console.log(`ok   demo data seeded (${categories.length} Product Categories; photo ${photo.imageUrl})`)

const page = await call('GET', '/')
if (!page.ok || !(page.headers.get('content-type') ?? '').startsWith('text/html')) fail(`/: HTTP ${page.status}`)
console.log('ok   web app served at /')

// Customer sign-in by SMS code, read from the mock's inbox through the gateway as the e2e test does.
const mobileNumber = `09${String(Date.now()).slice(-8)}`
const requested = await call('POST', '/api/auth/sms-code', { body: { mobileNumber } })
if (requested.status !== 202) fail(`POST /api/auth/sms-code: HTTP ${requested.status}`)
const inbox = await json('GET', `/thirdparty-mock/sms/messages?to=${mobileNumber}`)
const code = inbox[0]?.text.match(/\d{6}/)?.[0]
if (!code) fail(`no SMS code in the mock inbox for ${mobileNumber}`)
const customer = await json('POST', '/api/auth/sms-code/verify', { body: { mobileNumber, code } })
const customerMe = await json('GET', '/api/auth/me', { token: customer.token })
if (customerMe.role.toLowerCase() !== 'customer') fail(`Customer session has role ${customerMe.role}`)
console.log('ok   Customer signed in by SMS code through thirdparty-mock')

// Staff sign-in with the throwaway account that exists only in this copy.
const staff = await json('POST', '/api/auth/staff/sign-in', {
  body: { username: process.env.STAFF_USERNAME, password: process.env.STAFF_PASSWORD },
})
const staffMe = await json('GET', '/api/auth/me', { token: staff.token })
if (staffMe.role.toLowerCase() !== 'staff') fail(`Staff session has role ${staffMe.role}`)
console.log('ok   Staff signed in')

// An open Auction with one Lot, as dev has. Open since a minute ago, closing in a day: long enough for any gate.
const auctions = await json('GET', '/api/back-office/auctions', { token: staff.token })
if (auctions.length === 0) {
  const now = Date.now()
  const auction = await json('POST', '/api/back-office/auctions', {
    token: staff.token,
    body: { opensAt: new Date(now - 60_000).toISOString(), closesAt: new Date(now + 24 * 3600_000).toISOString() },
  })
  await json('POST', `/api/back-office/auctions/${auction.id}/lots`, {
    token: staff.token,
    body: {
      title: 'iPhone 17 128GB (temporary copy)',
      conditionNotes: 'Demo Lot of the temporary copy',
      startingPrice: 15000,
      imageIds: ['demo-iphone-17.svg'],
    },
  })
}
const current = await json('GET', '/api/auctions/current')
if (!current.lots?.length) fail('the current Auction has no Lot')
console.log(`ok   Auction ${current.id} open with ${current.lots.length} Lot(s)`)

console.log('temporary copy ready')
