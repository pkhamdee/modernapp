import { expect, test, type Browser, type Page } from '@playwright/test'
import { baseURL, mockBaseURL } from '../environment'

// Browser steps shared by the demo test. Everything goes through the UI a person would use: the eShop web app,
// the mock SMS inbox and the mock Enterprise System admin tool (thirdparty-mock).

/** 1×1 PNG: good enough for the mock ID Verification and for a Lot photo. */
export const PHOTO = {
  name: 'photo.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
}

/** The old brand (#47). Brand words only: Customer names from the mock ID Verification are Thai surnames. */
export const OLD_BRAND = /S Phone|เอส ลีสซิ่ง|Srisawad/i

/**
 * The check every eShop page passes at both sizes, run after each navigation (a goto, or a click that leads to
 * another page) once the page shows what the step expects: it does not scroll sideways and no old brand text is
 * visible. Not for the mock pages (SMS inbox, Enterprise admin tool), which are not the eShop app.
 */
export async function expectPageFits(page: Page) {
  await expect(page.locator('body')).not.toContainText(OLD_BRAND)
  await expect
    .poll(
      () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      { message: `${new URL(page.url()).pathname} scrolls sideways by (px)` },
    )
    .toBe(0)
}

/** Opens an eShop page by its address and runs the per-page check. */
export async function visit(page: Page, path: string) {
  await page.goto(path)
  await expectPageFits(page)
}

/**
 * Which of the parallel workers runs this test (0, 1, …). Tests running at the same moment always have
 * different indexes, so putting it in generated numbers keeps the phone and desktop runs' Customers apart.
 */
function workerDigit(): string {
  return String(test.info().parallelIndex % 10)
}

/** A fresh mobile number per test (^0[6-9]\d{8}$), never the one a parallel test uses. */
export function newMobileNumber(): string {
  return '09' + workerDigit() + String(Math.floor(Math.random() * 1e7)).padStart(7, '0')
}

/**
 * A fresh 13-digit ID number per test. thirdparty-mock decides by the last two digits (…01 ID Verification and
 * Credit Check pass with a ฿50,000 limit, …02 Credit Check fails); the 30-day wait after a Rejection follows the
 * ID number, so every run needs a new one. Prefix 3 keeps clear of the other verification scripts' prefixes; the
 * worker digit keeps two tests applying in the same millisecond apart.
 */
export function newIdNumber(outcome: '01' | '02'): string {
  return '3' + workerDigit() + String(Date.now()).slice(-9) + outcome
}

/** A Lot title no other test or project uses, so its Staff and Customer steps find only their own Lot. */
export function newLotTitle(): string {
  return `E2E iPhone 15 128GB ${test.info().project.name} #${Date.now()}`
}

/** A second tab on the mock SMS inbox (/thirdparty-mock/sms/inbox?to=…), standing in for the Customer's phone. */
export class Phone {
  private constructor(
    private readonly inbox: Page,
    private readonly mobileNumber: string,
  ) {}

  static async open(browser: Browser, mobileNumber: string): Promise<Phone> {
    const context = await browser.newContext({ baseURL: mockBaseURL, ignoreHTTPSErrors: true })
    return new Phone(await context.newPage(), mobileNumber)
  }

  private messages() {
    return this.inbox.locator('section ol li')
  }

  private async refresh() {
    await this.inbox.goto(`/thirdparty-mock/sms/inbox?to=${this.mobileNumber}`)
  }

  /** How many SMS this number has received so far. */
  async received(): Promise<number> {
    await this.refresh()
    return this.messages().count()
  }

  /** Waits for an SMS newer than the first `before` and returns the 6-digit code in it. */
  async codeAfter(before: number): Promise<string> {
    let code = ''
    await expect(async () => {
      await this.refresh()
      expect(await this.messages().count()).toBeGreaterThan(before)
      const text = await this.messages().first().innerText() // newest first
      code = /(?<!\d)\d{6}(?!\d)/.exec(text)?.[0] ?? ''
      expect(code).not.toBe('')
    }).toPass({ timeout: 30_000 })
    return code
  }

  async close() {
    await this.inbox.context().close()
  }
}

