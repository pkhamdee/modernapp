// Which deployed environment the smoke test runs against. E2E_BASE_URL picks it (default: eshop-dev);
// the environment name (dev | qa | prod) selects the mock Enterprise System database and the SOPS Staff Secret.
export const baseURL = (process.env.E2E_BASE_URL ?? 'https://eshop.localhost').replace(/\/+$/, '')

type Environment = 'dev' | 'qa' | 'prod'

// qa.eshop.localhost -> qa, prod.eshop.localhost -> prod, anything else (eshop.localhost) -> dev. E2E_ENV overrides.
function fromHostname(hostname: string): Environment {
  if (hostname.startsWith('prod.')) return 'prod'
  if (hostname.startsWith('qa.')) return 'qa'
  return 'dev'
}

export const environment: Environment =
  (process.env.E2E_ENV as Environment | undefined) ?? fromHostname(new URL(baseURL).hostname)

// thirdparty-mock (SMS inbox, Enterprise System admin tool) is one shared deployment routed on eshop.localhost
// only, so the test reads it there whichever environment it runs against. E2E_MOCK_URL overrides it.
export const mockBaseURL = (process.env.E2E_MOCK_URL ?? 'https://eshop.localhost').replace(/\/+$/, '')
