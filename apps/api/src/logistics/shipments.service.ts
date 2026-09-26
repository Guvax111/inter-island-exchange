import { Inject, Injectable, Logger } from '@nestjs/common';
import { aliasedTable, and, asc, desc, eq, inArray, lte, or } from 'drizzle-orm';
import { DELIVERY_CONFIRMATION_DAYS, parseDecimalToMinor, REVIEW_PERIOD_DAYS, WEIGHT_TOLERANCE_PERCENT, type ShipmentStep, type TransactionStatus } from '@iie/shared';
import { Database, DB, Tx } from '../db/db';
import {
  addresses,
  countries,
  currencies,
  deliveryProofs,
  lanes,
  orderItems,
  orders,
  partnerLanes,
  partnerMembers,
  sellerProfiles,
  servicePartners,
  shipmentEvents,
  shipments,
  transactions,
  users,
} from '../db/schema';
import { AppError, Errors } from '../common/errors';
import { toMoneyDto } from '../common/money';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';
import { EVENTS } from '../email/notification.dispatcher';
import { MediaService } from '../media/media.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OutboxService } from '../outbox/outbox.service';
import type { Principal } from '../rbac/principal';
import { STATUS_LABELS } from '../transactions/state-machine';
import { TransactionEngine, type Actor } from '../transactions/transaction-engine';

type TransactionRow = typeof transactions.$inferSelect;
type ShipmentRow = typeof shipments.$inferSelect;
type PartnerRow = typeof servicePartners.$inferSelect;
type Upload = { buffer: Buffer; size: number } | undefined;

/** Who performs a step: the carrier, or whoever clears customs (a broker, or a carrier that clears customs itself). */
type Party = 'LOGISTICS' | 'CUSTOMS';

const STEPS: Record<ShipmentStep, { party: Party; to: TransactionStatus | 'RELEASE_HOLD' }> = {
  SCHEDULE_PICKUP: { party: 'LOGISTICS', to: 'PICKUP_SCHEDULED' },
  PICKED_UP: { party: 'LOGISTICS', to: 'PICKED_UP' },
  EXPORT_PROCESSING: { party: 'LOGISTICS', to: 'EXPORT_PROCESSING' },
  IN_TRANSIT: { party: 'LOGISTICS', to: 'IN_TRANSIT' },
  ARRIVED_DESTINATION: { party: 'LOGISTICS', to: 'ARRIVED_DESTINATION' },
  CUSTOMS_PROCESSING: { party: 'CUSTOMS', to: 'CUSTOMS_PROCESSING' },
  CUSTOMS_CLEARED: { party: 'CUSTOMS', to: 'CUSTOMS_CLEARED' },
  CUSTOMS_HOLD: { party: 'CUSTOMS', to: 'CUSTOMS_HOLD' },
  CUSTOMS_RELEASED: { party: 'CUSTOMS', to: 'RELEASE_HOLD' },
  OUT_FOR_DELIVERY: { party: 'LOGISTICS', to: 'OUT_FOR_DELIVERY' },
};

/** The next step for each transaction state, shown in the partner portal. */
const NEXT_STEPS: Partial<Record<TransactionStatus, ShipmentStep[]>> = {
  PREPARING_SHIPMENT: ['SCHEDULE_PICKUP'],
  PICKUP_SCHEDULED: ['PICKED_UP'],
  PICKED_UP: ['EXPORT_PROCESSING'],
  EXPORT_PROCESSING: ['IN_TRANSIT'],
  IN_TRANSIT: ['ARRIVED_DESTINATION'],
  ARRIVED_DESTINATION: ['CUSTOMS_PROCESSING'],
  CUSTOMS_PROCESSING: ['CUSTOMS_CLEARED', 'CUSTOMS_HOLD'],
  CUSTOMS_HOLD: ['CUSTOMS_RELEASED'],
  CUSTOMS_CLEARED: ['OUT_FOR_DELIVERY'],
};

export const STEP_LABELS: Record<string, string> = {
  READY_FOR_PICKUP: 'Packed and ready for pickup',
  ASSIGNED: 'Assigned to a partner',
  SCHEDULE_PICKUP: 'Pickup scheduled',
  PICKED_UP: 'Picked up from the seller',
  EXPORT_PROCESSING: 'Export processing',
  IN_TRANSIT: 'In transit',
  ARRIVED_DESTINATION: 'Arrived in the destination country',
  CUSTOMS_PROCESSING: 'Customs processing',
  CUSTOMS_CLEARED: 'Cleared customs',
  CUSTOMS_HOLD: 'Held by customs',
  CUSTOMS_RELEASED: 'Released by customs',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  DELIVERY_CONFIRMED: 'Delivery confirmed',
  PROBLEM_REPORTED: 'Problem reported by the buyer',
};

