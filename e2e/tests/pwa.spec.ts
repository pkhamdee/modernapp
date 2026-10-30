import { expect, test, type APIRequestContext } from '@playwright/test'

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
