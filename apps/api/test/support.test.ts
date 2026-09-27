import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { supportMessages } from '../src/db/schema';
import { Client, createActiveBuyer, createSuperAdmin, createTestApp, grantRole, lastEmailTo, register, signedIn, TestContext } from './helpers';

let ctx: TestContext;
let admin: Client;

beforeAll(async () => {
  ctx = await createTestApp();
  admin = (await createSuperAdmin(ctx)).client;
});
afterAll(() => ctx.close());

describe('messaging IIE', () => {
  it('a buyer writes to IIE, support replies, and nobody else can read it', async () => {
    const buyer = await createActiveBuyer(ctx, 'VC');
    expect((await buyer.client.post('/me/messages', { subject: 'About my order', body: 'Where is it?', iieId: 'IIE-SLU-SVG-999999' })).body.error.code).toBe('ORDER_NOT_FOUND');
    const started = await buyer.client.post('/me/messages', { subject: 'Delivery to Bequia', body: 'Do you deliver to Bequia?' });
    expect(started.status).toBe(201);
    const id = started.body.id;
    expect(started.body).toMatchObject({ status: 'OPEN', waitingFor: 'IIE', messages: [{ role: 'USER', body: 'Do you deliver to Bequia?' }] });

    // Customer support for all countries, a St. Lucia-only admin without support rights, and another buyer.
    const agent = await register(ctx, { countryCode: 'VC' });
    await grantRole(ctx, agent.id, 'customer_support');
    const support = await signedIn(ctx, agent.email);
    const inbox = (await support.get('/admin/support?waiting=true')).body.items;
    expect(inbox.find((t: { id: string }) => t.id === id)).toMatchObject({ subject: 'Delivery to Bequia', waitingFor: 'IIE', user: { email: buyer.email } });
    const lcAdmin = await register(ctx, { countryCode: 'LC' });
    await grantRole(ctx, lcAdmin.id, 'country_admin', 'LC');
    expect((await (await signedIn(ctx, lcAdmin.email)).get('/admin/support')).status).toBe(403);
    const other = await createActiveBuyer(ctx, 'VC');
    expect((await other.client.get(`/me/messages/${id}`)).status).toBe(404);
    expect((await other.client.get('/admin/support')).status).toBe(403);

    const replied = await support.post(`/admin/support/${id}/messages`, { body: 'Yes: our partner delivers to Bequia on Tuesdays.' });
    expect(replied.status).toBe(200);
    expect(replied.body.messages.at(-1)).toMatchObject({ role: 'IIE', author: 'Test' });
    await ctx.flush();
    expect(lastEmailTo(ctx, buyer.email).subject).toBe('IIE replied: Delivery to Bequia');
    const mine = (await buyer.client.get(`/me/messages/${id}`)).body;
    // The staff member's name is not shown to users.
    expect(mine.messages.map((m: { author: string }) => m.author)).toEqual([expect.not.stringMatching(/^IIE$/), 'IIE']);
    expect((await buyer.client.get('/me/messages')).body.items[0]).toMatchObject({ id, waitingFor: 'USER' });
    expect((await buyer.client.get('/me/notifications')).body.items[0]).toMatchObject({ title: 'IIE replied to your message', link: `/messages/${id}` });

    await support.post(`/admin/support/${id}/close`).expect(200);
    const again = await buyer.client.post(`/me/messages/${id}/messages`, { body: 'One more question' });
    expect(again.body).toMatchObject({ status: 'OPEN', waitingFor: 'IIE' });

    const err = await ctx.db.execute(sql`delete from ${supportMessages}`).then(() => 'ok', (e: Error) => String((e.cause as Error)?.message ?? e.message));
    expect(err).toMatch(/append-only/);
    expect((await admin.get(`/admin/support/${id}`)).body.messages).toHaveLength(3);
  });
});
