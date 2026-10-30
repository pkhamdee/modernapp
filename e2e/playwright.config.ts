import { defineConfig, devices } from '@playwright/test'
import { baseURL } from './environment'

// Seam 4: the definition-of-done demo in a real browser against a deployed environment (never on every CI run).
// npm run e2e                                          -> https://eshop.localhost (eshop-dev)
// E2E_BASE_URL=https://prod.eshop.localhost npm run e2e -> eshop-prod (post-release smoke test)
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  // Real waits: Credit Decision (≤ 60 s), sync-master cycles (30 s each way), an Auction closing ~2 min ahead.
  timeout: 6 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 2,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Pixel 7'],
    baseURL,
    // The local cluster's certificate comes from a self-signed CA.
    ignoreHTTPSErrors: true,
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    // Traces record request bodies (the Staff sign-in) and SMS codes: keep them local, never in CI artifacts.
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: process.env.CI ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium' }],
})
