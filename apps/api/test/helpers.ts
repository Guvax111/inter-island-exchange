import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { AppConfig, loadConfig } from '../src/config/config';
import { createDatabase, Database } from '../src/db/db';
import { roles, userRoles, users, countries } from '../src/db/schema';
import { SandboxEmailProvider } from '../src/email/email.provider';
import type { StorageProvider } from '../src/media/storage.provider';
import sharp from 'sharp';
import { OutboxService } from '../src/outbox/outbox.service';

export const PASSWORD = 'correct-horse-battery-staple';
export const WEB = 'http://localhost:3000';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://iie:iie@127.0.0.1:5432/iie_test';

/** In-memory file storage for tests. */
export class MemoryStorage implements StorageProvider {
  readonly key = 'memory';
  readonly files = new Map<string, Buffer>();
  async put(k: string, body: Buffer) {
    this.files.set(k, body);
  }
  async get(k: string) {
    return this.files.get(k) ?? null;
  }
  async delete(k: string) {
    this.files.delete(k);
  }
}

export interface TestContext {
  app: INestApplication;
  config: AppConfig;
  email: SandboxEmailProvider;
  storage: MemoryStorage;
  db: Database;
  close: () => Promise<void>;
  /** Delivers queued outbox events (emails). */
  flush: () => Promise<void>;
}

export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestContext> {
  const config = loadConfig({
    APP_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    WEB_BASE_URL: WEB,
    COOKIE_SECURE: 'false',
    MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    EMAIL_FROM: 'IIE Test <test@example.com>',
    AUTH_RATE_LIMIT_PER_MIN: '10000',
    RATE_LIMIT_PER_MIN: '10000',
    ...overrides,
  });
  const email = new SandboxEmailProvider(false);
  const storage = new MemoryStorage();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config, { emailProvider: email, storageProvider: storage })] }).compile();
  const app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  configureApp(app, config);
  await app.init();
  const { db, pool } = createDatabase(TEST_DATABASE_URL);
  const outbox = app.get(OutboxService);
  return {
    app,
    config,
    email,
    storage,
    db,
    flush: async () => {
      while ((await outbox.processBatch()) > 0);
    },
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export const uniqueEmail = (prefix = 'user') => `${prefix}-${randomUUID().slice(0, 8)}@example.com`;

/** A cookie-keeping client that adds the CSRF header to state-changing requests once signed in. */
export class Client {
  readonly agent: TestAgent;
  csrf = '';

  constructor(app: INestApplication) {
    this.agent = request.agent(app.getHttpServer());
  }

  get(path: string) {
    return this.agent.get(`/api/v1${path}`);
  }
  post(path: string, body?: object) {
    return this.agent.post(`/api/v1${path}`).set('x-csrf-token', this.csrf).send(body ?? {});
  }
  patch(path: string, body?: object) {
    return this.agent.patch(`/api/v1${path}`).set('x-csrf-token', this.csrf).send(body ?? {});
  }
  put(path: string, body?: object) {
    return this.agent.put(`/api/v1${path}`).set('x-csrf-token', this.csrf).send(body ?? {});
  }
  delete(path: string) {
    return this.agent.delete(`/api/v1${path}`).set('x-csrf-token', this.csrf);
  }
  upload(path: string, file: Buffer, filename = 'photo.jpg', fields: Record<string, string> = {}) {
    let req = this.agent.post(`/api/v1${path}`).set('x-csrf-token', this.csrf).attach('file', file, filename);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req;
  }

  async login(email: string, password = PASSWORD, totpCode?: string) {
    const res = await this.agent.post('/api/v1/auth/login').send({ email, password, totpCode });
    if (res.status === 200) this.csrf = res.body.csrfToken;
    return res;
  }
}

export function lastEmailTo(ctx: TestContext, to: string) {
  const msg = [...ctx.email.sent].reverse().find((m) => m.to === to);
  if (!msg) throw new Error(`No email sent to ${to}`);
  return msg;
}

export function tokenFromEmail(text: string): string {
  const match = /token=([\w-]+)/.exec(text);
  if (!match) throw new Error('No token link in email');
  return decodeURIComponent(match[1]!);
}

export interface RegisterOptions {
  email?: string;
  countryCode?: string;
  accountType?: 'BUYER' | 'SELLER' | 'BUYER_SELLER';
  verify?: boolean;
}

export async function register(ctx: TestContext, opts: RegisterOptions = {}) {
  const email = opts.email ?? uniqueEmail();
  const res = await request(ctx.app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, firstName: 'Test', lastName: 'User', countryCode: opts.countryCode ?? 'LC', accountType: opts.accountType ?? 'BUYER' });
  if (res.status !== 202) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  await ctx.flush();
  if (opts.verify ?? true) {
    const token = tokenFromEmail(lastEmailTo(ctx, email).text);
    const v = await request(ctx.app.getHttpServer()).post('/api/v1/auth/verify-email').send({ token });
    if (v.status !== 200) throw new Error(`verify failed: ${v.status}`);
  }
  const [user] = await ctx.db.select().from(users).where(eq(users.email, email));
  return { email, id: user!.id };
}

export async function signedIn(ctx: TestContext, email: string) {
  const client = new Client(ctx.app);
  const res = await client.login(email);
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return client;
}

/** Grants a role directly in the database (bootstrapping test administrators). */
export async function grantRole(ctx: TestContext, userId: string, role: string, countryCode?: string) {
  const [r] = await ctx.db.select().from(roles).where(eq(roles.key, role));
  const countryId = countryCode
    ? (await ctx.db.select().from(countries).where(eq(countries.isoAlpha2, countryCode)))[0]!.id
    : null;
  await ctx.db.insert(userRoles).values({ userId, roleId: r!.id, countryId });
}

