import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { deliveryProofs, shipmentEvents, shipments, transactions, userRoles } from '../src/db/schema';
import { ShipmentsService } from '../src/logistics/shipments.service';
import {
  Client,
  createActiveBuyer,
  createActiveSeller,
  createPublishedProduct,
  createSuperAdmin,
  createTestApp,
  lastEmailTo,
  PASSWORD,
  signedIn,
  TestContext,
  testImage,
  tokenFromEmail,
  uniqueEmail,
} from './helpers';

let ctx: TestContext;
let admin: Client;
let seller: Awaited<ReturnType<typeof createActiveSeller>>;
/** St. Lucia carrier serving SLU -> SVG that does NOT clear customs, and a St. Vincent customs broker. */
let carrier: { id: string; staff: Client; email: string };
let broker: { id: string; staff: Client; email: string };
const http = () => request(ctx.app.getHttpServer());
const DAY = 24 * 3600_000;

async function createPartner(body: Record<string, unknown>) {
  const res = await admin.post('/admin/partners', { contactPhone: '+17585550100', ...body });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/** Invites a new person to a partner, has them choose a password from the email, and signs them in. */
async function inviteStaff(partnerId: string) {
  const email = uniqueEmail('partner');
  const res = await admin.post(`/admin/partners/${partnerId}/members`, { email, firstName: 'Kerwin', lastName: 'James' });
  expect(res.status).toBe(201);
  expect(res.body.newAccount).toBe(true);
  await ctx.flush();
  const invite = lastEmailTo(ctx, email);
  expect(invite.subject).toMatch(/You have been added to/);
  expect(invite.text).toMatch(/reset-password\?token=.*&invite=1/);
  await http().post('/api/v1/auth/password/reset').send({ token: tokenFromEmail(invite.text), password: PASSWORD }).expect(200);
  return { email, staff: await signedIn(ctx, email) };
}

beforeAll(async () => {
  ctx = await createTestApp();
  admin = (await createSuperAdmin(ctx)).client;
  seller = await createActiveSeller(ctx, admin, { name: 'Logistics Store' });
  const carrierId = await createPartner({ kind: 'LOGISTICS', name: 'Test Island Freight', countryCode: 'LC', contactEmail: 'ops@freight.example', clearsCustoms: false });
  await admin.post(`/admin/partners/${carrierId}/lanes`, { origin: 'LC', destination: 'VC' }).expect(204);
  carrier = { id: carrierId, ...(await inviteStaff(carrierId)) };
  const brokerId = await createPartner({ kind: 'CUSTOMS_BROKER', name: 'Kingstown Customs Services', countryCode: 'VC', contactEmail: 'desk@broker.example', contactPhone: '+17845550100' });
  broker = { id: brokerId, ...(await inviteStaff(brokerId)) };
});
afterAll(() => ctx.close());

/** A St. Vincent buyer orders 2 x EC$45 diapers (2 x 1.8 kg), pays on the sandbox page, and the seller confirms. */
async function confirmedOrder() {
  const product = await createPublishedProduct(ctx, seller, admin, { variants: [{ sku: `LOG-${randomUUID().slice(0, 6)}`, name: '56 pack', price: '45.00', quantity: 10 }] });
  const buyer = await createActiveBuyer(ctx, 'VC');
  await buyer.client.post('/me/cart/items', { variantId: product.variants[0].id, quantity: 2 }).expect(201);
  const addressId = (await buyer.client.get('/me/addresses')).body.items[0].id;
  const q = (await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId })).body;
  const { iieId } = (await buyer.client.post('/me/checkout', { quoteId: q.quoteId })).body;
  const url = new URL((await buyer.client.post(`/me/orders/${iieId}/pay`)).body.redirectUrl);
  await buyer.client.agent.post(url.pathname).set('origin', url.origin).type('form').send({ outcome: 'SUCCEED', token: url.searchParams.get('token') }).expect(303);
  await seller.client.post(`/me/sales/${iieId}/confirm`).expect(204);
  return { buyer, iieId: iieId as string };
}

const step = (who: Client, iieId: string, body: Record<string, unknown>) => who.post(`/partner/shipments/${iieId}/steps`, body);
const status = async (iieId: string) => (await ctx.db.select().from(transactions).where(eq(transactions.iieId, iieId)))[0]!;

