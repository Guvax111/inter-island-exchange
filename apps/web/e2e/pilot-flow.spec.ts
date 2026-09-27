import { expect, test, type Page } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ADMIN, EMAIL_DIR } from '../playwright.config';

/**
 * The St. Lucia -> St. Vincent pilot, end to end: the seller signs up and is approved, lists diapers, IIE approves
 * them; a buyer in St. Vincent finds them, checks out and pays on the sandbox page; the seller confirms and packs;
 * IIE's logistics partner and customs broker (invited by IIE) move the parcel through customs and deliver it with
 * proof of delivery; the buyer confirms receipt.
 */
const run = Date.now().toString(36);
const seller = { email: `seller-${run}@e2e.example`, password: 'castries-seller-password' };
const buyer = { email: `buyer-${run}@e2e.example`, password: 'kingstown-buyer-password' };
const productTitle = `E2E Soft Care Diapers ${run}`;

async function linkFromEmail(to: string, kind: 'verify-email' | 'reset-password') {
  const count = () => (existsSync(EMAIL_DIR) ? readdirSync(EMAIL_DIR).filter((f) => f.includes(to)).length : 0);
  await expect.poll(count, { timeout: 15_000 }).toBeGreaterThan(0);
  const file = readdirSync(EMAIL_DIR).filter((f) => f.includes(to)).sort().at(-1)!;
  const { text } = JSON.parse(readFileSync(path.join(EMAIL_DIR, file), 'utf8')) as { text: string };
  const match = new RegExp(`(https?://[\\w.:-]+/${kind}\\?token=[\\w%-]+(?:&invite=1)?)`).exec(text);
  expect(match, `link in email to ${to}`).not.toBeNull();
  return new URL(match![1]!).pathname + new URL(match![1]!).search;
}

/** Optional screenshots for documentation: set E2E_SCREENSHOT_DIR. */
async function shot(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.E2E_SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}

async function signIn(page: Page, email: string, password: string, next = '/account') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => u.pathname === next);
}

async function signUp(page: Page, type: 'SELLER' | 'BUYER', user: { email: string; password: string }, country: string, first: string) {
  await page.goto(`/signup?type=${type}`);
  await page.getByLabel('First name').fill(first);
  await page.getByLabel('Last name').fill('Tester');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByLabel('Country').selectOption(country);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();
  await page.goto(await linkFromEmail(user.email, 'verify-email'));
  await expect(page.getByText('Email confirmed')).toBeVisible();
}

