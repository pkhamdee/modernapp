import { expect, test } from '@playwright/test'
import { environment, mockBaseURL } from '../environment'
import {
  applyForHirePurchase,
  bangkokLocal,
  customerHeader,
  expectFitsNarrowestPhone,
  expectFormColumn,
  expectPageFits,
  expectResponsiveList,
  gridColumns,
  isPhone,
  listRows,
  navigateStaffTo,
  navigateTo,
  newIdNumber,
  newLotTitle,
  newMobileNumber,
  OLD_BRAND,
  Phone,
  PHOTO,
  placement,
  signInCustomer,
  staffMenu,
  staffPage,
  visit,
  type StaffSection,
} from './steps'

// Seam 4: the MVP's definition-of-done demo (spec #1), end to end in a browser against a deployed environment.
// It runs in full at phone and desktop sizes (playwright.config.ts projects); after every navigation
// expectPageFits checks that the page does not scroll sideways and shows no old brand text (#51).

// The eShop brand (#47): Customer and Staff screens name eShop / อีช้อป and nothing of the old brand.
test('brand: Customer and Staff screens show eShop', async ({ page, browser }) => {
  for (const path of ['/', '/auction', '/sign-in', '/staff/sign-in']) {
    await test.step(`${path} shows the eShop brand`, async () => {
      await page.goto(path)
      await expect(page).toHaveTitle('eShop – ผ่อนง่าย ใช้แค่บัตรประชาชน')
      const logo = page.getByRole('banner').getByRole('link', { name: /eShop/ })
      await expect(logo).toContainText('eShop')
      await expect(logo).toContainText('อีช้อป')
      await expectPageFits(page)
    })
  }

  await test.step('the logo leads back to the catalog', async () => {
    await visit(page, '/auction')
    await page.getByRole('banner').getByRole('link', { name: /eShop/ }).click()
    await expect(page).toHaveURL(/\/$/)
    await expectPageFits(page)
  })

  await test.step('the header opens Catalog, Auctions and Account: a menu on phone, a top bar on desktop', async () => {
    await visit(page, '/')
    const { menuButton, nav } = customerHeader(page)
    if (isPhone()) {
      // The menu button announces open/closed, names the menu it controls, and Escape closes it again.
      await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
      await expect(nav).toBeHidden()
      await menuButton.click()
      await expect(menuButton).toHaveAttribute('aria-expanded', 'true')
      await expect(nav).toBeVisible()
      await expect(nav).toHaveAttribute('id', (await menuButton.getAttribute('aria-controls')) ?? 'no aria-controls')
      await page.keyboard.press('Escape')
      await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
      await expect(nav).toBeHidden()
      await expect(menuButton).toBeFocused()
      expect((await menuButton.boundingBox())?.height).toBeGreaterThanOrEqual(44)
      await menuButton.click()
    } else {
      await expect(menuButton).toBeHidden()
    }
    // Touch targets at least 44px tall.
    for (const link of await nav.getByRole('link').all()) {
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    }
    if (isPhone()) await page.keyboard.press('Escape')

    await navigateTo(page, 'ประมูล')
    await expect(page).toHaveURL(/\/auction$/)
    await expectPageFits(page)
    await navigateTo(page, 'เข้าสู่ระบบ')
    await expect(page).toHaveURL(/\/sign-in$/)
    await expectPageFits(page)
    await navigateTo(page, 'สินค้า')
    await expect(page).toHaveURL(/\/$/)
    await expectPageFits(page)
  })

  if (!isPhone()) {
    await test.step('at 200% zoom the page reflows to the phone header without scrolling sideways', async () => {
      // A 1280×800 window at 200% zoom lays out like a 640×400 one.
      await page.setViewportSize({ width: 640, height: 400 })
      await visit(page, '/')
      await expect(customerHeader(page).menuButton).toBeVisible()
      await expect(customerHeader(page).nav).toBeHidden()
      await page.setViewportSize({ width: 1280, height: 800 })
    })
  }

  await test.step('the mock Enterprise System admin tool is eShop Co.’s', async () => {
    const context = await browser.newContext({ baseURL: mockBaseURL, ignoreHTTPSErrors: true })
    const enterprise = await context.newPage()
    await enterprise.goto('/thirdparty-mock/enterprise/')
    await expect(enterprise.getByRole('heading', { level: 1 })).toHaveText('eShop Co. Enterprise System (mock)')
    await expect(enterprise.locator('body')).not.toContainText(OLD_BRAND)
    await context.close()
  })
})

