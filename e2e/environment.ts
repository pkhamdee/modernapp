// Which deployed environment the smoke test runs against. E2E_BASE_URL picks it (default: sphone-dev);
// the environment name (dev | prod) selects the mock Enterprise System database and the SOPS Staff Secret.
export const baseURL = (process.env.E2E_BASE_URL ?? 'https://sphone.localhost').replace(/\/+$/, '')

export const environment: 'dev' | 'prod' =
  (process.env.E2E_ENV as 'dev' | 'prod' | undefined) ??
  (new URL(baseURL).hostname.startsWith('prod.') ? 'prod' : 'dev')

// thirdparty-mock (SMS inbox, Enterprise System admin tool) is one shared deployment routed on sphone.localhost
// only, so the test reads it there whichever environment it runs against. E2E_MOCK_URL overrides it.
export const mockBaseURL = (process.env.E2E_MOCK_URL ?? 'https://sphone.localhost').replace(/\/+$/, '')
