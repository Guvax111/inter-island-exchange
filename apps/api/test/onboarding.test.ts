import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { accountDeletionRequests, sellerProfiles, users } from '../src/db/schema';
import { buyerOnboarding, createTestApp, lastEmailTo, register, sellerOnboarding, signedIn, TestContext, tokenFromEmail } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

const statusOf = async (id: string) => (await ctx.db.select().from(users).where(eq(users.id, id)))[0]!.status;

describe('buyer onboarding', () => {
  it('is not active until onboarding is submitted AND the email is verified', async () => {
    const { id, email } = await register(ctx, { verify: false });
    const client = await signedIn(ctx, email);
    expect((await client.get('/me')).body.nextAction).toBe('VERIFY_EMAIL');

    expect((await client.post('/me/onboarding', { buyer: buyerOnboarding() })).status).toBe(204);
    expect(await statusOf(id)).toBe('PENDING_VERIFICATION');

    const token = tokenFromEmail(lastEmailTo(ctx, email).text);
    await request(ctx.app.getHttpServer()).post('/api/v1/auth/verify-email').send({ token }).expect(200);
    expect(await statusOf(id)).toBe('ACTIVE');

    const me = (await client.get('/me')).body;
    expect(me.nextAction).toBe('NONE');
    expect(me.buyerProfile).toEqual({ partyType: 'INDIVIDUAL', verificationLevel: 'BASIC' });
    expect(me.user.phone).toBe('+17585551234');
    expect(me.user.country.currency.code).toBe('XCD');
  });

  it('requires a business name for business buyers', async () => {
    const { email } = await register(ctx);
    const client = await signedIn(ctx, email);
    const res = await client.post('/me/onboarding', { buyer: { ...buyerOnboarding(), partyType: 'BUSINESS' } });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('buyer.businessName');
  });

  it('only accepts addresses in the registered country', async () => {
    const { email } = await register(ctx, { countryCode: 'VC' });
    const client = await signedIn(ctx, email);
    const res = await client.post('/me/onboarding', { buyer: buyerOnboarding('LC') });
    expect(res.body.error.code).toBe('ADDRESS_COUNTRY_MISMATCH');
  });

  it('can only be submitted once', async () => {
    const { email } = await register(ctx);
    const client = await signedIn(ctx, email);
    await client.post('/me/onboarding', { buyer: buyerOnboarding() }).expect(204);
    const again = await client.post('/me/onboarding', { buyer: buyerOnboarding() });
    expect(again.body.error.code).toBe('ONBOARDING_ALREADY_SUBMITTED');
  });
});

describe('seller onboarding', () => {
  it('activates the account but holds the seller profile for review', async () => {
    const { id, email } = await register(ctx, { accountType: 'SELLER' });
    const client = await signedIn(ctx, email);
    expect((await client.get('/me')).body.nextAction).toBe('COMPLETE_ONBOARDING');
    await client.post('/me/onboarding', { seller: sellerOnboarding() }).expect(204);

    expect(await statusOf(id)).toBe('ACTIVE');
    const [seller] = await ctx.db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, id));
    expect(seller!.status).toBe('UNDER_REVIEW');
    expect((await client.get('/me')).body.nextAction).toBe('SELLER_UNDER_REVIEW');
  });

  it('moves the seller profile to review only after email verification', async () => {
    const { id, email } = await register(ctx, { accountType: 'SELLER', verify: false });
    const client = await signedIn(ctx, email);
    await client.post('/me/onboarding', { seller: sellerOnboarding() }).expect(204);
    const [pending] = await ctx.db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, id));
    expect(pending!.status).toBe('PENDING_VERIFICATION');
    const token = tokenFromEmail(lastEmailTo(ctx, email).text);
    await request(ctx.app.getHttpServer()).post('/api/v1/auth/verify-email').send({ token }).expect(200);
    const [reviewed] = await ctx.db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, id));
    expect(reviewed!.status).toBe('UNDER_REVIEW');
  });

  it('requires a registration number for business sellers', async () => {
    const { email } = await register(ctx, { accountType: 'SELLER' });
    const client = await signedIn(ctx, email);
    const res = await client.post('/me/onboarding', { seller: { ...sellerOnboarding(), registrationNumber: '' } });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain('seller.registrationNumber');
  });

  it('requires both profiles for buyer + seller accounts, and rejects details for roles not held', async () => {
    const both = await signedIn(ctx, (await register(ctx, { accountType: 'BUYER_SELLER' })).email);
    expect((await both.post('/me/onboarding', { buyer: buyerOnboarding() })).body.error.code).toBe('ONBOARDING_MISMATCH');
    await both.post('/me/onboarding', { buyer: buyerOnboarding(), seller: sellerOnboarding() }).expect(204);

    const buyerOnly = await signedIn(ctx, (await register(ctx)).email);
    expect((await buyerOnly.post('/me/onboarding', { seller: sellerOnboarding() })).body.error.code).toBe('ONBOARDING_MISMATCH');
  });
});

describe('account deletion request', () => {
  it('requires the password and records a single open request', async () => {
    const { id, email } = await register(ctx);
    const client = await signedIn(ctx, email);
    expect((await client.post('/me/deletion-request', { password: 'wrong-password' })).body.error.code).toBe('INVALID_CURRENT_PASSWORD');
    expect((await client.post('/me/deletion-request', { password: 'correct-horse-battery-staple', reason: 'Moving' })).status).toBe(202);
    expect((await client.post('/me/deletion-request', { password: 'correct-horse-battery-staple' })).status).toBe(202);
    const requests = await ctx.db.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.userId, id));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.status).toBe('REQUESTED');
  });
});
