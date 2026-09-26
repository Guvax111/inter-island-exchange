import { expect, test, type Page } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ADMIN, EMAIL_DIR } from '../playwright.config';

/**
 * The St. Lucia -> St. Vincent pilot, as far as Phase 2 goes:
 * seller signs up and is approved, lists diapers, IIE approves them, a buyer in St. Vincent finds them and fills a cart.
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
  const match = new RegExp(`(http://localhost:\\d+/${kind}\\?token=[\\w%-]+)`).exec(text);
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

test('pilot: St. Lucia seller lists diapers, St. Vincent buyer adds them to the cart', async ({ browser }) => {
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

  // ---- IIE approves the seller and confirms payout setup
  const adminPage = await (await browser.newContext()).newPage();
  await signIn(adminPage, ADMIN.email, ADMIN.password, '/admin/sellers');
  await adminPage.getByRole('button', { name: new RegExp(`Island Baby Supplies ${run} Ltd`) }).click();
  await adminPage.getByRole('button', { name: 'Approve', exact: true }).click();
  await adminPage.getByRole('button', { name: 'Approved', exact: true }).click();
  await adminPage.getByRole('button', { name: new RegExp(`Island Baby Supplies ${run} Ltd`) }).click();
  await adminPage.getByLabel('Note').fill('Pilot: payouts by bank transfer, confirmed by phone');
  await adminPage.getByRole('button', { name: 'Confirm payout setup and activate' }).click();
  await expect(adminPage.getByRole('button', { name: 'Suspend seller' })).toBeVisible();

  // ---- Seller lists the product
  await sellerPage.goto('/dashboard/seller/products/new');
  await sellerPage.getByLabel('Product name').fill(productTitle);
  await sellerPage.getByLabel('Short description').fill('Breathable diapers for babies 6-10 kg.');
  await sellerPage.getByLabel('Full description').fill('Hypoallergenic disposable diapers with a wetness indicator.');
  await sellerPage.getByLabel('Category').selectOption('diapers-and-wipes');
  await sellerPage.getByLabel('HS code').fill('9619.00');
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
  await shot(buyerPage, 'p2-04-product-mobile');
  await buyerPage.getByLabel('Quantity').fill('2');
  await buyerPage.getByRole('button', { name: 'Add to cart' }).click();
  await expect(buyerPage.getByText('Added 2 to your cart.')).toBeVisible();
  await buyerPage.getByRole('link', { name: 'View cart' }).click();
  await expect(buyerPage.getByText('Product subtotal:')).toBeVisible();
  await expect(buyerPage.getByText('EC$90.00').first()).toBeVisible();
  await expect(buyerPage.getByRole('button', { name: 'Checkout — coming soon' })).toBeDisabled();
  await shot(buyerPage, 'p2-05-cart-mobile');
});