/** Customer sign-in by SMS: mobile number, then the code read from the mock inbox. */
export async function signInCustomer(page: Page, phone: Phone, mobileNumber: string) {
  const before = await phone.received()
  await visit(page, '/sign-in?next=/account')
  await page.getByLabel('เบอร์มือถือ').fill(mobileNumber)
  await page.getByRole('button', { name: 'ขอรหัส SMS' }).click()
  await expect(page.getByRole('heading', { name: 'กรอกรหัสยืนยัน' })).toBeVisible()
  await expectPageFits(page)
  await page.getByLabel('รหัส SMS').fill(await phone.codeAfter(before))
  await page.getByRole('button', { name: 'ยืนยัน', exact: true }).click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expectPageFits(page)
}

/**
 * From the catalog: open the Product, choose Down Payment and Term in the calculator, then submit the
 * Application with an ID number and an ID card photo, picking the Product up at a Branch.
 */
export async function applyForHirePurchase(
  page: Page,
  application: { product: RegExp; downPayment: number; term: number; idNumber: string; branch: string },
) {
  await page.goto('/categories/mobile-phone')
  await expect(page.getByRole('link', { name: application.product }).first()).toBeVisible()
  await expectPageFits(page)
  await page.getByRole('link', { name: application.product }).click()
  await expect(page.getByLabel('เงินดาวน์ (ไม่บังคับ)')).toBeVisible()
  await expectPageFits(page)
  await page.getByLabel('เงินดาวน์ (ไม่บังคับ)').fill(String(application.downPayment))
  // The Term radio sits under its styled label: pick it by clicking the label, as a person would.
  await page.locator('.term-option').getByText(`${application.term} งวด`, { exact: true }).click()
  await expect(page.getByRole('radio', { name: `${application.term} งวด`, exact: true })).toBeChecked()
  const apply = page.getByRole('link', { name: 'สมัครผ่อนด้วยบัตรประชาชนใบเดียว' })
  await expect(apply).toHaveAttribute(
    'href',
    new RegExp(`term=${application.term}&downPayment=${application.downPayment}$`),
  )
  await apply.click()

  await expect(page.getByLabel('เลขประจำตัวประชาชน')).toBeVisible()
  await expectPageFits(page)
  await page.getByLabel('เลขประจำตัวประชาชน').fill(application.idNumber)
  await page.getByLabel('รูปถ่ายบัตรประชาชน (1 รูป)').setInputFiles(PHOTO)
  await page.getByRole('radio', { name: 'รับสินค้าที่สาขา' }).check()
  await page.getByRole('combobox', { name: 'สาขา', exact: true }).selectOption(application.branch)
  await page.getByRole('button', { name: 'ส่งคำขอ' }).click()
  await expect(page).toHaveURL(/\/applications\/\d+$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expectPageFits(page)
}

/** A Staff browser (its own context: signing in as Staff would sign the Customer out). */
export async function staffPage(browser: Browser, next: string): Promise<Page> {
  const username = process.env.STAFF_USERNAME
  const password = process.env.STAFF_PASSWORD
  if (!username || !password) throw new Error('STAFF_USERNAME / STAFF_PASSWORD missing (see global-setup.ts)')

  const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true })
  // locator.fill(password) would put the password in the step title of the HTML report. Instead the page asks
  // the test process for it and types it in itself, so it never appears as an action parameter.
  await context.exposeFunction('e2eStaffPassword', () => password)
  const page = await context.newPage()
  await visit(page, `/staff/sign-in?next=${encodeURIComponent(next)}`)
  await page.getByLabel('ชื่อผู้ใช้').fill(username)
  await page.getByLabel('รหัสผ่าน').evaluate(async (input: HTMLInputElement) => {
    const value = await (window as unknown as { e2eStaffPassword: () => Promise<string> }).e2eStaffPassword()
    // React listens for input events; set the value the way typing would.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  await expect(page).toHaveURL(new RegExp(`${next}$`))
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expectPageFits(page)
  return page
}

/** "2026-10-30T14:05" in Asia/Bangkok, as a datetime-local field takes it. */
export function bangkokLocal(at: Date): string {
  return new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 16)
}
