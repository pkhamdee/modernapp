import { expect, type Browser, type Page } from '@playwright/test'
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

/** A fresh mobile number per run (^0[6-9]\d{8}$). */
export function newMobileNumber(): string {
  return '09' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
}

/**
 * A fresh 13-digit ID number. thirdparty-mock decides by the last two digits (…01 ID Verification and Credit
 * Check pass with a ฿50,000 limit, …02 Credit Check fails); the 30-day wait after a Rejection follows the ID
 * number, so every run needs a new one. Prefix 3 keeps clear of the other verification scripts' prefixes.
 */
export function newIdNumber(outcome: '01' | '02'): string {
  return '3' + String(Date.now()).slice(-10) + outcome
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
  await page.goto('/sign-in?next=/account')
  await page.getByLabel('เบอร์มือถือ').fill(mobileNumber)
  await page.getByRole('button', { name: 'ขอรหัส SMS' }).click()
  await expect(page.getByRole('heading', { name: 'กรอกรหัสยืนยัน' })).toBeVisible()
  await page.getByLabel('รหัส SMS').fill(await phone.codeAfter(before))
  await page.getByRole('button', { name: 'ยืนยัน', exact: true }).click()
  await expect(page).toHaveURL(/\/account$/)
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
  await page.getByRole('link', { name: application.product }).click()
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

  await page.getByLabel('เลขประจำตัวประชาชน').fill(application.idNumber)
  await page.getByLabel('รูปถ่ายบัตรประชาชน (1 รูป)').setInputFiles(PHOTO)
  await page.getByRole('radio', { name: 'รับสินค้าที่สาขา' }).check()
  await page.getByRole('combobox', { name: 'สาขา', exact: true }).selectOption(application.branch)
  await page.getByRole('button', { name: 'ส่งคำขอ' }).click()
  await expect(page).toHaveURL(/\/applications\/\d+$/)
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
  await page.goto(`/staff/sign-in?next=${encodeURIComponent(next)}`)
  await page.getByLabel('ชื่อผู้ใช้').fill(username)
  await page.getByLabel('รหัสผ่าน').evaluate(async (input: HTMLInputElement) => {
    const value = await (window as unknown as { e2eStaffPassword: () => Promise<string> }).e2eStaffPassword()
    // React listens for input events; set the value the way typing would.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  await expect(page).toHaveURL(new RegExp(`${next}$`))
  return page
}

/** "2026-10-30T14:05" in Asia/Bangkok, as a datetime-local field takes it. */
export function bangkokLocal(at: Date): string {
  return new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 16)
}
