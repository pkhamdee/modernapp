# S Phone

S Phone (เอส ลีสซิ่ง) lets a Customer buy phones, iPads, electrical appliances, furniture and electric motorcycles on hire purchase using only their national ID card, and runs a weekly auction of used iPhones.

## Parties

**Customer** (ลูกค้า):
A person who applies for hire purchase, holds Contracts, or bids in an Auction.
_Avoid_: User, client, applicant, member

**Staff** (พนักงาน):
An S Phone employee who hands over goods, records payments taken at a shop, and runs Auctions.
_Avoid_: Admin, operator, agent

**Enterprise System** (ระบบหลักขององค์กร):
Srisawad's core hire-purchase system, which owns Contracts and Payments once they exist.
_Avoid_: HPE, backend, core, legacy

## Hire purchase

**Product** (สินค้า):
An item offered for hire purchase, belonging to exactly one Product Category.
_Avoid_: Item, SKU, goods

**Product Category** (ประเภทสินค้า):
A grouping of Products (mobile phone, iPad, electrical appliance, furniture, electric motorcycle) that sets the Flat Rate and the longest Term allowed.
_Avoid_: Type, class

**Eligibility** (คุณสมบัติผู้สมัคร):
The rules a Customer must meet before an Application can be submitted: aged 20 or over, no active Contract, and not within 30 days of a Rejected Application.
_Avoid_: Pre-approval, screening

**Application** (คำขอเช่าซื้อ):
A Customer's request to buy one Product on hire purchase with a chosen Term and Down Payment, decided using their national ID card alone.
_Avoid_: Order, request, loan application

**ID Verification** (การตรวจสอบบัตรประชาชน):
The check that a national ID number and card photo belong to a real, living person.
_Avoid_: KYC, DOPA check

**Credit Check** (การตรวจสอบเครดิต):
The check of a Customer's credit history, used to decide an Application.
_Avoid_: NCB check, scoring

**Credit Limit** (วงเงิน):
The largest amount a Customer may finance, as returned by the Credit Check.
_Avoid_: Credit line, budget

**Credit Decision** (ผลการพิจารณา):
The automatic outcome of an Application: Approved or Rejected.
_Avoid_: Approval status, result

**Offer** (ข้อเสนอ):
The price, Down Payment, Term and Installment of an Approved Application, which the Customer accepts or declines; it expires after 7 days.
_Avoid_: Quote, proposal

**Contract** (สัญญาเช่าซื้อ):
The binding hire-purchase agreement created when a Customer accepts an Offer; only the Enterprise System can cancel it.
_Avoid_: Loan, lease, deal, order

**Term** (จำนวนงวด):
The number of monthly Installments in a Contract: 6, 10, 12, 18 or 24.
_Avoid_: Tenor, duration, period

**Installment** (ค่างวด):
One fixed monthly amount owed under a Contract, never less than ฿500.
_Avoid_: Monthly payment, EMI, bill

**Down Payment** (เงินดาวน์):
An optional upfront amount that reduces what is financed.
_Avoid_: Deposit

**Flat Rate** (อัตราดอกเบี้ยคงที่):
Monthly interest charged on the original financed amount for the whole Term.
_Avoid_: APR, interest rate

**Payment** (การชำระเงิน):
Money received against a Contract's Installments.
_Avoid_: Transaction, repayment

**Delivery** (จัดส่ง):
Handing over a Contract's Product at the Customer's address, free and only within the Bangkok Metropolitan Region.
_Avoid_: Shipping

**Store Pickup** (รับสินค้าที่ร้าน):
Handing over a Contract's Product to the Customer at a Branch.
_Avoid_: Collection, click-and-collect

**Branch** (สาขา):
An S Phone shop where a Customer can collect goods and pay at handover.
_Avoid_: Store, shop, outlet

**Handover** (การส่งมอบสินค้า):
The moment the Customer receives the Product, by Delivery or Store Pickup, after paying any Down Payment.
_Avoid_: Fulfilment, shipment, dispatch

## Auction

**Auction** (การประมูล):
A weekly, time-boxed sale of used iPhones in Lots, won by the highest Bid when it closes.
_Avoid_: Sale, event

**Lot** (รายการประมูล):
One used iPhone, complete with its box, offered in an Auction; if the winner does not pay within 3 days it is Forfeited and may be offered again in a later Auction.
_Avoid_: Listing, item

**Bid** (การเสนอราคา):
A Customer's offer for a Lot, which must beat the current highest Bid by at least the minimum increment.
_Avoid_: Offer