/** States in which the shipment is still moving (used for the partner's "to do" list). */
const OPEN_STATES: TransactionStatus[] = ['PREPARING_SHIPMENT', 'PICKUP_SCHEDULED', 'PICKED_UP', 'EXPORT_PROCESSING', 'IN_TRANSIT', 'ARRIVED_DESTINATION', 'CUSTOMS_PROCESSING', 'CUSTOMS_HOLD', 'CUSTOMS_CLEARED', 'OUT_FOR_DELIVERY'];

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger('Shipments');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly engine: TransactionEngine,
    private readonly audit: AuditService,
    private readonly media: MediaService,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
  ) {}

  // ------------------------------------------------------------------ seller

  /** The seller has packed a confirmed order. Creates the shipment and assigns the lane's partner and customs broker. */
  async readyForPickup(principal: Principal, iieId: string, input: { parcelWeightGrams?: number; pickupNotes?: string }, meta: RequestMeta) {
    const [seller] = await this.db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, principal.userId));
    const t = await this.loadTransaction(iieId);
    if (!seller || t.sellerProfileId !== seller.id) throw Errors.notFound('Order');
    if (t.status !== 'SELLER_CONFIRMED') throw Errors.conflict('INVALID_TRANSITION', 'Only confirmed orders can be marked ready for pickup');

    const items = await this.db.select().from(orderItems).where(eq(orderItems.orderId, t.orderId));
    const declared = Math.max(1, items.reduce((n, i) => n + i.unitWeightGrams * i.quantity, 0));
    const [pickup] = await this.db
      .select({ a: addresses, country: countries.name })
      .from(addresses)
      .innerJoin(countries, eq(countries.id, addresses.countryId))
      .where(eq(addresses.id, seller.addressId));
    const [order] = await this.db.select().from(orders).where(eq(orders.id, t.orderId));
    const [buyer] = await this.db.select().from(users).where(eq(users.id, t.buyerUserId));
    const { logistics, broker } = await this.assignParties(t);

    return this.db.transaction(async (tx) => {
      const [shipment] = await tx
        .insert(shipments)
        .values({
          transactionId: t.id,
          logisticsPartnerId: logistics?.id ?? null,
          customsBrokerId: broker?.id ?? null,
          pickupAddress: { line1: pickup!.a.line1, line2: pickup!.a.line2, city: pickup!.a.city, region: pickup!.a.region, postalCode: pickup!.a.postalCode, country: pickup!.country },
          pickupContact: { name: seller.legalName, phone: seller.phone },
          deliveryAddress: order!.deliveryAddress as Record<string, string | null>,
          deliveryContact: { name: `${buyer!.firstName} ${buyer!.lastName}`, phone: buyer!.phone },
          declaredWeightGrams: declared,
          parcelWeightGrams: input.parcelWeightGrams ?? declared,
          pickupNotes: input.pickupNotes ?? '',
          currencyCode: t.transactionCurrency,
        })
        .onConflictDoNothing()
        .returning();
      if (!shipment) throw Errors.conflict('ALREADY_READY', 'This order is already marked ready for pickup');
      await tx.insert(shipmentEvents).values({ shipmentId: shipment.id, step: 'READY_FOR_PICKUP', actorType: 'SELLER', actorUserId: principal.userId, note: input.pickupNotes || null });
      await this.engine.transition(tx, t.id, 'PREPARING_SHIPMENT', { type: 'SELLER', userId: principal.userId }, {
        reason: 'Packed and ready for pickup',
        metadata: { shipmentId: shipment.id, logisticsPartnerId: shipment.logisticsPartnerId, customsBrokerId: shipment.customsBrokerId },
      });
      await this.audit.record(tx, meta, { action: 'shipment.ready_for_pickup', entityType: 'shipment', entityId: shipment.id, after: { iieId: t.iieId, parcelWeightGrams: shipment.parcelWeightGrams } });
      if (logistics) await this.tellPartner(tx, logistics, t, `New shipment ${t.iieId} ready for pickup`, `A parcel is packed and waiting for pickup in ${pickup!.a.city}. Schedule the pickup in the partner portal.`);
      if (broker) await this.tellPartner(tx, broker, t, `Shipment ${t.iieId} will need customs clearance`, `A parcel for ${(order!.deliveryAddress as Record<string, string>).city} is on its way. The commercial invoice is in the partner portal.`);
      return { shipmentId: shipment.id, assigned: !!logistics };
    });
  }

  // ------------------------------------------------------------------ partner portal

  async listForPartner(principal: Principal) {
    const mine = await this.memberships(principal);
    if (!mine.length) return { partners: [], items: [] };
    const ids = mine.map((p) => p.id);
    const origin = aliasedTable(countries, 'origin');
    const destination = aliasedTable(countries, 'destination');
    const rows = await this.db
      .select({ s: shipments, t: transactions, origin: origin.name, destination: destination.name })
      .from(shipments)
      .innerJoin(transactions, eq(transactions.id, shipments.transactionId))
      .innerJoin(origin, eq(origin.id, transactions.originCountryId))
      .innerJoin(destination, eq(destination.id, transactions.destinationCountryId))
      .where(or(inArray(shipments.logisticsPartnerId, ids), inArray(shipments.customsBrokerId, ids)))
      .orderBy(desc(shipments.createdAt))
      .limit(200);
    return {
      partners: mine.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
      items: rows.map((r) => {
        const parties = this.partiesFor(r.s, mine);
        return {
          iieId: r.t.iieId,
          status: r.t.status,
          statusLabel: STATUS_LABELS[r.t.status as TransactionStatus],
          route: `${r.origin} → ${r.destination}`,
          pickupCity: r.s.pickupAddress.city,
          deliveryCity: r.s.deliveryAddress.city,
          open: OPEN_STATES.includes(r.t.status as TransactionStatus),
          actionNeeded: this.nextSteps(r.t.status as TransactionStatus, r.s, parties).length > 0 || (r.t.status === 'OUT_FOR_DELIVERY' && parties.includes('LOGISTICS')),
          createdAt: r.s.createdAt,
        };
      }),
    };
  }

  async detailForPartner(principal: Principal, iieId: string) {
    const { t, s, parties } = await this.loadForPartner(principal, iieId);
    const view = await this.shipmentView(t, 'PARTNER');
    const items = await this.db.select().from(orderItems).where(eq(orderItems.orderId, t.orderId)).orderBy(asc(orderItems.id));
    return {
      iieId: t.iieId,
      status: t.status,
      statusLabel: STATUS_LABELS[t.status as TransactionStatus],
      yourRoles: parties,
      nextSteps: this.nextSteps(t.status as TransactionStatus, s, parties),
      canDeliver: t.status === 'OUT_FOR_DELIVERY' && parties.includes('LOGISTICS'),
      pickup: { address: s.pickupAddress, contact: s.pickupContact, notes: s.pickupNotes },
      delivery: { address: s.deliveryAddress, contact: s.deliveryContact },
      items: items.map((i) => ({ sku: i.sku, title: i.title, variantName: i.variantName, quantity: i.quantity, unitWeightGrams: i.unitWeightGrams })),
      ...view,
    };
  }

  /** Commercial invoice and packing list for export and import customs, built from the order as placed. */
  async commercialInvoice(principal: Principal, iieId: string) {
    const { t, s } = await this.loadForPartner(principal, iieId);
    const [currency] = await this.db.select().from(currencies).where(eq(currencies.code, t.transactionCurrency));
    const [seller] = await this.db.select().from(sellerProfiles).where(eq(sellerProfiles.id, t.sellerProfileId));
    const items = await this.db.select().from(orderItems).where(eq(orderItems.orderId, t.orderId)).orderBy(asc(orderItems.id));
    const [origin] = await this.db.select().from(countries).where(eq(countries.id, t.originCountryId));
    const [destination] = await this.db.select().from(countries).where(eq(countries.id, t.destinationCountryId));
    const originCountries = await this.db.select({ code: countries.isoAlpha2, name: countries.name, bloc: countries.regionalBloc }).from(countries);
    const bloc = new Map(originCountries.map((c) => [c.code, c]));
    const m = (v: bigint) => toMoneyDto(v, currency!);
    return {
      documentNumber: `CI-${t.iieId}`,
      iieId: t.iieId,
      date: s.createdAt,
      currency: t.transactionCurrency,
      exporter: { name: seller!.legalName, phone: seller!.phone, address: s.pickupAddress },
      consignee: { name: s.deliveryContact.name, phone: s.deliveryContact.phone, address: s.deliveryAddress },
      route: { origin: origin!.name, destination: destination!.name },
      lines: items.map((i) => ({
        description: `${i.title} (${i.variantName})`,
        sku: i.sku,
        hsCode: i.hsCode,
        tariffDescription: i.tariffDescription,
        countryOfOrigin: i.countryOfOrigin,
        countryOfOriginName: bloc.get(i.countryOfOrigin)?.name ?? i.countryOfOrigin,
        caricomOrigin: bloc.get(i.countryOfOrigin)?.bloc === 'CARICOM',
        quantity: i.quantity,
        unitValue: m(i.unitPriceMinor),
        totalValue: m(i.lineTotalMinor),
        netWeightGrams: i.unitWeightGrams * i.quantity,
      })),
      totals: {
        goodsValue: m(t.subtotalMinor),
        freight: m(t.shippingMinor),
        declaredWeightGrams: s.declaredWeightGrams,
        parcelWeightGrams: s.actualWeightGrams ?? s.parcelWeightGrams,
      },
      declaration: 'The exporter declares that the information on this invoice is true and correct and that the goods are of the origin shown.',
    };
  }

  /** One tracking step by the carrier or the customs party. */
  async step(principal: Principal, iieId: string, input: {
    step: ShipmentStep;
    note?: string;
    location?: string;
    pickupAt?: string;
    actualWeightGrams?: number;
    trackingReference?: string;
    customsEntryNumber?: string;
    dutiesAssessed?: string;
    reason?: string;
  }, meta: RequestMeta) {
    const { t, s, parties, partnerFor } = await this.loadForPartner(principal, iieId);
    const rule = STEPS[input.step];
    if (!parties.includes(rule.party) || !principal.can(rule.party === 'CUSTOMS' ? 'customs.document.manage' : 'shipment.update.assigned')) {
      throw Errors.forbidden(rule.party === 'CUSTOMS' ? 'Customs steps are recorded by the party clearing customs for this shipment' : 'Only the logistics partner can record this step');
    }
    const to = rule.to === 'RELEASE_HOLD' ? (t.heldFromStatus as TransactionStatus | null) : rule.to;
    if (!to || (rule.to === 'RELEASE_HOLD' && t.status !== 'CUSTOMS_HOLD')) throw Errors.conflict('INVALID_TRANSITION', 'This shipment is not held by customs');
    const actor: Actor = { type: rule.party === 'CUSTOMS' ? 'CUSTOMS' : 'LOGISTICS', userId: principal.userId };
    const [currency] = await this.db.select().from(currencies).where(eq(currencies.code, t.transactionCurrency));

    const set: Partial<typeof shipments.$inferInsert> = { updatedAt: new Date() };
    if (input.trackingReference) set.trackingReference = input.trackingReference;
    if (input.step === 'SCHEDULE_PICKUP') set.pickupScheduledFor = new Date(input.pickupAt!);
    if (input.step === 'PICKED_UP') {
      set.pickedUpAt = new Date();
      set.actualWeightGrams = input.actualWeightGrams!;
      set.weightFlagged = input.actualWeightGrams! > Math.ceil(s.declaredWeightGrams * (1 + WEIGHT_TOLERANCE_PERCENT / 100));
    }
    if (input.step === 'CUSTOMS_CLEARED') {
      if (input.customsEntryNumber) set.customsEntryNumber = input.customsEntryNumber;
      if (input.dutiesAssessed) set.dutiesAssessedMinor = parseDecimalToMinor(input.dutiesAssessed, currency!.minorUnit);
    }
    const reason = input.step === 'CUSTOMS_HOLD' ? input.reason! : input.note;

    await this.db.transaction(async (tx) => {
      await this.engine.transition(tx, t.id, to, actor, { reason, metadata: { step: input.step, location: input.location ?? null, shipmentId: s.id } });
      await tx.update(shipments).set(set).where(eq(shipments.id, s.id));
      await tx.insert(shipmentEvents).values({
        shipmentId: s.id,
        step: input.step,
        actorType: actor.type,
        actorUserId: principal.userId,
        partnerId: partnerFor(rule.party),
        location: input.location ?? null,
        note: reason ?? null,
      });
      await this.audit.record(tx, meta, { action: `shipment.${input.step.toLowerCase()}`, entityType: 'shipment', entityId: s.id, after: { iieId: t.iieId, ...input } });
      // The customs party is told when the parcel reaches the destination.
      if (input.step === 'ARRIVED_DESTINATION' && s.customsBrokerId) {
        const [broker] = await tx.select().from(servicePartners).where(eq(servicePartners.id, s.customsBrokerId));
        await this.tellPartner(tx, broker!, t, `Shipment ${t.iieId} has arrived: customs clearance needed`, `The parcel has arrived${input.location ? ` at ${input.location}` : ''}. Record the customs steps in the partner portal.`);
      }
    });
    return this.detailForPartner(principal, iieId);
  }

  /** Proof of delivery: recipient name and time required; photo and signature optional. Starts the 3-day confirmation period. */
  async deliver(principal: Principal, iieId: string, body: { recipientName: string; deliveredAt: string; note?: string }, files: { photo?: Upload; signature?: Upload }, meta: RequestMeta) {
    const input = { ...body, deliveredAt: new Date(body.deliveredAt) };
    const { t, s, parties, partnerFor } = await this.loadForPartner(principal, iieId);
    if (!parties.includes('LOGISTICS') || !principal.can('shipment.update.assigned')) throw Errors.forbidden('Only the logistics partner can record delivery');
    if (t.status !== 'OUT_FOR_DELIVERY') throw Errors.conflict('INVALID_TRANSITION', 'Only a shipment out for delivery can be marked delivered');
    const now = Date.now();
    if (input.deliveredAt.getTime() > now + 5 * 60_000) throw Errors.badRequest('DELIVERY_IN_FUTURE', 'The delivery time cannot be in the future');
    // Steps may be recorded after the fact, so the only firm lower bound is when the parcel was ready for pickup.
    // Delivery times are entered to the minute, so allow the seconds that rounding drops.
    if (input.deliveredAt.getTime() < s.createdAt.getTime() - 60_000) throw Errors.badRequest('DELIVERY_BEFORE_PICKUP', 'The delivery time is before the parcel was ready for pickup');
    const confirmDue = new Date(now + DELIVERY_CONFIRMATION_DAYS * 24 * 3600_000);

    await this.db.transaction(async (tx) => {
      const photo = files.photo ? await this.media.storeImage(tx, principal.userId, 'DELIVERY_PHOTO', files.photo) : null;
      const signature = files.signature ? await this.media.storeImage(tx, principal.userId, 'DELIVERY_SIGNATURE', files.signature) : null;
      await tx.insert(deliveryProofs).values({
        shipmentId: s.id,
        recipientName: input.recipientName,
        deliveredAt: input.deliveredAt,
        photoMediaId: photo?.id ?? null,
        signatureMediaId: signature?.id ?? null,
        note: input.note ?? null,
        recordedBy: principal.userId,
      });
      await tx.update(shipments).set({ deliveredAt: input.deliveredAt, updatedAt: new Date() }).where(eq(shipments.id, s.id));
      await tx.insert(shipmentEvents).values({ shipmentId: s.id, step: 'DELIVERED', actorType: 'LOGISTICS', actorUserId: principal.userId, partnerId: partnerFor('LOGISTICS'), note: `Received by ${input.recipientName}` });
      await this.engine.transition(tx, t.id, 'DELIVERED', { type: 'LOGISTICS', userId: principal.userId }, {
        reason: `Received by ${input.recipientName}`,
        set: { deliveryConfirmDueAt: confirmDue },
        metadata: { shipmentId: s.id, photo: !!photo, signature: !!signature },
      });
      await this.audit.record(tx, meta, { action: 'shipment.delivered', entityType: 'shipment', entityId: s.id, after: { iieId: t.iieId, recipientName: input.recipientName, deliveredAt: input.deliveredAt, photo: !!photo, signature: !!signature } });
    });
    return this.detailForPartner(principal, iieId);
  }

  // ------------------------------------------------------------------ buyer

  async confirmDelivery(principal: Principal, iieId: string, meta: RequestMeta) {
    const t = await this.loadTransaction(iieId);
    if (t.buyerUserId !== principal.userId) throw Errors.notFound('Order');
    await this.db.transaction(async (tx) => {
      await this.engine.transition(tx, t.id, 'DELIVERY_CONFIRMED', { type: 'BUYER', userId: principal.userId }, { reason: 'The buyer confirmed the delivery', set: { deliveryConfirmDueAt: null }, expectedVersion: t.version });
      await this.shipmentNote(tx, t.id, 'DELIVERY_CONFIRMED', 'BUYER', principal.userId, null);
      await this.startReview(tx, t.id);
      await this.audit.record(tx, meta, { action: 'order.delivery_confirmed', entityType: 'transaction', entityId: t.id });
    });
  }

  /** After delivery is confirmed the buyer has a review period to report a problem; then the seller is paid. */
  private async startReview(tx: Tx, transactionId: string) {
    const ends = new Date(Date.now() + REVIEW_PERIOD_DAYS * 24 * 3600_000);
    await this.engine.transition(tx, transactionId, 'DISPUTE_WINDOW', { type: 'SYSTEM' }, {
      reason: `Review period of ${REVIEW_PERIOD_DAYS} days before the seller is paid`,
      set: { reviewEndsAt: ends },
    });
  }

  /**
   * Confirms deliveries the buyer neither confirmed nor reported within the confirmation period. One database
   * transaction per order, so one failure is logged and retried without blocking the rest.
   */
  async autoConfirmDeliveries(now = new Date(), limit = 20): Promise<number> {
    const due = await this.db
      .select({ id: transactions.id, iieId: transactions.iieId })
      .from(transactions)
      .where(and(eq(transactions.status, 'DELIVERED'), lte(transactions.deliveryConfirmDueAt, now)))
      .limit(limit);
    let confirmed = 0;
    for (const { id, iieId } of due) {
      try {
        const done = await this.db.transaction(async (tx) => {
          const [t] = await tx.select().from(transactions).where(eq(transactions.id, id)).for('update', { skipLocked: true });
          if (!t || t.status !== 'DELIVERED' || !t.deliveryConfirmDueAt || t.deliveryConfirmDueAt > now) return false;
          const reason = `Confirmed automatically ${DELIVERY_CONFIRMATION_DAYS} days after delivery`;
          await this.engine.transition(tx, t.id, 'DELIVERY_CONFIRMED', { type: 'SYSTEM' }, { reason, set: { deliveryConfirmDueAt: null } });
          await this.shipmentNote(tx, t.id, 'DELIVERY_CONFIRMED', 'SYSTEM', null, reason);
          await this.startReview(tx, t.id);
          return true;
        });
        if (done) {
          confirmed++;
          this.logger.log(`Confirmed delivery of ${iieId} automatically`);
        }
      } catch (err) {
        this.logger.error(`Could not confirm delivery of ${iieId}: ${err instanceof AppError ? JSON.stringify(err.getResponse()) : String(err)}`);
      }
    }
    return confirmed;
  }

  // ------------------------------------------------------------------ IIE administration

  /** Shipments for IIE staff, limited to their countries. "attention": unassigned, weight flagged, held or disputed. */
  async listForAdmin(principal: Principal, view: 'attention' | 'all') {
    const scope = principal.scopeOf('transaction.read.any');
    if (!scope) throw Errors.forbidden();
    const logistics = aliasedTable(servicePartners, 'logistics');
    const broker = aliasedTable(servicePartners, 'broker');
    const rows = await this.db
      .select({ s: shipments, t: transactions, logistics: logistics.name, logisticsClears: logistics.clearsCustoms, broker: broker.name })
      .from(shipments)
      .innerJoin(transactions, eq(transactions.id, shipments.transactionId))
      .leftJoin(logistics, eq(logistics.id, shipments.logisticsPartnerId))
      .leftJoin(broker, eq(broker.id, shipments.customsBrokerId))
      .where(scope === 'ALL' ? undefined : or(inArray(transactions.originCountryId, [...scope]), inArray(transactions.destinationCountryId, [...scope])))
      .orderBy(desc(shipments.createdAt))
      .limit(200);
    const items = rows.map((r) => {
      const issues: string[] = [];
      if (!r.s.logisticsPartnerId) issues.push('NO_LOGISTICS_PARTNER');
      if (!r.s.customsBrokerId && !r.logisticsClears) issues.push('NO_CUSTOMS_PARTY');
      if (r.s.weightFlagged) issues.push('WEIGHT_OVER_DECLARED');
      if (r.t.status === 'CUSTOMS_HOLD') issues.push('CUSTOMS_HOLD');
      if (r.t.status === 'DISPUTED') issues.push('PROBLEM_REPORTED');
      return {
        iieId: r.t.iieId,
        status: r.t.status,
        statusLabel: STATUS_LABELS[r.t.status as TransactionStatus],
        logisticsPartner: r.logistics,
        customsBroker: r.broker,
        partnerClearsCustoms: !!r.logisticsClears,
        declaredWeightGrams: r.s.declaredWeightGrams,
        actualWeightGrams: r.s.actualWeightGrams,
        issues,
        createdAt: r.s.createdAt,
      };
    });
    const open = (i: (typeof items)[number]) => !['DELIVERY_CONFIRMED', 'REFUNDED', 'COMPLETED'].includes(i.status);
    return { items: view === 'all' ? items : items.filter((i) => i.issues.length && open(i)) };
  }

  /** IIE assigns (or changes) the carrier and customs broker of a shipment. */
  async assign(principal: Principal, iieId: string, input: { logisticsPartnerId?: string | null; customsBrokerId?: string | null }, meta: RequestMeta) {
    const t = await this.loadTransaction(iieId);
    const [s] = await this.db.select().from(shipments).where(eq(shipments.transactionId, t.id));
    if (!s) throw Errors.notFound('Shipment');
    const check = async (id: string | null | undefined, kind: 'LOGISTICS' | 'CUSTOMS_BROKER') => {
      if (!id) return null;
      const [p] = await this.db.select().from(servicePartners).where(eq(servicePartners.id, id));
      if (!p || p.kind !== kind || !p.active) throw Errors.badRequest('INVALID_PARTNER', kind === 'LOGISTICS' ? 'Choose an active logistics partner' : 'Choose an active customs broker');
      if (kind === 'CUSTOMS_BROKER' && p.countryId !== t.destinationCountryId) throw Errors.badRequest('WRONG_COUNTRY', 'The customs broker must work in the destination country');
      return p;
    };
    const logistics = input.logisticsPartnerId !== undefined ? await check(input.logisticsPartnerId, 'LOGISTICS') : undefined;
    const broker = input.customsBrokerId !== undefined ? await check(input.customsBrokerId, 'CUSTOMS_BROKER') : undefined;
    await this.db.transaction(async (tx) => {
      await tx
        .update(shipments)
        .set({
          ...(logistics !== undefined ? { logisticsPartnerId: logistics?.id ?? null } : {}),
          ...(broker !== undefined ? { customsBrokerId: broker?.id ?? null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(shipments.id, s.id));
      const names = [logistics?.name, broker?.name].filter(Boolean).join(' and ');
      await tx.insert(shipmentEvents).values({ shipmentId: s.id, step: 'ASSIGNED', actorType: 'ADMIN', actorUserId: principal.userId, note: names ? `Assigned to ${names}` : 'Assignment cleared' });
      await this.audit.record(tx, meta, { action: 'shipment.assigned', entityType: 'shipment', entityId: s.id, before: { logisticsPartnerId: s.logisticsPartnerId, customsBrokerId: s.customsBrokerId }, after: input });
      if (logistics && logistics.id !== s.logisticsPartnerId) await this.tellPartner(tx, logistics, t, `Shipment ${t.iieId} assigned to you`, 'IIE assigned this shipment to your team. Open it in the partner portal.');
      if (broker && broker.id !== s.customsBrokerId) await this.tellPartner(tx, broker, t, `Shipment ${t.iieId} assigned to you for customs`, 'IIE assigned this shipment to your team for customs clearance.');
    });
  }

  // ------------------------------------------------------------------ views

  /** Shipment section of an order page. Buyers see the proof-of-delivery images; sellers see who received it. */
  async shipmentView(t: TransactionRow, view: 'BUYER' | 'SELLER' | 'ADMIN' | 'PARTNER') {
    const [s] = await this.db.select().from(shipments).where(eq(shipments.transactionId, t.id));
    if (!s) return { shipment: null };
    const [logistics] = s.logisticsPartnerId ? await this.db.select().from(servicePartners).where(eq(servicePartners.id, s.logisticsPartnerId)) : [];
    const [broker] = s.customsBrokerId ? await this.db.select().from(servicePartners).where(eq(servicePartners.id, s.customsBrokerId)) : [];
    const events = await this.db.select().from(shipmentEvents).where(eq(shipmentEvents.shipmentId, s.id)).orderBy(asc(shipmentEvents.id));
    const [proof] = await this.db.select().from(deliveryProofs).where(eq(deliveryProofs.shipmentId, s.id));
    const [currency] = await this.db.select().from(currencies).where(eq(currencies.code, s.currencyCode));
    const staff = view === 'ADMIN' || view === 'PARTNER';
    return {
      shipment: {
        logisticsPartner: logistics ? { name: logistics.name, phone: logistics.contactPhone, clearsCustoms: logistics.clearsCustoms } : null,
        customsBroker: broker ? { name: broker.name, phone: broker.contactPhone } : null,
        trackingReference: s.trackingReference,
        pickupScheduledFor: s.pickupScheduledFor,
        pickedUpAt: s.pickedUpAt,
        deliveredAt: s.deliveredAt,
        customs: { entryNumber: s.customsEntryNumber, dutiesAssessed: s.dutiesAssessedMinor != null ? toMoneyDto(s.dutiesAssessedMinor, currency!) : null, payableOnArrival: true },
        weights: view === 'BUYER' ? undefined : { declaredGrams: s.declaredWeightGrams, parcelGrams: s.parcelWeightGrams, actualGrams: s.actualWeightGrams, flagged: staff ? s.weightFlagged : undefined },
        events: events.map((e) => ({
          step: e.step,
          label: STEP_LABELS[e.step] ?? e.step,
          location: e.location,
          note: e.note,
          at: e.createdAt,
          ...(view === 'ADMIN' ? { actorType: e.actorType, actorUserId: e.actorUserId } : {}),
        })),
        proofOfDelivery: proof
          ? {
              recipientName: proof.recipientName,
              deliveredAt: proof.deliveredAt,
              note: view === 'SELLER' ? undefined : proof.note,
              photoUrl: view !== 'SELLER' && proof.photoMediaId ? `/api/v1/media/${proof.photoMediaId}` : null,
              signatureUrl: view !== 'SELLER' && proof.signatureMediaId ? `/api/v1/media/${proof.signatureMediaId}` : null,
            }
          : null,
      },
    };
  }

  // ------------------------------------------------------------------ helpers

  private async loadTransaction(iieId: string): Promise<TransactionRow> {
    const [t] = await this.db.select().from(transactions).where(eq(transactions.iieId, iieId.toUpperCase()));
    if (!t) throw Errors.notFound('Order');
    return t;
  }

  /** Active partners the user belongs to. */
  private async memberships(principal: Principal): Promise<PartnerRow[]> {
    if (!principal.can('shipment.read.assigned')) return [];
    const rows = await this.db
      .select({ p: servicePartners })
      .from(partnerMembers)
      .innerJoin(servicePartners, eq(servicePartners.id, partnerMembers.partnerId))
      .where(and(eq(partnerMembers.userId, principal.userId), eq(servicePartners.active, true)));
    return rows.map((r) => r.p);
  }

  /** Which parts of a shipment this user's partners handle. A carrier that clears customs handles both. */
  private partiesFor(s: ShipmentRow, mine: PartnerRow[]): Party[] {
    const parties: Party[] = [];
    const carrier = mine.find((p) => p.id === s.logisticsPartnerId);
    if (carrier) parties.push('LOGISTICS');
    if ((s.customsBrokerId && mine.some((p) => p.id === s.customsBrokerId)) || (!s.customsBrokerId && carrier?.clearsCustoms)) parties.push('CUSTOMS');
    return parties;
  }

  private nextSteps(status: TransactionStatus, _s: ShipmentRow, parties: Party[]): ShipmentStep[] {
    return (NEXT_STEPS[status] ?? []).filter((step) => parties.includes(STEPS[step].party));
  }

  /** Loads a shipment for partner staff. Anyone not on the assigned partners' teams gets "not found". */
  private async loadForPartner(principal: Principal, iieId: string) {
    const mine = await this.memberships(principal);
    const t = await this.loadTransaction(iieId);
    const [s] = await this.db.select().from(shipments).where(eq(shipments.transactionId, t.id));
    if (!s) throw Errors.notFound('Shipment');
    const parties = this.partiesFor(s, mine);
    if (!parties.length) throw Errors.notFound('Shipment');
    const partnerFor = (party: Party) => (party === 'CUSTOMS' && s.customsBrokerId ? s.customsBrokerId : s.logisticsPartnerId);
    return { t, s, parties, partnerFor };
  }

  /** Active carrier serving the lane, and the destination's customs broker unless the carrier clears customs. */
  private async assignParties(t: TransactionRow) {
    const [lane] = await this.db.select().from(lanes).where(and(eq(lanes.originCountryId, t.originCountryId), eq(lanes.destinationCountryId, t.destinationCountryId)));
    const [carrier] = lane
      ? await this.db
          .select({ p: servicePartners })
          .from(partnerLanes)
          .innerJoin(servicePartners, eq(servicePartners.id, partnerLanes.partnerId))
          .where(and(eq(partnerLanes.laneId, lane.id), eq(partnerLanes.active, true), eq(servicePartners.active, true), eq(servicePartners.kind, 'LOGISTICS')))
          .orderBy(asc(servicePartners.createdAt))
          .limit(1)
      : [];
    const logistics = carrier?.p ?? null;
    let broker: PartnerRow | null = null;
    if (!logistics?.clearsCustoms) {
      const [row] = await this.db
        .select()
        .from(servicePartners)
        .where(and(eq(servicePartners.kind, 'CUSTOMS_BROKER'), eq(servicePartners.active, true), eq(servicePartners.countryId, t.destinationCountryId)))
        .orderBy(asc(servicePartners.createdAt))
        .limit(1);
      broker = row ?? null;
    }
    return { logistics, broker };
  }

  /** In-app notice to each team member, and an email to the partner's contact address. */
  private async tellPartner(tx: Tx, partner: PartnerRow, t: TransactionRow, title: string, body: string) {
    const link = `/partner/shipments/${t.iieId}`;
    const members = await tx.select({ userId: partnerMembers.userId }).from(partnerMembers).where(eq(partnerMembers.partnerId, partner.id));
    for (const m of members) await this.notifications.create(tx, m.userId, { type: 'partner.shipment', title, body, link, transactionId: t.id });
    await this.outbox.enqueue(tx, EVENTS.partnerUpdate, { email: partner.contactEmail, firstName: partner.name, subject: title, message: body, path: link });
  }

  async shipmentNote(tx: Tx, transactionId: string, step: string, actorType: string, userId: string | null, note: string | null) {
    const [s] = await tx.select().from(shipments).where(eq(shipments.transactionId, transactionId));
    if (s) await tx.insert(shipmentEvents).values({ shipmentId: s.id, step, actorType, actorUserId: userId, note });
  }
}