/** Walks a shipment from ready-for-pickup to out-for-delivery with the carrier and the broker. */
async function toOutForDelivery(iieId: string) {
  await seller.client.post(`/me/sales/${iieId}/ready`, {}).expect(201);
  await step(carrier.staff, iieId, { step: 'SCHEDULE_PICKUP', pickupAt: new Date(Date.now() + 3600_000).toISOString() }).expect(200);
  await step(carrier.staff, iieId, { step: 'PICKED_UP', actualWeightGrams: 3700, trackingReference: 'TIF-1001' }).expect(200);
  await step(carrier.staff, iieId, { step: 'EXPORT_PROCESSING', location: 'Port Castries' }).expect(200);
  await step(carrier.staff, iieId, { step: 'IN_TRANSIT' }).expect(200);
  await step(carrier.staff, iieId, { step: 'ARRIVED_DESTINATION', location: 'Kingstown port' }).expect(200);
  await step(broker.staff, iieId, { step: 'CUSTOMS_PROCESSING' }).expect(200);
  await step(broker.staff, iieId, { step: 'CUSTOMS_CLEARED', customsEntryNumber: 'SVG-C-2026-0042', dutiesAssessed: '21.60' }).expect(200);
  await step(carrier.staff, iieId, { step: 'OUT_FOR_DELIVERY', location: 'Kingstown' }).expect(200);
}

