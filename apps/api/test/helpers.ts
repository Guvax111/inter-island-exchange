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
import { OutboxService } from '../src/outbox/outbox.service';

export const PASSWORD = 'correct-horse-battery-staple';
export const WEB = 'http://localhost:3000';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://iie:iie@127.0.0.1:5432/iie_test';

export interface TestContext {
  app: INestApplication;
  config: AppConfig;
  email: SandboxEmailProvider;
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config, { emailProvider: email })] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, config);
  await app.init();
  const { db, pool } = createDatabase(TEST_DATABASE_URL);
  const outbox = app.get(OutboxService);
  return {
    app,
    config,
    email,
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
