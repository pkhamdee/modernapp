import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { mockBaseURL } from '../environment'
import { expectPageFits } from './steps'

// Seam 4: eShop as a Progressive Web App (spec #46, ADR 0006), at phone and desktop sizes (playwright.config.ts).
// Installable (#58): the page links a web app manifest that names the app and brings its icons.

const BRAND_RED = '#c8102e'

/** Fetches an image the page points at and returns its pixel size, read from the PNG header (IHDR). */
async function pngSize(request: APIRequestContext, url: string): Promise<{ width: number; height: number }> {
  const response = await request.get(url)
  expect(response.status(), url).toBe(200)
  // An unknown path would come back as the app's index.html (SPA fallback), not as a 404.
  expect(response.headers()['content-type'], url).toBe('image/png')
  const png = await response.body()
  expect(png.subarray(0, 8).toString('hex'), `${url} is a PNG`).toBe('89504e470d0a1a0a')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

test('installable: the web app manifest names eShop and its icons load', async ({ page }) => {
  await page.goto('/')

  const manifestUrl = await test.step('the page links the manifest', async () => {
    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(href).toBeTruthy()
    return new URL(href!, page.url()).toString()
  })

  const manifest = await test.step('the manifest is served as a web app manifest', async () => {
    const response = await page.request.get(manifestUrl)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toMatch(/^application\/manifest\+json/)
    return (await response.json()) as {
      name: string
      short_name: string
      display: string
      start_url: string
      scope: string
      theme_color: string
      background_color: string
      icons: { src: string; sizes: string; type: string; purpose?: string }[]
    }
  })

  await test.step('it opens standalone as อีช้อป in the brand red', async () => {
    expect(manifest).toMatchObject({
      name: 'อีช้อป',
      short_name: 'eShop',
      display: 'standalone',
      start_url: '/',
      scope: '/',
      theme_color: BRAND_RED,
      background_color: BRAND_RED,
    })
  })

  await test.step('its icons include 192 and 512 px and a maskable 512 px icon, and each one loads', async () => {
    const icons = manifest.icons.map((icon) => ({ ...icon, purpose: icon.purpose ?? 'any' }))
    expect(icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: '192x192', type: 'image/png', purpose: 'any' }),
        expect.objectContaining({ sizes: '512x512', type: 'image/png', purpose: 'any' }),
        expect.objectContaining({ sizes: '512x512', type: 'image/png', purpose: 'maskable' }),
      ]),
    )
    for (const icon of icons) {
      const [width, height] = icon.sizes.split('x').map(Number)
      expect(await pngSize(page.request, new URL(icon.src, manifestUrl).toString())).toEqual({ width, height })
    }
  })

  await test.step('iPhone "Add to Home Screen" gets a 180 px icon and the short name', async () => {
    const href = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')
    expect(href).toBeTruthy()
    expect(await pngSize(page.request, new URL(href!, page.url()).toString())).toEqual({ width: 180, height: 180 })
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'eShop')
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', BRAND_RED)
  })
})

// Offline (#59): a service worker keeps the built static files and an offline page. API requests, images and the
// mocks always go to the network, so Applications, Offers, Contracts, Payments and Bids are never stale.

/** Opens the catalog and waits until the service worker controls it (the first visit installs it). */
async function openControlledPage(page: Page) {
  await page.goto('/')
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? 'none'))
    .toBe('activated')
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? 'none')).toMatch(/\/sw\.js$/)
}

test('offline: a service worker registers and controls the page', async ({ page }) => {
  await openControlledPage(page)
  expect(page.context().serviceWorkers().map((worker) => new URL(worker.url()).pathname)).toContain('/sw.js')
})

test('offline: opening eShop without a connection shows the offline page', async ({ page, context }) => {
  await openControlledPage(page)
  await context.setOffline(true)
  try {
    for (const path of ['/products/1', '/staff/sign-in']) {
      await test.step(`${path} shows the offline page`, async () => {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('คุณออฟไลน์อยู่')
        await expect(page.getByText('eShop', { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'ลองอีกครั้ง' })).toBeVisible()
        await expectPageFits(page)
      })
    }
  } finally {
    await context.setOffline(false)
  }

  await test.step('back online, trying again opens the page', async () => {
    await page.getByRole('button', { name: 'ลองอีกครั้ง' }).click()
    await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบพนักงาน' })).toBeVisible()
  })
})

