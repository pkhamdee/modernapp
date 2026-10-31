// A signed-in session for a ZAP API scan (scripts/gates/dast.sh), obtained the way a Customer or Staff member gets
// one, through the temporary copy's gateway. Run inside the copy's network, with temporary-copy/gateway-client.mjs
// mounted beside it: `node dast-session.mjs customer|staff`.
//
//   customer  signs in by SMS code as a fresh Customer (gateway-client.mjs: signInCustomer), so every scan has its own
//   staff     signs in with the throwaway Staff account that exists only in the copy (STAFF_USERNAME, STAFF_PASSWORD)
//
// Prints the bearer token on stdout and nothing else; /api/auth/me has confirmed it carries the role. Any failure is
// a message on stderr and exit 1, so a broken sign-in stops the gate before a scan runs signed out by mistake.
import { gatewayClient, signInCustomer, signInStaff } from './gateway-client.mjs'

function fail(message) {
  console.error(`dast-session: ${message}`)
  process.exit(1)
}

const gateway = gatewayClient(process.env.DAST_GATEWAY ?? 'http://gateway:8080', fail)
const role = process.argv[2]
let token
if (role === 'customer') token = await signInCustomer(gateway)
else if (role === 'staff') token = await signInStaff(gateway, process.env.STAFF_USERNAME, process.env.STAFF_PASSWORD)
else fail('usage: dast-session.mjs customer|staff')
process.stdout.write(`${token}\n`)