describe('pilot shipment: St. Lucia -> St. Vincent', () => {
  it('goes from the seller to the buyer with a carrier and a customs broker, and the buyer confirms', async () => {
    const { buyer, iieId } = await confirmedOrder();

    // Seller packs the order: shipment created, partner and broker assigned, both told.
    const ready = await seller.client.post(`/me/sales/${iieId}/ready`, { pickupNotes: 'Ring the bell at the side gate' });
    expect(ready.status).toBe(201);
    expect(ready.body.assigned).toBe(true);
    expect(await status(iieId)).toMatchObject({ status: 'PREPARING_SHIPMENT' });
    await ctx.flush();
    expect(lastEmailTo(ctx, 'ops@freight.example').subject).toBe(`New shipment ${iieId} ready for pickup`);
    expect(lastEmailTo(ctx, 'desk@broker.example').subject).toBe(`Shipment ${iieId} will need customs clearance`);

    // Carrier sees it with everything needed to collect and deliver.
    const list = (await carrier.staff.get('/partner/shipments')).body;
    expect(list.items.find((i: { iieId: string }) => i.iieId === iieId)).toMatchObject({ actionNeeded: true, pickupCity: expect.any(String), deliveryCity: expect.any(String) });
    const d = (await carrier.staff.get(`/partner/shipments/${iieId}`)).body;
    expect(d).toMatchObject({ yourRoles: ['LOGISTICS'], nextSteps: ['SCHEDULE_PICKUP'] });
    expect(d.pickup.notes).toBe('Ring the bell at the side gate');
    expect(d.delivery.contact.phone).toBe('+17585551234');
    expect(d.shipment.weights).toMatchObject({ declaredGrams: 3600, parcelGrams: 3600 });

    // Commercial invoice for customs, from the order as placed.
    const ci = (await broker.staff.get(`/partner/shipments/${iieId}/commercial-invoice`)).body;
    expect(ci).toMatchObject({ documentNumber: `CI-${iieId}`, currency: 'XCD', route: { origin: 'St. Lucia', destination: 'St. Vincent and the Grenadines' } });
    expect(ci.lines[0]).toMatchObject({ hsCode: '961900', countryOfOrigin: 'LC', caricomOrigin: true, quantity: 2, totalValue: { formatted: 'EC$90.00' }, netWeightGrams: 3600 });
    expect(ci.totals).toMatchObject({ goodsValue: { formatted: 'EC$90.00' }, freight: { formatted: 'EC$55.00' } });

    // The broker cannot move the parcel; the carrier cannot clear customs.
    expect((await step(broker.staff, iieId, { step: 'SCHEDULE_PICKUP', pickupAt: new Date().toISOString() })).status).toBe(403);
    await step(carrier.staff, iieId, { step: 'SCHEDULE_PICKUP', pickupAt: new Date(Date.now() + 3600_000).toISOString() }).expect(200);
    await step(carrier.staff, iieId, { step: 'PICKED_UP', actualWeightGrams: 3700, trackingReference: 'TIF-1001' }).expect(200);
    await step(carrier.staff, iieId, { step: 'EXPORT_PROCESSING', location: 'Port Castries' }).expect(200);
    await step(carrier.staff, iieId, { step: 'IN_TRANSIT' }).expect(200);
    await step(carrier.staff, iieId, { step: 'ARRIVED_DESTINATION', location: 'Kingstown port' }).expect(200);
    await ctx.flush();
    expect(lastEmailTo(ctx, 'desk@broker.example').subject).toBe(`Shipment ${iieId} has arrived: customs clearance needed`);
    expect((await step(carrier.staff, iieId, { step: 'CUSTOMS_PROCESSING' })).status).toBe(403);
    await step(broker.staff, iieId, { step: 'CUSTOMS_PROCESSING' }).expect(200);
    await step(broker.staff, iieId, { step: 'CUSTOMS_CLEARED', customsEntryNumber: 'SVG-C-2026-0042', dutiesAssessed: '21.60' }).expect(200);
    await step(carrier.staff, iieId, { step: 'OUT_FOR_DELIVERY', location: 'Kingstown' }).expect(200);

    // Proof of delivery with a photo and a signature.
    const deliveredAt = new Date().toISOString();
    const pod = await carrier.staff.agent
      .post(`/api/v1/partner/shipments/${iieId}/delivery`)
      .set('x-csrf-token', carrier.staff.csrf)
      .field('recipientName', 'Dwayne Tester')
      .field('deliveredAt', deliveredAt)
      .attach('photo', await testImage('jpeg'), 'door.jpg')
      .attach('signature', await testImage('png', 600, 200), 'signature.png');
    expect(pod.status, JSON.stringify(pod.body)).toBe(200);
    const t = await status(iieId);
    expect(t.status).toBe('DELIVERED');
    expect(t.deliveryConfirmDueAt!.getTime() - Date.now()).toBeGreaterThan(2.99 * DAY);

    // The buyer sees the journey, customs' assessment and the proof, and confirms.
    const order = (await buyer.client.get(`/me/orders/${iieId}`)).body;
    expect(order).toMatchObject({ status: 'DELIVERED', canConfirmDelivery: true });
    expect(order.shipment.events.map((e: { step: string }) => e.step)).toEqual([
      'READY_FOR_PICKUP', 'SCHEDULE_PICKUP', 'PICKED_UP', 'EXPORT_PROCESSING', 'IN_TRANSIT', 'ARRIVED_DESTINATION', 'CUSTOMS_PROCESSING', 'CUSTOMS_CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED',
    ]);
    expect(order.shipment).toMatchObject({
      logisticsPartner: { name: 'Test Island Freight' },
      customsBroker: { name: 'Kingstown Customs Services' },
      trackingReference: 'TIF-1001',
      customs: { entryNumber: 'SVG-C-2026-0042', dutiesAssessed: { formatted: 'EC$21.60' }, payableOnArrival: true },
      proofOfDelivery: { recipientName: 'Dwayne Tester', photoUrl: expect.stringMatching(/^\/api\/v1\/media\//), signatureUrl: expect.stringMatching(/^\/api\/v1\/media\//) },
    });
    expect(order.shipment.weights).toBeUndefined();
    await ctx.flush();
    expect(lastEmailTo(ctx, buyer.email).subject).toBe(`${iieId} was delivered`);

    // Proof images: the buyer and the carrier can open them; the seller, another buyer and the public cannot.
    const photo = order.shipment.proofOfDelivery.photoUrl.replace('/api/v1', '');
    expect((await buyer.client.get(photo)).status).toBe(200);
    expect((await carrier.staff.get(photo)).status).toBe(200);
    expect((await seller.client.get(photo)).status).toBe(404);
    expect((await (await createActiveBuyer(ctx, 'VC')).client.get(photo)).status).toBe(404);
    expect((await http().get(`/api/v1${photo}`)).status).toBe(404);
    const sale = (await seller.client.get(`/me/sales/${iieId}`)).body;
    expect(sale.shipment.proofOfDelivery).toMatchObject({ recipientName: 'Dwayne Tester', photoUrl: null, signatureUrl: null });

    await buyer.client.post(`/me/orders/${iieId}/confirm-delivery`).expect(204);
    expect(await status(iieId)).toMatchObject({ status: 'DELIVERY_CONFIRMED', deliveryConfirmDueAt: null });
    await ctx.flush();
    expect(lastEmailTo(ctx, seller.email).subject).toBe(`Delivery of ${iieId} confirmed`);
  });

  it('flags a parcel heavier than declared, and customs can hold and release it', async () => {
    const { iieId } = await confirmedOrder();
    await seller.client.post(`/me/sales/${iieId}/ready`, { parcelWeightGrams: 3650 }).expect(201);
    await step(carrier.staff, iieId, { step: 'SCHEDULE_PICKUP', pickupAt: new Date().toISOString() }).expect(200);
    // 4.2 kg against 3.6 kg declared: more than 10% over.
    await step(carrier.staff, iieId, { step: 'PICKED_UP', actualWeightGrams: 4200 }).expect(200);
    const attention = (await admin.get('/admin/shipments')).body.items.find((i: { iieId: string }) => i.iieId === iieId);
    expect(attention.issues).toContain('WEIGHT_OVER_DECLARED');

    for (const s of ['EXPORT_PROCESSING', 'IN_TRANSIT', 'ARRIVED_DESTINATION']) await step(carrier.staff, iieId, { step: s }).expect(200);
    await step(broker.staff, iieId, { step: 'CUSTOMS_PROCESSING' }).expect(200);
    expect((await step(broker.staff, iieId, { step: 'CUSTOMS_HOLD' })).body.error.code).toBe('VALIDATION_FAILED');
    await step(broker.staff, iieId, { step: 'CUSTOMS_HOLD', reason: 'Invoice value query' }).expect(200);
    expect(await status(iieId)).toMatchObject({ status: 'CUSTOMS_HOLD', customsStatus: 'HOLD', heldFromStatus: 'CUSTOMS_PROCESSING' });
    expect((await admin.get('/admin/shipments')).body.items.find((i: { iieId: string }) => i.iieId === iieId).issues).toContain('CUSTOMS_HOLD');
    await step(broker.staff, iieId, { step: 'CUSTOMS_RELEASED', note: 'Query answered' }).expect(200);
    expect(await status(iieId)).toMatchObject({ status: 'CUSTOMS_PROCESSING', heldFromStatus: null });
    await step(broker.staff, iieId, { step: 'CUSTOMS_CLEARED' }).expect(200);
  });

  it('confirms delivery automatically after 3 days, or stops when the buyer reports a problem', async () => {
    const a = await confirmedOrder();
    const b = await confirmedOrder();
    for (const o of [a, b]) {
      await toOutForDelivery(o.iieId);
      await carrier.staff.agent
        .post(`/api/v1/partner/shipments/${o.iieId}/delivery`)
        .set('x-csrf-token', carrier.staff.csrf)
        .field('recipientName', 'Neighbour at no. 12')
        .field('deliveredAt', new Date().toISOString())
        .expect(200);
    }
    // Name and time are enough; no photo or signature needed.
    const [proof] = await ctx.db.select().from(deliveryProofs).innerJoin(shipments, eq(shipments.id, deliveryProofs.shipmentId)).innerJoin(transactions, eq(transactions.id, shipments.transactionId)).where(eq(transactions.iieId, a.iieId));
    expect(proof!.delivery_proofs).toMatchObject({ recipientName: 'Neighbour at no. 12', photoMediaId: null, signatureMediaId: null });

    expect((await b.buyer.client.post(`/me/orders/${b.iieId}/report-problem`, { reason: 'Short' })).status).toBe(400);
    await b.buyer.client.post(`/me/orders/${b.iieId}/report-problem`, { reason: 'One pack was missing from the box' }).expect(204);
    expect(await status(b.iieId)).toMatchObject({ status: 'DISPUTED', disputeStatus: 'OPEN', deliveryConfirmDueAt: null });

    const shipmentsSvc = ctx.app.get(ShipmentsService);
    expect(await shipmentsSvc.autoConfirmDeliveries(new Date(Date.now() + 2 * DAY))).toBe(0);
    expect(await shipmentsSvc.autoConfirmDeliveries(new Date(Date.now() + 3 * DAY + 60_000))).toBeGreaterThanOrEqual(1);
    expect((await status(a.iieId)).status).toBe('DELIVERY_CONFIRMED');
    expect((await status(b.iieId)).status).toBe('DISPUTED');
    const order = (await a.buyer.client.get(`/me/orders/${a.iieId}`)).body;
    expect(order.timeline.at(-1)).toMatchObject({ status: 'DELIVERY_CONFIRMED', reason: 'Confirmed automatically 3 days after delivery' });
    expect((await admin.get('/admin/shipments')).body.items.find((i: { iieId: string }) => i.iieId === b.iieId).issues).toContain('PROBLEM_REPORTED');
  });

  it('checks delivery times and only lets the right people act', async () => {
    const { buyer, iieId } = await confirmedOrder();
    // Only confirmed orders, only by their seller, only once.
    expect((await buyer.client.post(`/me/orders/${iieId}/confirm-delivery`)).status).toBe(409);
    await seller.client.post(`/me/sales/${iieId}/ready`, {}).expect(201);
    expect((await seller.client.post(`/me/sales/${iieId}/ready`, {})).status).toBe(409);

    // Staff of an unrelated carrier see nothing.
    const other = await createPartner({ kind: 'LOGISTICS', name: 'Other Carrier', countryCode: 'LC', contactEmail: 'other@carrier.example' });
    const outsider = await inviteStaff(other);
    expect((await outsider.staff.get('/partner/shipments')).body.items.find((i: { iieId: string }) => i.iieId === iieId)).toBeUndefined();
    expect((await outsider.staff.get(`/partner/shipments/${iieId}`)).status).toBe(404);
    expect((await step(outsider.staff, iieId, { step: 'SCHEDULE_PICKUP', pickupAt: new Date().toISOString() })).status).toBe(404);
    // Buyers are not partners.
    expect((await buyer.client.get('/partner/shipments')).status).toBe(403);

    // Steps must follow the order.
    expect((await step(carrier.staff, iieId, { step: 'IN_TRANSIT' })).body.error.code).toBe('INVALID_TRANSITION');
    await step(carrier.staff, iieId, { step: 'SCHEDULE_PICKUP', pickupAt: new Date().toISOString() }).expect(200);
    await step(carrier.staff, iieId, { step: 'PICKED_UP', actualWeightGrams: 3600 }).expect(200);
    for (const s of ['EXPORT_PROCESSING', 'IN_TRANSIT', 'ARRIVED_DESTINATION']) await step(carrier.staff, iieId, { step: s }).expect(200);
    await step(broker.staff, iieId, { step: 'CUSTOMS_PROCESSING' }).expect(200);
    await step(broker.staff, iieId, { step: 'CUSTOMS_CLEARED' }).expect(200);
    await step(carrier.staff, iieId, { step: 'OUT_FOR_DELIVERY' }).expect(200);
    const deliver = (when: Date) =>
      carrier.staff.agent.post(`/api/v1/partner/shipments/${iieId}/delivery`).set('x-csrf-token', carrier.staff.csrf).field('recipientName', 'Dwayne').field('deliveredAt', when.toISOString());
    expect((await deliver(new Date(Date.now() + DAY))).body.error.code).toBe('DELIVERY_IN_FUTURE');
    expect((await deliver(new Date(Date.now() - 30 * DAY))).body.error.code).toBe('DELIVERY_BEFORE_PICKUP');
    expect((await broker.staff.agent.post(`/api/v1/partner/shipments/${iieId}/delivery`).set('x-csrf-token', broker.staff.csrf).field('recipientName', 'X Y').field('deliveredAt', new Date().toISOString())).status).toBe(403);
    await deliver(new Date()).expect(200);
    expect((await deliver(new Date())).status).toBe(409);
  });
});

describe('partner assignment', () => {
  it('waits for IIE when no partner serves the lane, and a carrier that clears customs needs no broker', async () => {
    // Take the lane's carrier out of service: new shipments are unassigned.
    await admin.patch(`/admin/partners/${carrier.id}`, { active: false }).expect(204);
    const { iieId } = await confirmedOrder();
    const ready = await seller.client.post(`/me/sales/${iieId}/ready`, {});
    await admin.patch(`/admin/partners/${carrier.id}`, { active: true }).expect(204);
    expect(ready.body.assigned).toBe(false);
    const item = (await admin.get('/admin/shipments')).body.items.find((i: { iieId: string }) => i.iieId === iieId);
    expect(item.issues).toContain('NO_LOGISTICS_PARTNER');
    expect(item.customsBroker).toBe('Kingstown Customs Services');

    // IIE assigns a carrier that clears customs itself and removes the broker.
    const allInOne = await createPartner({ kind: 'LOGISTICS', name: 'All-in-One Shipping', countryCode: 'LC', contactEmail: 'aio@shipping.example', clearsCustoms: true });
    const aio = await inviteStaff(allInOne);
    expect((await admin.patch(`/admin/shipments/${iieId}`, { customsBrokerId: allInOne })).body.error.code).toBe('INVALID_PARTNER');
    await admin.patch(`/admin/shipments/${iieId}`, { logisticsPartnerId: allInOne, customsBrokerId: null }).expect(204);
    await ctx.flush();
    expect(lastEmailTo(ctx, 'aio@shipping.example').subject).toBe(`Shipment ${iieId} assigned to you`);
    expect((await aio.staff.get(`/partner/shipments/${iieId}`)).body.yourRoles).toEqual(['LOGISTICS', 'CUSTOMS']);
    // The broker is no longer involved.
    expect((await broker.staff.get(`/partner/shipments/${iieId}`)).status).toBe(404);

    await step(aio.staff, iieId, { step: 'SCHEDULE_PICKUP', pickupAt: new Date().toISOString() }).expect(200);
    await step(aio.staff, iieId, { step: 'PICKED_UP', actualWeightGrams: 3600 }).expect(200);
    for (const s of ['EXPORT_PROCESSING', 'IN_TRANSIT', 'ARRIVED_DESTINATION', 'CUSTOMS_PROCESSING', 'CUSTOMS_CLEARED', 'OUT_FOR_DELIVERY']) await step(aio.staff, iieId, { step: s }).expect(200);
    const events = await ctx.db.select().from(shipmentEvents).innerJoin(shipments, eq(shipments.id, shipmentEvents.shipmentId)).innerJoin(transactions, eq(transactions.id, shipments.transactionId)).where(eq(transactions.iieId, iieId));
    expect(events.map((e) => e.shipment_events.step)).toContain('ASSIGNED');
    expect(events.find((e) => e.shipment_events.step === 'CUSTOMS_CLEARED')!.shipment_events.actorType).toBe('CUSTOMS');
  });
});

describe('partner administration', () => {
  it('adds existing accounts, removes staff and their role, and keeps partner records audited', async () => {
    const existing = await createActiveBuyer(ctx, 'LC');
    const res = await admin.post(`/admin/partners/${carrier.id}/members`, { email: existing.email, firstName: 'X', lastName: 'Y' });
    expect(res.body).toMatchObject({ newAccount: false });
    await ctx.flush();
    expect(lastEmailTo(ctx, existing.email).subject).toMatch(/You have been added to Test Island Freight/);
    expect((await admin.post(`/admin/partners/${carrier.id}/members`, { email: existing.email, firstName: 'X', lastName: 'Y' })).body.error.code).toBe('ALREADY_A_MEMBER');
    expect((await existing.client.get('/partner/shipments')).status).toBe(200);

    await admin.delete(`/admin/partners/${carrier.id}/members/${existing.id}`).expect(204);
    const roles = await ctx.db.execute(sql`select r.key from ${userRoles} ur join roles r on r.id = ur.role_id where ur.user_id = ${existing.id}`);
    expect(roles.rows.map((r) => r.key)).not.toContain('logistics_partner');
    expect((await existing.client.get('/partner/shipments')).status).toBe(403);

    expect((await admin.post(`/admin/partners/${broker.id}/lanes`, { origin: 'LC', destination: 'VC' })).body.error.code).toBe('NOT_A_CARRIER');
    const list = (await admin.get('/admin/partners')).body.items;
    expect(list.find((p: { id: string }) => p.id === carrier.id)).toMatchObject({ lanes: [{ origin: 'LC', destination: 'VC', active: true }], members: expect.arrayContaining([expect.objectContaining({ invitationAccepted: true })]) });
    // Sellers and buyers cannot manage partners.
    expect((await seller.client.get('/admin/partners')).status).toBe(403);
  });

  it('the tracking history and proofs of delivery cannot be edited', async () => {
    const err = await ctx.db.execute(sql`update ${shipmentEvents} set note = 'x'`).then(() => 'ok', (e: Error) => String((e.cause as Error)?.message ?? e.message));
    expect(err).toMatch(/append-only/);
    const err2 = await ctx.db.execute(sql`delete from ${deliveryProofs}`).then(() => 'ok', (e: Error) => String((e.cause as Error)?.message ?? e.message));
    expect(err2).toMatch(/append-only/);
  });
});