test('offline: API requests, images and the mocks always come from the network', async ({ page, context }) => {
  await openControlledPage(page)

  await test.step('the catalog loads its API data and photos from the network, not through the worker', async () => {
    const api = page.waitForResponse((response) => new URL(response.url()).pathname.startsWith('/api/'))
    const image = page.waitForResponse((response) => new URL(response.url()).pathname.startsWith('/images/'))
    // The page load itself does go through the worker (its offline fallback), so fromServiceWorker() can tell.
    expect((await page.reload())?.fromServiceWorker()).toBe(true)
    expect((await api).fromServiceWorker(), 'API response came through the service worker').toBe(false)
    expect((await image).fromServiceWorker(), 'image came through the service worker').toBe(false)
  })

  await test.step('Cache Storage holds static files only: no API responses or images', async () => {
    const cached = await page.evaluate(async () => {
      const paths: string[] = []
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname)
      }
      return paths
    })
    expect(cached).toContain('/offline.html')
    expect(cached.filter((path) => /^\/(api|images|thirdparty-mock)\//.test(path))).toEqual([])
  })

  await test.step('offline, an API request fails instead of returning a saved copy', async () => {
    await context.setOffline(true)
    try {
      const result = await page.evaluate(() =>
        fetch('/api/product-categories').then(
          (response) => `status ${response.status}`,
          () => 'network error',
        ),
      )
      expect(result).toBe('network error')
    } finally {
      await context.setOffline(false)
    }
  })

  // The mocks (SMS inbox, Enterprise admin tool) share the app's origin on the dev host only.
  if (new URL(mockBaseURL).origin === new URL(page.url()).origin) {
    await test.step('the mock SMS inbox is not served by the worker', async () => {
      const response = await page.goto(`${mockBaseURL}/thirdparty-mock/sms/inbox`)
      expect(response?.ok()).toBe(true)
      expect(response?.fromServiceWorker()).toBe(false)
    })
  }
})

test('offline: a new deploy takes over and deletes the old cache', async ({ page }) => {
  await openControlledPage(page)
  const cacheNames = () => page.evaluate(() => caches.keys())

  await test.step('a cache left by a previous deploy is present', async () => {
    await page.evaluate(async () => {
      const cache = await caches.open('eshop-static-previous-deploy')
      await cache.put('/assets/index-old.js', new Response('// previous deploy'))
    })
    expect(await cacheNames()).toContain('eshop-static-previous-deploy')
  })

  await test.step('the next deploy\'s worker takes over without closing the app', async () => {
    // Stands in for a new build: a new worker for the same scope (here, the same file at a new address), which the
    // browser installs as an update just as it does a byte-different /sw.js after a deploy.
    const controller = await page.evaluate(async () => {
      const changed = new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }),
      )
      await navigator.serviceWorker.register('/sw.js?deploy=next')
      await changed
      const registration = (await navigator.serviceWorker.getRegistration())!
      return { script: navigator.serviceWorker.controller?.scriptURL, waiting: registration.waiting }
    })
    expect(controller.script).toMatch(/\/sw\.js\?deploy=next$/)
    expect(controller.waiting, 'the new worker is left waiting for the app to close').toBeNull()
  })

  await test.step("an older deploy's build file is a 404, never the app's page", async () => {
    const response = await page.request.get('/assets/index-previous-deploy.js')
    expect(response.status()).toBe(404)
    expect(response.headers()['cache-control'] ?? '').not.toContain('immutable')
  })

  await test.step("only the new deploy's cache is left, with the offline page in it", async () => {
    await expect.poll(cacheNames).not.toContain('eshop-static-previous-deploy')
    expect(await cacheNames()).toHaveLength(1)
    expect(await page.evaluate(async () => (await caches.match('/offline.html')) !== undefined)).toBe(true)
  })
})