test('pilot: St. Lucia seller lists diapers, St. Vincent buyer orders them', async ({ browser }) => {
  // ---- Seller applies
  const sellerPage = await (await browser.newContext()).newPage();
  await signUp(sellerPage, 'SELLER', seller, 'LC', 'Celia');
  await signIn(sellerPage, seller.email, seller.password, '/onboarding');
  await sellerPage.getByLabel('Registered legal name of the business').fill(`Island Baby Supplies ${run} Ltd`);
  await sellerPage.getByLabel('Trading name').fill(`Island Baby Supplies ${run}`);
  await sellerPage.getByLabel('Business registration number').fill(`C-${run}`);
  await sellerPage.getByLabel('Business phone').fill('+17585559876');
  await sellerPage.getByLabel('Main product category').selectOption('Baby & Child');
  await sellerPage.getByLabel('Street address').fill('4 Jeremie Street');
  await sellerPage.getByLabel('Town / city').fill('Castries');
  await sellerPage.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(sellerPage.getByText('Your seller application is under review')).toBeVisible();
  // Proof of business registration (or a national ID) is required.
  await sellerPage.goto('/dashboard/seller');
  await sellerPage.getByLabel('Document', { exact: true }).selectOption('BUSINESS_REGISTRATION');
  await sellerPage.getByLabel(/^File/).setInputFiles(path.join(__dirname, 'fixtures/registration.pdf'));
  await sellerPage.getByRole('button', { name: 'Upload' }).click();
  await expect(sellerPage.getByText('Waiting for IIE')).toBeVisible();

  // ---- IIE approves the seller and confirms payout setup
  const adminPage = await (await browser.newContext()).newPage();
  adminPage.on('dialog', (d) => void d.accept());
  await signIn(adminPage, ADMIN.email, ADMIN.password, '/admin/sellers');
  await adminPage.getByRole('button', { name: new RegExp(`Island Baby Supplies ${run} Ltd`) }).click();
  await adminPage.getByRole('button', { name: 'Accept registration.pdf' }).click();
  await expect(adminPage.getByText('Accepted', { exact: true })).toBeVisible();
  await shot(adminPage, 'p6-01-admin-seller-document');
  await adminPage.getByRole('button', { name: 'Approve', exact: true }).click();
  await adminPage.getByRole('button', { name: 'Approved', exact: true }).click();
  await adminPage.getByRole('button', { name: new RegExp(`Island Baby Supplies ${run} Ltd`) }).click();
  await adminPage.getByLabel('Note', { exact: true }).fill('Pilot: payouts by bank transfer, confirmed by phone');
  await adminPage.getByRole('button', { name: 'Confirm payout setup and activate' }).click();
  await expect(adminPage.getByRole('button', { name: 'Suspend seller' })).toBeVisible();

  // ---- IIE imports a tariff schedule for St. Vincent (a test fixture, not official rates) and activates it
  await adminPage.goto('/admin/tariffs');
  await adminPage.getByLabel('Schedule name').fill(`E2E tariff fixture ${run}`);
  await adminPage.getByLabel('Published by (source)').fill('IIE end-to-end test');
  await adminPage.getByLabel('Countries (single-rate files only)').fill('VC');
  await adminPage.getByLabel('File', { exact: true }).setInputFiles(path.join(__dirname, 'fixtures/tariff-fixture.csv'));
  await adminPage.getByRole('button', { name: 'Import as draft' }).click();
  await expect(adminPage.getByText(`E2E tariff fixture ${run}`)).toBeVisible();
  await adminPage.getByRole('button', { name: 'Activate' }).first().click();
  await expect(adminPage.getByText(/St. Vincent and the Grenadines: 2 lines \(active\)/).first()).toBeVisible();
  await shot(adminPage, 'p6-02-admin-tariffs');

  // ---- Seller lists the product
  await sellerPage.goto('/dashboard/seller/products/new');
  await sellerPage.getByLabel('Product name').fill(productTitle);
  await sellerPage.getByLabel('Short description').fill('Breathable diapers for babies 6-10 kg.');
  await sellerPage.getByLabel('Full description').fill('Hypoallergenic disposable diapers with a wetness indicator.');
  await sellerPage.getByLabel('Category').selectOption('diapers-and-wipes');
  await sellerPage.getByLabel('HS code').fill('9619.00');
  // The seller sees the official description and duties for the countries they ship to.
  await expect(sellerPage.getByText('Napkins (diapers) and napkin liners for babies')).toBeVisible();
  await sellerPage.getByLabel('Shipping weight (kg)').fill('1.8');
  await sellerPage.getByLabel('Length (cm)').fill('40');
  await sellerPage.getByLabel('Width (cm)').fill('25');
  await sellerPage.getByLabel('Height (cm)').fill('20');
  await sellerPage.getByLabel('SKU').fill(`IBS-${run}`);
  await sellerPage.getByLabel('Option name').fill('56 pack');
  await sellerPage.getByLabel(/^Price/).fill('45.00');
  await sellerPage.getByLabel('Quantity in stock').fill('24');
  await sellerPage.getByRole('button', { name: 'Save draft' }).click();
  await sellerPage.waitForURL(/\/dashboard\/seller\/products\/[0-9a-f-]{36}$/);
  await sellerPage.locator('input[type=file]').setInputFiles(path.join(__dirname, 'fixtures/diapers.jpg'));
  await expect(sellerPage.getByRole('img', { name: productTitle })).toBeVisible();
  await sellerPage.getByRole('button', { name: 'Submit for review' }).click();
  await expect(sellerPage.getByText('Submitted for review.')).toBeVisible();
  await shot(sellerPage, 'p2-01-seller-product-editor');

  // ---- IIE approves the product
  await adminPage.goto('/admin/products');
  await adminPage.getByRole('button', { name: new RegExp(productTitle) }).click();
  await expect(adminPage.getByText('HS code')).toBeVisible();
  await shot(adminPage, 'p2-02-admin-product-review');
  await adminPage.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(adminPage.getByRole('button', { name: new RegExp(productTitle) })).toHaveCount(0);

  // ---- Buyer in St. Vincent, on a phone
  const buyerPage = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await signUp(buyerPage, 'BUYER', buyer, 'VC', 'Dwayne');
  await signIn(buyerPage, buyer.email, buyer.password, '/onboarding');
  await buyerPage.getByLabel('Mobile phone').fill('+17845551234');
  await buyerPage.getByLabel('Street address').fill('Upper Bay Street');
  await buyerPage.getByLabel('Town / city').fill('Kingstown');
  await buyerPage.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(buyerPage.getByText('Your account is active')).toBeVisible();

  await buyerPage.goto(`/marketplace?q=${encodeURIComponent(`diapers ${run}`)}&destination=VC`);
  await shot(buyerPage, 'p2-03-marketplace-mobile');
  await buyerPage.getByRole('link', { name: new RegExp(productTitle) }).click();
  await expect(buyerPage.getByRole('heading', { name: productTitle })).toBeVisible();
  await expect(buyerPage.getByText('Ships from St. Lucia to St. Vincent and the Grenadines')).toBeVisible();
  await expect(buyerPage.getByRole('heading', { name: 'Import duties and taxes' })).toBeVisible();
  await expect(buyerPage.getByText('Napkins (diapers) and napkin liners for babies')).toBeVisible();
  await shot(buyerPage, 'p2-04-product-mobile');
  await buyerPage.getByLabel('Quantity').fill('2');
  await buyerPage.getByRole('button', { name: 'Add to cart' }).click();
  await expect(buyerPage.getByText('Added 2 to your cart.')).toBeVisible();
  await buyerPage.getByRole('link', { name: 'View cart' }).click();
  await expect(buyerPage.getByText('Product subtotal:')).toBeVisible();
  await expect(buyerPage.getByText('EC$90.00').first()).toBeVisible();
  await shot(buyerPage, 'p2-05-cart-mobile');

  // ---- Checkout: PRODUCT COST + SHIPPING + FEE = TOTAL, estimated duties shown separately
  await buyerPage.getByRole('link', { name: /Check out with/ }).click();
  await expect(buyerPage.getByText('Order summary')).toBeVisible();
  await expect(buyerPage.getByText('EC$90.00').first()).toBeVisible(); // 2 x 45.00
  await expect(buyerPage.getByText('EC$55.00')).toBeVisible(); // 3.6 kg placeholder band
  await expect(buyerPage.getByText('IIE platform fee (5%)')).toBeVisible();
  await expect(buyerPage.getByText('EC$4.50')).toBeVisible();
  await expect(buyerPage.getByText('EC$23.20')).toBeVisible(); // estimated VAT on arrival
  await shot(buyerPage, 'p3-01-checkout-mobile');
  await buyerPage.getByRole('button', { name: 'Place order · EC$149.50' }).click();
  await buyerPage.waitForURL(/\/orders\/IIE-SLU-SVG-\d{6}$/);
  const iieId = buyerPage.url().split('/').pop()!;
  await expect(buyerPage.getByRole('heading', { name: iieId })).toBeVisible();
  await expect(buyerPage.getByText(/Waiting for payment · items reserved/)).toBeVisible();
  await shot(buyerPage, 'p3-02-order-mobile');

  // ---- Seller sees the unpaid order: nothing to do yet
  await sellerPage.goto('/dashboard/seller/orders');
  await expect(sellerPage.getByText(iieId)).toBeVisible();
  await sellerPage.getByText(iieId).click();
  await expect(sellerPage.getByText('Waiting for the buyer to pay. Do not prepare or ship yet.')).toBeVisible();

  // ---- Buyer pays on the sandbox payment page: first the card is declined, then the retry succeeds
  await buyerPage.getByRole('button', { name: 'Pay EC$149.50' }).click();
  await expect(buyerPage.getByText('SANDBOX PAYMENT PAGE · NO REAL MONEY')).toBeVisible();
  await expect(buyerPage.getByText('EC$149.50 XCD')).toBeVisible();
  await shot(buyerPage, 'p4-01-sandbox-payment-page');
  await buyerPage.getByRole('button', { name: 'Decline the card' }).click();
  await buyerPage.waitForURL(/\?payment=decline$/);
  await expect(buyerPage.getByText(/Payment did not go through/)).toBeVisible();
  await shot(buyerPage, 'p4-02-payment-declined');
  await buyerPage.getByRole('button', { name: 'Try again' }).click();
  await buyerPage.getByRole('button', { name: 'Pay successfully' }).click();
  await buyerPage.waitForURL(/\?payment=succeed$/);
  await expect(buyerPage.getByText('Paid · waiting for the seller to confirm')).toBeVisible();
  await expect(buyerPage.getByText(/The seller has 48 hours to confirm/)).toBeVisible();
  await shot(buyerPage, 'p4-03-paid-mobile');

  // ---- Seller confirms within 48 hours
  await sellerPage.reload();
  await expect(sellerPage.getByText(/The buyer has paid/)).toBeVisible();
  await expect(sellerPage.getByText(/Confirm within 48 hours of payment: 4[78] h/)).toBeVisible();
  await shot(sellerPage, 'p4-04-seller-confirm');
  await sellerPage.getByRole('button', { name: 'Confirm order' }).click();
  await expect(sellerPage.getByText(/You confirmed this order/)).toBeVisible();
  await buyerPage.goto(`/orders/${iieId}`);
  await expect(buyerPage.getByText('The seller confirmed your order')).toBeVisible();

  // ---- IIE sees the transaction, its event log and the balanced money trail; the payout is on hold
  await adminPage.goto('/admin/transactions');
  await adminPage.getByRole('button', { name: iieId }).click();
  await expect(adminPage.getByText(/CREATED → AWAITING_PAYMENT by SYSTEM/)).toBeVisible();
  await expect(adminPage.getByText(/AWAITING_SELLER_CONFIRMATION → SELLER_CONFIRMED by SELLER/)).toBeVisible();
  await expect(adminPage.getByText('· ledger balanced')).toBeVisible();
  await expect(adminPage.getByText('EC$149.50 Dr')).toBeVisible();
  await shot(adminPage, 'p4-05-admin-money-trail');
  await adminPage.goto('/admin/payouts');
  const payoutRow = adminPage.getByRole('row', { name: new RegExp(iieId) });
  await expect(payoutRow).toContainText('on hold');
  await expect(payoutRow).toContainText('EC$90.00');

  // ---- IIE sets up the lane's logistics partner and the St. Vincent customs broker, and invites their staff
  const csrf = (await adminPage.context().cookies()).find((c) => c.name === 'iie_csrf')!.value;
  // Local runs reuse the database: retire partners left by earlier runs so this run's partners get the shipment.
  const existing = (await (await adminPage.request.get('/api/v1/admin/partners')).json()) as { items: { id: string; active: boolean }[] };
  for (const p of existing.items.filter((p) => p.active)) {
    await adminPage.request.patch(`/api/v1/admin/partners/${p.id}`, { data: { active: false }, headers: { 'x-csrf-token': csrf } });
  }
  const carrierName = `Pilot Freight ${run}`;
  const brokerName = `Kingstown Customs ${run}`;
  const carrierStaff = { email: `driver-${run}@e2e.example`, password: 'carrier-staff-password' };
  const brokerStaff = { email: `broker-${run}@e2e.example`, password: 'broker-staff-password' };
  await adminPage.goto('/admin/logistics');
  for (const [kind, name, country, phone] of [
    ['LOGISTICS', carrierName, 'LC', '+17585550100'],
    ['CUSTOMS_BROKER', brokerName, 'VC', '+17845550100'],
  ] as const) {
    await adminPage.getByLabel('Type').selectOption(kind);
    await adminPage.getByLabel('Name', { exact: true }).fill(name);
    await adminPage.getByLabel('Country (2-letter code)').fill(country);
    await adminPage.getByLabel('Contact email').fill(`ops-${run}-${country.toLowerCase()}@e2e.example`);
    await adminPage.getByLabel('Contact phone').fill(phone);
    await adminPage.getByRole('button', { name: 'Add partner' }).click();
    await expect(adminPage.getByRole('region', { name })).toBeVisible();
  }
  const carrierCard = adminPage.getByRole('region', { name: carrierName });
  await carrierCard.getByRole('button', { name: 'Add lane' }).click(); // LC -> VC is the default
  await expect(carrierCard.getByText('LC → VC')).toBeVisible();
  for (const [card, staff, first] of [
    [carrierCard, carrierStaff, 'Kerwin'],
    [adminPage.getByRole('region', { name: brokerName }), brokerStaff, 'Andrea'],
  ] as const) {
    await card.getByLabel('First name').fill(first);
    await card.getByLabel('Last name').fill('Tester');
    await card.getByLabel('Email').fill(staff.email);
    await card.getByRole('button', { name: 'Invite' }).click();
    await expect(card.getByText('Invitation sent')).toBeVisible();
  }
  await shot(adminPage, 'p5-01-admin-logistics');

  // Invited staff choose their password from the email and sign in.
  const staffPage = async (staff: { email: string; password: string }) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    await page.goto(await linkFromEmail(staff.email, 'reset-password'));
    await expect(page.getByText('Welcome to IIE: choose your password')).toBeVisible();
    await page.getByLabel('New password').fill(staff.password);
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByText('Your account is ready')).toBeVisible();
    await signIn(page, staff.email, staff.password, '/partner');
    return page;
  };
  const carrierPage = await staffPage(carrierStaff);
  const brokerPage = await staffPage(brokerStaff);

  // ---- Seller packs the order
  await sellerPage.goto(`/dashboard/seller/orders/${iieId}`);
  await sellerPage.getByLabel('Notes for the driver').fill('Side gate, open 8am to 4pm');
  await sellerPage.getByRole('button', { name: 'Ready for pickup' }).click();
  await expect(sellerPage.getByText(/Packed and waiting for the logistics partner/)).toBeVisible();

  // ---- Carrier collects and ships (on a phone)
  await carrierPage.reload();
  await carrierPage.getByRole('link', { name: new RegExp(iieId) }).click();
  await expect(carrierPage.getByText('Side gate, open 8am to 4pm').first()).toBeVisible();
  await expect(carrierPage.getByText('Upper Bay Street, Kingstown')).toBeVisible();
  await shot(carrierPage, 'p5-02-partner-shipment-mobile');
  await carrierPage.getByRole('button', { name: 'Schedule pickup' }).click();
  await carrierPage.getByLabel('Weight measured at pickup (kg)').fill('3.6');
  await carrierPage.getByRole('button', { name: 'Picked up' }).click();
  await carrierPage.getByRole('button', { name: 'Export processing' }).click();
  await carrierPage.getByRole('button', { name: 'In transit' }).click();
  await carrierPage.getByLabel('Location (optional)').fill('Kingstown port');
  await carrierPage.getByRole('button', { name: 'Arrived in destination' }).click();
  await expect(carrierPage.getByText(/you handle transport and delivery/)).toBeVisible();
  await expect(carrierPage.getByRole('button', { name: 'Customs processing started' })).toHaveCount(0);

  // ---- Customs broker clears it, with the commercial invoice
  await brokerPage.goto(`/partner/shipments/${iieId}/invoice`);
  await expect(brokerPage.getByText('Commercial invoice and packing list')).toBeVisible();
  await expect(brokerPage.getByText('CARICOM origin')).toBeVisible();
  await shot(brokerPage, 'p5-03-commercial-invoice');
  await brokerPage.goto(`/partner/shipments/${iieId}`);
  await brokerPage.getByRole('button', { name: 'Customs processing started' }).click();
  await brokerPage.getByLabel('Customs entry number (optional)').fill('SVG-C-2026-0042');
  await brokerPage.getByLabel(/Duties and taxes assessed/).fill('21.60');
  await brokerPage.getByRole('button', { name: 'Cleared customs' }).click();
  await expect(brokerPage.getByText('Cleared customs', { exact: true }).first()).toBeVisible();

  // ---- Carrier delivers with proof: name, time, photo and signature
  await carrierPage.reload();
  await carrierPage.getByRole('button', { name: 'Out for delivery' }).click();
  await carrierPage.getByLabel('Received by').fill('Dwayne Tester');
  await carrierPage.getByLabel('Photo (optional)').setInputFiles(path.join(__dirname, 'fixtures/diapers.jpg'));
  const canvas = carrierPage.getByLabel('Recipient’s signature (optional)');
  await canvas.scrollIntoViewIfNeeded();
  const pad = (await canvas.boundingBox())!;
  await carrierPage.mouse.move(pad.x + 20, pad.y + pad.height / 2);
  await carrierPage.mouse.down();
  for (let i = 1; i <= 10; i++) await carrierPage.mouse.move(pad.x + 20 + i * 25, pad.y + pad.height / 2 + (i % 2 ? -20 : 20));
  await carrierPage.mouse.up();
  await shot(carrierPage, 'p5-04-proof-of-delivery-mobile');
  await carrierPage.getByRole('button', { name: 'Delivered', exact: true }).click();
  await expect(carrierPage.getByText(/Received by Dwayne Tester on/)).toBeVisible();

  // ---- Buyer sees the journey, customs' assessment and the proof, and confirms receipt
  await buyerPage.goto(`/orders/${iieId}`);
  await expect(buyerPage.getByText('Delivered: did everything arrive as expected?')).toBeVisible();
  await expect(buyerPage.getByText('EC$21.60')).toBeVisible();
  await expect(buyerPage.getByRole('img', { name: 'Delivery photo' })).toBeVisible();
  await expect(buyerPage.getByRole('img', { name: 'Recipient’s signature' })).toBeVisible();
  await shot(buyerPage, 'p5-05-delivered-mobile');
  await buyerPage.getByRole('button', { name: 'Yes, I received my order' }).click();
  await expect(buyerPage.getByText('Delivery confirmed', { exact: true }).first()).toBeVisible();
  await sellerPage.reload();
  await expect(sellerPage.getByText(/You are paid when the 7-day review period ends/)).toBeVisible();

  // ---- Within the 7-day review the buyer reports a missing pack; the seller answers; IIE refunds one pack
  await buyerPage.getByRole('button', { name: 'Report a problem' }).click();
  await buyerPage.getByLabel(/What went wrong/).fill('Only one of the two packs was in the box.');
  await buyerPage.getByRole('button', { name: 'Send report' }).click();
  await expect(buyerPage.getByText('Problem reported', { exact: true }).first()).toBeVisible();
  await buyerPage.getByLabel(/Message to IIE/).fill('The box was taped shut when it arrived.');
  await buyerPage.getByRole('button', { name: 'Send' }).click();
  await expect(buyerPage.getByText('The box was taped shut when it arrived.')).toBeVisible();
  await sellerPage.reload();
  await expect(sellerPage.getByText('Problem reported by the buyer').first()).toBeVisible();
  // Buyers and sellers write to IIE only: neither sees the other's messages.
  await sellerPage.getByLabel(/Message to IIE/).fill('We packed two; one may have been lost in transit. We accept a refund for one pack.');
  await sellerPage.getByRole('button', { name: 'Send' }).click();
  await expect(sellerPage.getByText(/We accept a refund for one pack/)).toBeVisible();
  await expect(sellerPage.getByText('The box was taped shut when it arrived.')).toHaveCount(0);
  await adminPage.goto('/admin/disputes');
  await adminPage.getByRole('button', { name: new RegExp(iieId) }).click();
  await expect(adminPage.getByText(/We accept a refund for one pack/)).toBeVisible();
  await expect(adminPage.getByText('Needs reply').first()).toBeVisible();
  await adminPage.getByLabel('Message', { exact: true }).fill('The seller confirms one pack may have been lost. We are refunding it.');
  await adminPage.getByRole('button', { name: 'Send' }).click();
  await expect(adminPage.getByText(/to buyer and seller/)).toBeVisible();
  await buyerPage.reload();
  await expect(buyerPage.getByText('The seller confirms one pack may have been lost. We are refunding it.')).toBeVisible();
  await expect(buyerPage.getByText(/We accept a refund for one pack/)).toHaveCount(0);
  await adminPage.getByLabel('Partial refund to the buyer').check();
  await adminPage.getByLabel('Refund amount').fill('45.00');
  await adminPage.getByLabel('Explanation for the buyer and the seller').fill('One of two packs did not arrive; refunding its price.');
  await shot(adminPage, 'p6-03-admin-dispute-decision');
  await adminPage.getByRole('button', { name: 'Record decision' }).click();
  await expect(adminPage.getByText('IIE decision: Partial refund to the buyer · EC$45.00')).toBeVisible();
  await buyerPage.reload();
  await expect(buyerPage.getByText('Partly refunded: EC$45.00')).toBeVisible();
  await expect(buyerPage.getByText('The buyer keeps the goods.', { exact: true })).toBeVisible();
  await shot(buyerPage, 'p6-04-buyer-partial-refund-mobile');
  await sellerPage.goto('/dashboard/seller/payouts');
  const payout = sellerPage.getByRole('row', { name: new RegExp(iieId) });
  await expect(payout).toContainText('Paid');
  await expect(payout).toContainText('EC$45.00');
  await shot(sellerPage, 'p6-05-seller-payouts');

  // ---- Phase 7: the provider owes IIE its share, net 30 after the payout; IIE records the remittance
  await adminPage.goto('/admin/settlements');
  await adminPage.getByRole('button', { name: 'Owed to IIE' }).click();
  const remittance = adminPage.getByRole('row', { name: new RegExp(iieId) });
  await expect(remittance).toContainText('Payment provider pays IIE');
  await shot(adminPage, 'p7-01-admin-settlements');
  await remittance.getByRole('button', { name: 'Record receipt' }).click();
  await adminPage.getByLabel('Bank or provider reference').fill(`SBX-REMIT-${run}`);
  await adminPage.getByRole('button', { name: 'Record', exact: true }).click();
  await adminPage.getByRole('button', { name: 'Settled' }).click();
  await expect(adminPage.getByRole('row', { name: new RegExp(iieId) })).toContainText(`SBX-REMIT-${run}`);

  // ---- The buyer rates the order; IIE approves the review before it appears on the product page
  await buyerPage.goto(`/orders/${iieId}`);
  await buyerPage.getByLabel('4 stars').check({ force: true });
  await buyerPage.getByLabel('Title (optional)').fill('Good diapers, one pack short');
  await buyerPage.getByLabel('Your review (optional)').fill('IIE sorted out the missing pack quickly.');
  await buyerPage.getByRole('button', { name: 'Submit review' }).click();
  await expect(buyerPage.getByText('Waiting for IIE to check it before it is published.')).toBeVisible();
  await adminPage.goto('/admin/reviews');
  const pending = adminPage.getByRole('listitem').filter({ hasText: iieId });
  await expect(pending).toContainText('Good diapers, one pack short');
  await shot(adminPage, 'p7-02-admin-review-moderation');
  await pending.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(pending).toHaveCount(0);
  await buyerPage.goto(`/marketplace?q=${encodeURIComponent(productTitle)}`);
  await buyerPage.getByRole('link', { name: productTitle }).first().click();
  await buyerPage.waitForURL(/\/products\//);
  // Product pages and their data are each cached for 30 seconds, so a new review can take about a minute to appear.
  await expect(async () => {
    await buyerPage.reload();
    await expect(buyerPage.getByText('IIE sorted out the missing pack quickly.')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
  await expect(buyerPage.getByRole('img', { name: '4 out of 5 stars' }).first()).toBeVisible();
  await shot(buyerPage, 'p7-03-product-reviews');

  // ---- Messages go through IIE: the buyer writes, customer support answers
  await buyerPage.goto(`/orders/${iieId}`);
  await buyerPage.getByRole('link', { name: 'Message IIE about this order' }).click();
  await buyerPage.getByLabel('Message').fill('Can the seller send the next order to Bequia?');
  await buyerPage.getByRole('button', { name: 'Send to IIE' }).click();
  await expect(buyerPage.getByText('Can the seller send the next order to Bequia?')).toBeVisible();
  await adminPage.goto('/admin/support');
  await adminPage.getByRole('button', { name: new RegExp(`About order ${iieId}`) }).click();
  await adminPage.getByLabel('Reply to the user').fill('Yes: our partner delivers to Bequia. Choose your Bequia address at checkout.');
  await adminPage.getByRole('button', { name: 'Send' }).click();
  await buyerPage.reload();
  await expect(buyerPage.getByText(/our partner delivers to Bequia/)).toBeVisible();
  await shot(buyerPage, 'p7-04-buyer-messages-mobile');

  // ---- Help Center: IIE staff publish an article; the public can find it
  const slug = `pilot-help-${run}`;
  await adminPage.goto('/admin/help');
  await expect(adminPage.getByText('What is Inter-Island Exchange?')).toBeVisible();
  await adminPage.getByRole('button', { name: 'New article' }).click();
  await adminPage.getByLabel('Title').fill(`Pilot deliveries to St. Vincent ${run}`);
  await adminPage.getByLabel('Web address (/help/…)').fill(slug);
  await adminPage.getByLabel('For', { exact: true }).selectOption('BUYER');
  await adminPage.getByLabel('Article').fill('## Where we deliver\n\nThe pilot delivers across **St. Vincent**. See [duties](/tariffs).\n\n- Kingstown\n- Bequia');
  await adminPage.getByRole('button', { name: 'Create draft' }).click();
  await adminPage.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(adminPage.getByRole('button', { name: 'Unpublish' })).toBeVisible();
  await buyerPage.goto(`/help?q=${encodeURIComponent('Bequia pilot')}`);
  await buyerPage.getByRole('link', { name: new RegExp(`Pilot deliveries to St. Vincent ${run}`) }).click();
  await expect(buyerPage.getByRole('heading', { name: 'Where we deliver' })).toBeVisible();
  await expect(buyerPage.getByRole('link', { name: 'duties', exact: true })).toHaveAttribute('href', '/tariffs');
  await shot(buyerPage, 'p7-05-help-article-mobile');

  // ---- The directors' weekly report, sent on demand
  const director = `director-${run}@e2e.example`;
  await adminPage.goto('/admin/reports');
  await adminPage.getByLabel('Name').fill('Pilot Director');
  await adminPage.getByLabel('Email').fill(director);
  await adminPage.getByRole('button', { name: 'Add recipient' }).click();
  await expect(adminPage.getByText(`Pilot Director · ${director}`)).toBeVisible();
  await adminPage.getByLabel('Week containing').fill(new Date().toISOString().slice(0, 10));
  await expect(adminPage.getByText('SLU → SVG').first()).toBeVisible();
  await shot(adminPage, 'p7-06-admin-weekly-report');
  await adminPage.getByRole('button', { name: 'Send this report now' }).click();
  await expect(adminPage.getByText(/^Sent to \d+ recipients?\.$/)).toBeVisible();
  await expect.poll(() => (existsSync(EMAIL_DIR) ? readdirSync(EMAIL_DIR).filter((f) => f.includes(director)).length : 0), { timeout: 15_000 }).toBeGreaterThan(0);
});
