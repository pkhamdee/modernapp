import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
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

/** The Customer header's sections (#52). Account reads เข้าสู่ระบบ until the Customer signs in. */
export type Section = 'สินค้า' | 'ประมูล' | 'บัญชีของฉัน' | 'เข้าสู่ระบบ'

/** True in the phone project: the Customer header shows a menu button instead of the top bar. */
export function isPhone(): boolean {
  return test.info().project.name === 'phone'
}

/** The Customer header's menu button (phone) and its navigation (the menu on phone, the top bar from 768px). */
export function customerHeader(page: Page) {
  return {
    menuButton: page.getByRole('banner').getByRole('button', { name: 'เมนู' }),
    nav: page.getByRole('navigation', { name: 'เมนูหลัก' }),
  }
}

/**
 * Opens a Customer section the way a person would (#52): on a phone through the menu button, which announces
 * open/closed and closes again once a link is followed; on a desktop straight from the top bar. Callers check the
 * page they land on and then run expectPageFits.
 */
export async function navigateTo(page: Page, section: Section) {
  const { menuButton, nav } = customerHeader(page)
  if (isPhone()) {
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    await expect(nav).toBeHidden()
    await menuButton.click()
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true')
  } else {
    await expect(menuButton).toBeHidden()
  }
  await nav.getByRole('link', { name: section, exact: true }).click()
  if (isPhone()) {
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    await expect(nav).toBeHidden()
  }
}

/** The Staff back office's sections (#55), in its sidebar (desktop) or slide-out menu (phone). */
export type StaffSection = 'สินค้า' | 'ประเภทสินค้า' | 'สาขา' | 'ประมูล' | 'ส่งมอบสินค้า'

/** The Staff header's menu button (below 1280px) and the back-office menu (a sidebar from 1280px). */
export function staffMenu(page: Page) {
  return {
    menuButton: page.getByRole('banner').getByRole('button', { name: 'เมนู' }),
    nav: page.getByRole('navigation', { name: 'เมนูหลังร้าน' }),
  }
}

/**
 * Opens a Staff section the way Staff would (#55), mirroring navigateTo: on a phone through the menu button,
 * which announces open/closed and closes the slide-out menu once a link is followed; on a desktop straight from
 * the sidebar, which is always there. Callers check the page they land on and then run expectPageFits.
 */
export async function navigateStaffTo(page: Page, section: StaffSection) {
  const { menuButton, nav } = staffMenu(page)
  if (isPhone()) {
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    await expect(nav).toBeHidden()
    await menuButton.click()
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true')
  } else {
    await expect(menuButton).toBeHidden()
  }
  await nav.getByRole('link', { name: section, exact: true }).click()
  if (isPhone()) {
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    await expect(nav).toBeHidden()
  }
}

/**
 * A list shown with the shared table/cards pattern (#55), named `name`: a table with a header per column on
 * desktop; on a phone a list of cards, each showing every column's label beside its value, and no table.
 */
export async function expectResponsiveList(page: Page, name: string, columns: string[]) {
  const table = page.getByRole('table', { name, exact: true })
  const cards = page.getByRole('list', { name, exact: true })
  if (isPhone()) {
    await expect(cards).toBeVisible()
    await expect(table).toHaveCount(0)
    const card = cards.getByRole('listitem').first()
    // A card may hold a form whose fields repeat a label; the column label comes first.
    for (const column of columns) await expect(card.getByText(column, { exact: true }).first()).toBeVisible()
  } else {
    await expect(table).toBeVisible()
    await expect(cards).toHaveCount(0)
    for (const column of columns) {
      await expect(table.getByRole('columnheader', { name: column, exact: true })).toBeVisible()
    }
    await expect(table.getByRole('row').nth(1)).toBeVisible() // a row besides the header
  }
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
  await expectFormColumn(page.getByLabel('เบอร์มือถือ'))
  await page.getByLabel('เบอร์มือถือ').fill(mobileNumber)
  await page.getByRole('button', { name: 'ขอรหัส SMS' }).click()
  await expect(page.getByRole('heading', { name: 'กรอกรหัสยืนยัน' })).toBeVisible()
  await expectPageFits(page)
  await expectFormColumn(page.getByLabel('รหัส SMS'))
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
  await navigateTo(page, 'สินค้า')
  await expect(page).toHaveURL(/\/$/)
  await page.getByRole('navigation', { name: 'ประเภทสินค้า' }).getByRole('link', { name: 'มือถือ' }).click()
  await expect(page).toHaveURL(/\/categories\/mobile-phone$/)
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
  await expectFormColumn(page.getByLabel('เลขประจำตัวประชาชน'))
  await page.getByLabel('เลขประจำตัวประชาชน').fill(application.idNumber)
  // The ID card photo asks phones for the rear camera; a desktop browser ignores that and opens its file picker.
  const idCardPhoto = page.getByLabel('รูปถ่ายบัตรประชาชน (1 รูป)')
  await expect(idCardPhoto).toHaveAttribute('capture', 'environment')
  const fileChooser = page.waitForEvent('filechooser')
  await idCardPhoto.click()
  await (await fileChooser).setFiles(PHOTO)
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

/**
 * How many columns a grid of cards shows, read from where its items sit on screen (#53): the number of distinct
 * left edges. With fewer items than columns this is the item count, so use a list holding enough items.
 */
export async function gridColumns(list: Locator): Promise<number> {
  const lefts = await list
    .getByRole('listitem')
    .evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().left)))
  return new Set(lefts).size
}

/**
 * Where `second` sits relative to `first` on screen (#53): beside it (to its right, sharing some height) or below
 * it. Used for the photo and the panel next to it on Product and Lot pages.
 */
export async function placement(first: Locator, second: Locator): Promise<'beside' | 'below' | 'overlapping'> {
  const a = await first.boundingBox()
  const b = await second.boundingBox()
  if (!a || !b) throw new Error('placement: both elements must be visible')
  if (b.x >= a.x + a.width && b.y < a.y + a.height) return 'beside'
  if (b.y >= a.y + a.height) return 'below'
  return 'overlapping'
}

/**
 * A Customer form (sign-in, SMS code, Apply, Offer acceptance) is one narrow column centred in the window at every
 * size (#57): `field` is a full-width field of the form, so it is at most 480px wide and its middle is the
 * window's middle (within a pixel).
 */
export async function expectFormColumn(field: Locator) {
  await expect(field).toBeVisible()
  const box = await field.boundingBox()
  if (!box) throw new Error('expectFormColumn: the field must be visible')
  const windowWidth = await field.page().evaluate(() => document.documentElement.clientWidth)
  expect(box.width, 'form column width (px)').toBeLessThanOrEqual(480)
  expect(Math.abs(box.x + box.width / 2 - windowWidth / 2), 'form column off centre by (px)').toBeLessThanOrEqual(1)
}