// The Staff back office (#55): a sidebar on desktop, a slide-out menu on phone, and every list in the shared
// table (desktop) / cards (phone) pattern.
test('back office: the Staff menu reaches every list, shown as tables on desktop and cards on phone', async ({
  browser,
}) => {
  const staff = await staffPage(browser, '/staff/products')

  await test.step('the menu: always-visible sidebar on desktop, slide-out menu behind a button on phone', async () => {
    const { menuButton, nav } = staffMenu(staff)
    if (isPhone()) {
      // The menu button announces open/closed, names the menu it controls, and Escape closes it again.
      await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
      await expect(nav).toBeHidden()
      expect((await menuButton.boundingBox())?.height).toBeGreaterThanOrEqual(44)
      await menuButton.click()
      await expect(menuButton).toHaveAttribute('aria-expanded', 'true')
      await expect(nav).toBeVisible()
      await expect(nav).toHaveAttribute('id', (await menuButton.getAttribute('aria-controls')) ?? 'no aria-controls')
    } else {
      await expect(menuButton).toBeHidden()
      await expect(nav).toBeVisible()
    }
    for (const link of await nav.getByRole('link').all()) {
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    }
    if (isPhone()) {
      await staff.keyboard.press('Escape')
      await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
      await expect(nav).toBeHidden()
      await expect(menuButton).toBeFocused()
    }
  })

  const sections: { section: StaffSection; path: string; heading: string; list?: string[] }[] = [
    { section: 'ประเภทสินค้า', path: '/staff/product-categories', heading: 'ประเภทสินค้า',
      list: ['ประเภทสินค้า', 'อัตราดอกเบี้ยคงที่', 'งวดสูงสุด'] },
    { section: 'สาขา', path: '/staff/branches', heading: 'สาขา', list: ['สาขา', 'ที่อยู่', 'รหัส'] },
    { section: 'ประมูล', path: '/staff/auctions', heading: 'การประมูล' },
    { section: 'ส่งมอบสินค้า', path: '/staff/handovers', heading: 'รอส่งมอบสินค้า' },
    { section: 'สินค้า', path: '/staff/products', heading: 'สินค้า', list: ['สินค้า', 'ประเภทสินค้า', 'ราคา'] },
  ]
  for (const { section, path, heading, list } of sections) {
    await test.step(`${section}: reached from the menu${list ? ', listed as a table or cards' : ''}`, async () => {
      await navigateStaffTo(staff, section)
      await expect(staff).toHaveURL(new RegExp(`${path}$`))
      await expect(staff.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible()
      // The demo's own Auctions and Handovers come and go, so only the seeded lists are checked row by row.
      if (list) await expectResponsiveList(staff, heading, list)
      await expectPageFits(staff)
    })
  }

  await staff.context().close()
})

// The catalog and the Product page across sizes (#53). The phone project checks the phone layout; the desktop
// project also resizes its window to tablet (768px) and wide (1024px) widths.
test('catalog: Products in 1 / 2 / 3–4 columns and the Product page beside or above its calculator', async ({
  page,
}) => {
  // Mobile phones (มือถือ) has three demo Products: enough to tell one, two and three-or-more columns apart.
  const products = page.getByRole('main').getByRole('list')
  const sizes = isPhone()
    ? [{ name: 'phone', width: 390, columns: [1, 1] }]
    : [
        { name: 'desktop', width: 1280, columns: [3, 4] },
        { name: 'tablet', width: 768, columns: [2, 2] },
      ]
  for (const size of sizes) {
    await test.step(`${size.name}: the catalog shows Products in ${size.columns.join('–')} column(s)`, async () => {
      if (!isPhone()) await page.setViewportSize({ width: size.width, height: 800 })
      await visit(page, '/categories/mobile-phone')
      await expect(products.getByRole('listitem')).not.toHaveCount(0)
      expect(await products.getByRole('listitem').count()).toBeGreaterThanOrEqual(3)
      const columns = await gridColumns(products)
      expect(columns).toBeGreaterThanOrEqual(size.columns[0])
      expect(columns).toBeLessThanOrEqual(size.columns[1])
    })

    await test.step(`${size.name}: every Product Category can be chosen from the filter`, async () => {
      const filter = page.getByRole('navigation', { name: 'ประเภทสินค้า' })
      const categories = filter.getByRole('link')
      expect(await categories.count()).toBeGreaterThanOrEqual(2)
      if (!isPhone()) {
        // From tablet up the whole filter is on screen at once; on a phone it scrolls sideways within itself.
        for (const category of await categories.all()) await expect(category).toBeInViewport({ ratio: 1 })
      }
      for (const category of (await categories.all()).reverse()) {
        const name = (await category.innerText()).trim()
        expect((await category.boundingBox())?.height).toBeGreaterThanOrEqual(44)
        await category.click()
        await expect(category).toHaveAttribute('aria-current', 'page')
        await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
        await expect(products.getByRole('listitem').first()).toBeVisible()
        await expectPageFits(page)
      }
    })
  }

  // The photo sits beside the Installment calculator from 1024px (wide) and above it on narrower screens.
  const layouts = isPhone()
    ? [{ name: 'phone', width: 390, calculator: 'below' }]
    : [
        { name: 'desktop', width: 1280, calculator: 'beside' },
        { name: 'wide', width: 1024, calculator: 'beside' },
        { name: 'tablet', width: 768, calculator: 'below' },
      ]
  for (const layout of layouts) {
    await test.step(`${layout.name}: the Installment calculator is ${layout.calculator} the Product photo`, async () => {
      if (!isPhone()) await page.setViewportSize({ width: layout.width, height: 800 })
      await visit(page, '/categories/mobile-phone')
      await products.getByRole('link', { name: /iPhone/ }).first().click()
      const photo = page.getByRole('main').getByRole('img', { name: /iPhone/ })
      const calculator = page.getByRole('region', { name: 'คำนวณค่างวด' })
      await expect(photo).toBeVisible()
      await expect(calculator).toBeVisible()
      await expectPageFits(page)
      expect(await placement(photo, calculator)).toBe(layout.calculator)
    })
  }
  if (!isPhone()) await page.setViewportSize({ width: 1280, height: 800 })
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
    await expectPageFits(page)
  })

  let contractNumber = ''
  await test.step('Customer accepts the Offer with an SMS code', async () => {
    await page.getByRole('link', { name: 'ดูข้อเสนอและยืนยัน' }).click()
    await expect(page.getByRole('heading', { name: 'ข้อเสนอเช่าซื้อ' })).toBeVisible()
    await expectPageFits(page)
    // The Offer's terms: price, Down Payment, Term, Installment and expiry.
    for (const term of ['ราคา (ล็อกไว้ ณ วันที่สมัคร)', 'เงินดาวน์', 'จำนวนงวด', 'ค่างวด']) {
      await expect(page.getByRole('term').filter({ hasText: term })).toBeVisible()
    }
    await expect(page.getByRole('definition').filter({ hasText: '฿1,000' })).toBeVisible()
    await expect(page.getByRole('definition').filter({ hasText: '12 งวด' })).toBeVisible()
    await expect(page.getByText(/ข้อเสนอนี้ใช้ได้ถึง/)).toBeVisible()
    await expectFitsNarrowestPhone(page)
    const before = await phone.received()
    await page.getByRole('button', { name: 'ยอมรับข้อเสนอ (รับรหัสทาง SMS)' }).click()
    await expectFormColumn(page.getByLabel('รหัส SMS เพื่อยืนยันการยอมรับข้อเสนอ'))
    await page.getByLabel('รหัส SMS เพื่อยืนยันการยอมรับข้อเสนอ').fill(await phone.codeAfter(before))
    await page.getByRole('button', { name: 'ยืนยันและทำสัญญา' }).click()
    await expect(page).toHaveURL(/\/contracts\/SP-\d{6}-\d{6}$/)
    contractNumber = (await page.locator('.contract-number').innerText()).trim()
    expect(contractNumber).toMatch(/^SP-\d{6}-\d{6}$/)
    await expectPageFits(page)
  })

  await test.step('the Contract lists its Installments: a table on desktop, cards on phone', async () => {
    await expectResponsiveList(page, 'ตารางผ่อนชำระ', ['งวดที่', 'กำหนดชำระ', 'ค่างวด'])
    await expect(listRows(page, 'ตารางผ่อนชำระ')).toHaveCount(12)
    // Due dates are set at Handover.
    await expect(listRows(page, 'ตารางผ่อนชำระ').filter({ hasText: 'รอรับสินค้า' })).toHaveCount(12)
    await expect(page.getByText('ยังไม่มีการชำระค่างวด')).toBeVisible()
    await expectFitsNarrowestPhone(page)
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
    const staff = await staffPage(browser, '/staff/products')
    await navigateStaffTo(staff, 'ส่งมอบสินค้า')
    await expect(staff).toHaveURL(/\/staff\/handovers$/)
    // The new Contract is a row of the Handovers list (a table row on desktop, a card on phone).
    await staff.getByRole('link', { name: contractNumber, exact: true }).click()
    await expect(staff).toHaveURL(new RegExp(`/staff/handovers/${contractNumber}$`))
    await expect(staff.locator('.contract-number')).toHaveText(contractNumber)
    await expectPageFits(staff)
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
    await expectPageFits(page)
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
    await expectPageFits(page)
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
    await expectPageFits(page)
  })

  // The weekly Auction runs Monday 10:00 to Sunday 20:00. To win without waiting a week, Staff create one with
  // their own times (the back office allows any future closing time): open now, closing about two minutes ahead.
  const title = newLotTitle()
  let lotPath = ''
  await test.step('Staff create an Auction closing about two minutes ahead and add a Lot with a photo', async () => {
    const staff = await staffPage(browser, '/staff/products')
    await navigateStaffTo(staff, 'ประมูล')
    await expect(staff).toHaveURL(/\/staff\/auctions$/)
    await expect(staff.getByRole('heading', { level: 1, name: 'การประมูล' })).toBeVisible()
    await expectPageFits(staff)
    const now = Date.now()
    const closesAt = new Date(Math.floor(now / 60_000) * 60_000 + 2 * 60_000)
    await staff.getByRole('checkbox', { name: 'กำหนดเวลาเอง' }).check()
    await staff.getByLabel('เปิดประมูล', { exact: true }).fill(bangkokLocal(new Date(now - 60_000)))
    await staff.getByLabel('ปิดประมูล', { exact: true }).fill(bangkokLocal(closesAt))
    await staff.getByRole('button', { name: 'สร้างการประมูล' }).click()
    await expect(staff).toHaveURL(/\/staff\/auctions\/\d+$/)
    await expect(staff.getByRole('button', { name: '+ เพิ่มรายการ' })).toBeVisible()
    await expectPageFits(staff)

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
    await expectPageFits(staff)
    await staff.context().close()
  })

  await test.step('Customer bids on the Lot', async () => {
    await page.goto(lotPath)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expectPageFits(page)
    await page.getByRole('button', { name: /^เสนอราคา/ }).click()
    await expect(page.getByText(/เสนอราคา .+ สำเร็จ/)).toBeVisible()
    await expect(page.getByText('คุณเป็นผู้เสนอราคาสูงสุดตอนนี้')).toBeVisible()
    await expectPageFits(page)
  })

  await test.step('the Auction closes and the Customer has won the Lot', async () => {
    // The Lot page polls every 3 s; once the Auction is closed it shows the result.
    await expect(page.getByText('คุณชนะการประมูล!')).toBeVisible({ timeout: 4 * 60_000 })
    await expectPageFits(page)
    await navigateTo(page, 'บัญชีของฉัน')
    await expect(page).toHaveURL(/\/account$/)
    await expectPageFits(page)
    await page.getByRole('link', { name: 'ประมูลที่ชนะ' }).click()
    await expect(page).toHaveURL(/\/won-lots$/)
    await expect(page.getByRole('link', { name: title })).toBeVisible()
    await expectPageFits(page)
  })

  await phone.close()
})
