import { expect, test } from '@playwright/test'
import { environment, mockBaseURL } from '../environment'
import {
  applyForHirePurchase,
  bangkokLocal,
  newIdNumber,
  newMobileNumber,
  Phone,
  PHOTO,
  signInCustomer,
  staffPage,
} from './steps'

// Seam 4: the MVP's definition-of-done demo (spec #1), end to end in a browser against a deployed environment.

// The eShop brand (#47): Customer and Staff screens name eShop / อีช้อป and nothing of the old brand.
test('brand: Customer and Staff screens show eShop', async ({ page, browser }) => {
  const oldBrand = /S Phone|เอส ลีสซิ่ง|Srisawad/i

  for (const path of ['/', '/auction', '/sign-in', '/staff/sign-in']) {
    await test.step(`${path} shows the eShop brand`, async () => {
      await page.goto(path)
      await expect(page).toHaveTitle('eShop – ผ่อนง่าย ใช้แค่บัตรประชาชน')
      const logo = page.getByRole('banner').getByRole('link', { name: /eShop/ })
      await expect(logo).toContainText('eShop')
      await expect(logo).toContainText('อีช้อป')
      await expect(page.locator('body')).not.toContainText(oldBrand)
    })
  }

  await test.step('the logo leads back to the catalog', async () => {
    await page.goto('/auction')
    await page.getByRole('banner').getByRole('link', { name: /eShop/ }).click()
    await expect(page).toHaveURL(/\/$/)
  })

  await test.step('the mock Enterprise System admin tool is eShop Co.’s', async () => {
    const context = await browser.newContext({ baseURL: mockBaseURL, ignoreHTTPSErrors: true })
    const enterprise = await context.newPage()
    await enterprise.goto('/thirdparty-mock/enterprise/')
    await expect(enterprise.getByRole('heading', { level: 1 })).toHaveText('eShop Co. Enterprise System (mock)')
    await expect(enterprise.locator('body')).not.toContainText(oldBrand)
    await context.close()
  })
})

test('hire purchase: SMS sign-in, Application, Offer, Contract in the Enterprise System, Handover, Payment', async ({
  page,
  browser,
}) => {
  const mobileNumber = newMobileNumber()
  const phone = await Phone.open(browser, mobileNumber)
  const enterprise = await (await browser.newContext({ baseURL: mockBaseURL, ignoreHTTPSErrors: true })).newPage()

  await test.step('Customer signs in by SMS (code from the mock inbox)', async () => {
    await signInCustomer(page, phone, mobileNumber)
  })

  await test.step('Customer applies for an iPhone with an ID card photo and is Approved within 60 s', async () => {
    await applyForHirePurchase(page, {
      product: /iPhone/,
      downPayment: 1000,
      term: 12,
      idNumber: newIdNumber('01'),
      branch: 'bkk-ladprao',
    })
    await expect(page.getByRole('heading', { name: 'อนุมัติแล้ว' })).toBeVisible({ timeout: 60_000 })
  })

  let contractNumber = ''
  await test.step('Customer accepts the Offer with an SMS code', async () => {
    await page.getByRole('link', { name: 'ดูข้อเสนอและยืนยัน' }).click()
    await expect(page.getByRole('heading', { name: 'ข้อเสนอเช่าซื้อ' })).toBeVisible()
    const before = await phone.received()
    await page.getByRole('button', { name: 'ยอมรับข้อเสนอ (รับรหัสทาง SMS)' }).click()
    await page.getByLabel('รหัส SMS เพื่อยืนยันการยอมรับข้อเสนอ').fill(await phone.codeAfter(before))
    await page.getByRole('button', { name: 'ยืนยันและทำสัญญา' }).click()
    await expect(page).toHaveURL(/\/contracts\/SP-\d{6}-\d{6}$/)
    contractNumber = (await page.locator('.contract-number').innerText()).trim()
    expect(contractNumber).toMatch(/^SP-\d{6}-\d{6}$/)
  })

  const enterpriseContract = () =>
    enterprise.locator('section', { has: enterprise.getByRole('heading', { name: contractNumber }) })

  await test.step('the Contract appears in the mock Enterprise System (eshop-sync-master push)', async () => {
    await expect(async () => {
      await enterprise.goto(`/thirdparty-mock/enterprise/${environment}/`)
      await expect(enterpriseContract()).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 90_000, intervals: [3_000] })
    await expect(enterpriseContract().getByRole('heading')).toContainText('ACTIVE')
  })

  await test.step('Staff record the Handover (Down Payment, ready at the Branch, handed over)', async () => {
    const staff = await staffPage(browser, `/staff/handovers/${contractNumber}`)
    await expect(staff.locator('.contract-number')).toHaveText(contractNumber)
    await staff.getByRole('button', { name: 'ดูรูปบัตรประชาชน' }).click()
    await expect(staff.getByRole('img', { name: /รูปบัตรประชาชนของ/ })).toBeVisible()

    staff.once('dialog', (dialog) => void dialog.accept()) // "received the Down Payment?" confirmation
    await staff.getByRole('button', { name: /บันทึกรับเงินดาวน์/ }).click()
    await expect(staff.getByText(/รับแล้ว/)).toBeVisible()
    await staff.getByRole('button', { name: 'สินค้าพร้อมให้รับที่สาขา' }).click()
    await expect(staff.getByText('พร้อมให้รับที่สาขา', { exact: true })).toBeVisible()
    await staff.getByRole('button', { name: 'ส่งมอบสินค้าแล้ว' }).click()
    await expect(staff.getByText('ส่งมอบแล้ว', { exact: true })).toBeVisible()
    await staff.context().close()

    await page.reload()
    await expect(page.locator('.handover-stage')).toContainText('รับสินค้าแล้ว')
    await expect(page.getByRole('cell', { name: 'รอรับสินค้า' })).toHaveCount(0) // due dates are set now
  })

  await test.step('a Payment simulated in the Enterprise System syncs back to the Customer’s Contract', async () => {
    await enterprise.goto(`/thirdparty-mock/enterprise/${environment}/`)
    await enterpriseContract().getByRole('button', { name: 'Simulate Payment' }).click()
    await expect(enterpriseContract()).toContainText('in 1 Payment(s)')

    await expect(async () => {
      await page.reload()
      await expect(page.getByText('ชำระแล้วทั้งหมด')).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 120_000, intervals: [5_000] })
    await expect(page.locator('table.schedule').last().locator('tbody tr')).toHaveCount(1)
  })

  await phone.close()
  await enterprise.context().close()
})