export async function createSuperAdmin(ctx: TestContext) {
  const admin = await register(ctx, { email: uniqueEmail('admin') });
  await grantRole(ctx, admin.id, 'super_admin');
  return { ...admin, client: await signedIn(ctx, admin.email) };
}

export const buyerOnboarding = (countryCode = 'LC') => ({
  firstName: 'Marie',
  lastName: 'Joseph',
  phone: '+17585551234',
  partyType: 'INDIVIDUAL',
  address: { line1: '12 Bridge Street', city: 'Castries', countryCode },
});

export const sellerOnboarding = (countryCode = 'LC') => ({
  partyType: 'BUSINESS',
  legalName: 'Island Baby Supplies Ltd',
  businessName: 'Island Baby Supplies',
  registrationNumber: `C-${randomUUID().slice(0, 6)}`,
  taxId: 'TIN-12345',
  phone: '+17585559876',
  website: 'https://islandbaby.example.com',
  category: 'Baby & Child',
  address: { line1: '4 Jeremie Street', city: 'Castries', countryCode },
});

// ------------------------------------------------------------------ Phase 2 fixtures

/** A small real image. */
export function testImage(format: 'jpeg' | 'png' = 'jpeg', width = 800, height = 600) {
  return sharp({ create: { width, height, channels: 3, background: { r: 14, g: 116, b: 144 } } })[format]().toBuffer();
}

/** A tiny valid-looking PDF, as a seller's certificate of registration. */
export const testPdf = () => Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

export function uploadSellerDocument(client: Client, type = 'BUSINESS_REGISTRATION', file: Buffer = testPdf(), name = 'certificate-of-registration.pdf') {
  return client.agent.post('/api/v1/me/seller/documents').set('x-csrf-token', client.csrf).field('type', type).attach('file', file, name);
}

export async function createActiveSeller(ctx: TestContext, admin: Client, opts: { countryCode?: string; name?: string } = {}) {
  const countryCode = opts.countryCode ?? 'LC';
  const { id: userId, email } = await register(ctx, { accountType: 'SELLER', countryCode, email: uniqueEmail('seller') });
  const client = await signedIn(ctx, email);
  const onboarding = { ...sellerOnboarding(countryCode), ...(opts.name ? { businessName: opts.name, legalName: `${opts.name} Ltd` } : {}) };
  const ob = await client.post('/me/onboarding', { seller: onboarding });
  if (ob.status !== 204) throw new Error(`seller onboarding failed ${ob.status} ${JSON.stringify(ob.body)}`);
  const sellerId = (await client.get('/me')).body.sellerProfile.id as string;
  // Sellers must give proof of business registration (or a national ID), accepted by IIE, before approval.
  const doc = await uploadSellerDocument(client);
  if (doc.status !== 201) throw new Error(`document upload failed ${doc.status} ${JSON.stringify(doc.body)}`);
  await admin.post(`/admin/seller-documents/${doc.body.id}/review`, { decision: 'ACCEPT' }).expect(204);
  const approve = await admin.post(`/admin/sellers/${sellerId}/review`, { decision: 'APPROVE' });
  if (approve.status !== 204) throw new Error(`approve failed ${approve.status} ${JSON.stringify(approve.body)}`);
  await admin.post(`/admin/sellers/${sellerId}/payout-setup`, { note: 'Pilot: bank transfer arranged offline' }).expect(204);
  const me = (await client.get('/me/seller')).body;
  return { userId, email, client, sellerId, slug: me.storefront.slug as string };
}

export async function createActiveBuyer(ctx: TestContext, countryCode = 'VC') {
  const { id, email } = await register(ctx, { countryCode, email: uniqueEmail('buyer') });
  const client = await signedIn(ctx, email);
  await client.post('/me/onboarding', { buyer: buyerOnboarding(countryCode) }).expect(204);
  return { id, email, client };
}

let skuCounter = 0;
export const diaperProduct = (overrides: Record<string, unknown> = {}) => ({
  title: 'Soft Care Baby Diapers Size 3 (56 pack)',
  shortDescription: 'Breathable, leak-proof diapers for babies 6-10 kg.',
  description: 'Hypoallergenic disposable diapers with a wetness indicator. Made for the Caribbean climate.',
  categorySlug: 'diapers-and-wipes',
  brand: 'Soft Care',
  hsCode: '9619.00',
  countryOfOrigin: 'LC',
  weightGrams: 1800,
  lengthMm: 400,
  widthMm: 250,
  heightMm: 200,
  variants: [{ sku: `SC-D3-${++skuCounter}-${randomUUID().slice(0, 4)}`, name: '56 pack', price: '45.00', quantity: 20 }],
  ...overrides,
});

/** Creates, illustrates, submits and approves a product. Returns the seller-side product detail. */
export async function createPublishedProduct(ctx: TestContext, seller: { client: Client }, admin: Client, overrides: Record<string, unknown> = {}) {
  const created = await seller.client.post('/me/products', diaperProduct(overrides));
  if (created.status !== 201) throw new Error(`create failed ${created.status} ${JSON.stringify(created.body)}`);
  const id = created.body.id as string;
  await seller.client.upload(`/me/products/${id}/images`, await testImage()).expect(201);
  await seller.client.post(`/me/products/${id}/submit`).expect(200);
  await admin.post(`/admin/products/${id}/review`, { decision: 'APPROVE' }).expect(204);
  return (await seller.client.get(`/me/products/${id}`)).body;
}