test('auction: an ID-verified Customer bids on a Lot and wins it when the Auction closes', async ({ page, browser }) => {
  const mobileNumber = newMobileNumber()
  const phone = await Phone.open(browser, mobileNumber)

  await test.step('Customer signs in and passes ID Verification (Application whose Credit Check fails)', async () => {
    await signInCustomer(page, phone, mobileNumber)
    await applyForHirePurchase(page, {
      product: /iPhone/,
      downPayment: 0,
      term: 12,
      idNumber: newIdNumber('02'),
      branch: 'bkk-ladprao',
    })
    await expect(page.getByRole('heading', { name: 'ไม่ผ่านการพิจารณา' })).toBeVisible({ timeout: 60_000 })
  })

  // The weekly Auction runs Monday 10:00 to Sunday 20:00. To win without waiting a week, Staff create one with
  // their own times (the back office allows any future closing time): open now, closing about two minutes ahead.
  const title = `E2E iPhone 15 128GB #${Date.now()}`
  let lotPath = ''
  await test.step('Staff create an Auction closing about two minutes ahead and add a Lot with a photo', async () => {
    const staff = await staffPage(browser, '/staff/auctions')
    const now = Date.now()
    const closesAt = new Date(Math.floor(now / 60_000) * 60_000 + 2 * 60_000)
    await staff.getByRole('checkbox', { name: 'กำหนดเวลาเอง' }).check()
    await staff.getByLabel('เปิดประมูล', { exact: true }).fill(bangkokLocal(new Date(now - 60_000)))
    await staff.getByLabel('ปิดประมูล', { exact: true }).fill(bangkokLocal(closesAt))
    await staff.getByRole('button', { name: 'สร้างการประมูล' }).click()
    await expect(staff).toHaveURL(/\/staff\/auctions\/\d+$/)

    await staff.getByRole('button', { name: '+ เพิ่มรายการ' }).click()
    await staff.getByLabel('รุ่น ความจุ และสี').fill(title)
    await staff.getByLabel('สภาพเครื่อง').fill('สภาพดี แบตเตอรี่ 90% พร้อมกล่อง')
    await staff.getByLabel('ราคาเริ่มต้น (บาท)').fill('5000')
    await staff.getByLabel('เพิ่มรูป').setInputFiles(PHOTO)
    await expect(staff.getByText(/รูปถ่าย \(1\//)).toBeVisible()
    await staff.getByRole('button', { name: 'บันทึก', exact: true }).click()
    const lot = staff.locator('li', { hasText: title })
    lotPath = (await lot.getByRole('link', { name: 'ดูหน้าประมูล' }).getAttribute('href')) ?? ''
    expect(lotPath).toMatch(/^\/auction\/lots\/\d+$/)
    await staff.context().close()
  })

  await test.step('Customer bids on the Lot', async () => {
    await page.goto(lotPath)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await page.getByRole('button', { name: /^เสนอราคา/ }).click()
    await expect(page.getByText(/เสนอราคา .+ สำเร็จ/)).toBeVisible()
    await expect(page.getByText('คุณเป็นผู้เสนอราคาสูงสุดตอนนี้')).toBeVisible()
  })

  await test.step('the Auction closes and the Customer has won the Lot', async () => {
    // The Lot page polls every 3 s; once the Auction is closed it shows the result.
    await expect(page.getByText('คุณชนะการประมูล!')).toBeVisible({ timeout: 4 * 60_000 })
    await page.goto('/won-lots')
    await expect(page.getByRole('link', { name: title })).toBeVisible()
  })

  await phone.close()
})
