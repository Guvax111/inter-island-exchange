import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import { PAYMENT_WINDOW_MINUTES, QUOTE_VALID_MINUTES, type FeePayer } from '@iie/shared';
import { Database, DB } from '../db/db';
import {
  addresses,
  buyerProfiles,
  cartItems,
  carts,
  countries,
  currencies,
  dutyEstimates,
  feeRules,
  inventory,
  inventoryReservations,
  laneShippingRates,
  lanes,
  orderItems,
  orders,
  products,
  productVariants,
  quotes,
  sellerProfiles,
  sellerStorefronts,
  transactions,
  users,
  verificationLimits,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors';
import { toMoneyDto, type CurrencyInfo } from '../common/money';
import type { RequestMeta } from '../common/request';
import { isPublicStatus } from '../catalog/visibility';
import type { Principal } from '../rbac/principal';
import { price } from './pricing';
import { TransactionEngine } from './transaction-engine';

/** Everything frozen into a quote. Stored as JSON (bigints as strings) and copied into the order. */
export interface QuoteSnapshot {
  lines: {
    variantId: string;
    productId: string;
    sku: string;
    title: string;
    variantName: string;
    hsCode: string | null;
    countryOfOrigin: string;
    unitWeightGrams: number;
    unitPriceMinor: string;
    quantity: number;
    lineTotalMinor: string;
  }[];
  weightGrams: number;
  shipping: { rateId: string; serviceName: string; maxWeightGrams: number; priceMinor: string; isPlaceholder: boolean };
  fee: { bps: number; payer: FeePayer; amountMinor: string; buyerMinor: string; sellerMinor: string };
  duties: { dutyMinor: string; vatMinor: string; totalMinor: string; incomplete: boolean; isPlaceholder: boolean; notes: string };
  subtotalMinor: string;
  totalMinor: string;
  sellerPayoutMinor: string;
  estimatedLandedTotalMinor: string;
  address: { line1: string; line2: string | null; city: string; region: string | null; postalCode: string | null; country: string };
  origin: { id: string; code: string; iieCode: string; name: string };
  destination: { id: string; code: string; iieCode: string; name: string };
  seller: { id: string; slug: string; name: string };
}

const problem = (code: string, message: string, details?: unknown) => new AppError(HttpStatus.BAD_REQUEST, code, message, details);

/**
 * Checkout for one seller at a time (pilot rule). quote() runs the validation pipeline and freezes prices;
 * placeOrder() turns a valid quote into an order and a transaction, reserving stock atomically.
 */
@Injectable()
export class CheckoutService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly engine: TransactionEngine,
    private readonly audit: AuditService,
  ) {}

  async quote(principal: Principal, sellerSlug: string, addressId: string) {
    // 1. Buyer: active account with a buyer profile.
    if (principal.status !== 'ACTIVE') throw new AppError(HttpStatus.FORBIDDEN, 'ACCOUNT_NOT_ACTIVE', 'Finish verifying your account to check out');
    const [buyer] = await this.db.select().from(buyerProfiles).where(eq(buyerProfiles.userId, principal.userId));
    if (!buyer) throw Errors.forbidden('Only buyer accounts can check out');

    // 2. Destination: one of the buyer's own addresses, in their registered country.
    const [addressRow] = await this.db
      .select({ address: addresses, country: countries })
      .from(addresses)
      .innerJoin(countries, eq(countries.id, addresses.countryId))
      .where(and(eq(addresses.id, addressId), eq(addresses.userId, principal.userId)));
    if (!addressRow) throw Errors.notFound('Address');
    const destination = addressRow.country;
    if (!destination.marketplaceEnabled) throw problem('DESTINATION_CLOSED', `IIE is not delivering to ${destination.name} yet`);

    // 3. Seller: active, with a storefront, in an open country.
    const [sellerRow] = await this.db
      .select({ seller: sellerProfiles, storefront: sellerStorefronts, country: countries, userStatus: users.status })
      .from(sellerStorefronts)
      .innerJoin(sellerProfiles, eq(sellerProfiles.id, sellerStorefronts.sellerProfileId))
      .innerJoin(users, eq(users.id, sellerProfiles.userId))
      .innerJoin(countries, eq(countries.id, sellerProfiles.countryId))
      .where(eq(sellerStorefronts.slug, sellerSlug));
    if (!sellerRow || sellerRow.seller.status !== 'ACTIVE' || sellerRow.userStatus !== 'ACTIVE' || !sellerRow.country.marketplaceEnabled) {
      throw problem('SELLER_UNAVAILABLE', 'This seller is not taking orders right now');
    }
    if (sellerRow.seller.userId === principal.userId) throw problem('OWN_PRODUCT', 'You cannot buy your own products');
    const origin = sellerRow.country;

    // 4. Trade lane open from the seller's country to the destination.
    const [lane] = await this.db
      .select()
      .from(lanes)
      .where(and(eq(lanes.originCountryId, origin.id), eq(lanes.destinationCountryId, destination.id), eq(lanes.enabled, true)));
    if (!lane) throw problem('NOT_SHIPPABLE_TO_YOU', `${sellerRow.storefront.displayName} does not ship to ${destination.name} yet`);

    // 5. Cart lines for this seller: each product still public and in stock.
    const lines = await this.db
      .select({
        variant: productVariants,
        product: products,
        available: sql<number>`coalesce(${inventory.quantityOnHand} - ${inventory.quantityReserved}, 0)::int`,
        quantity: cartItems.quantity,
        originCode: sql<string>`(select iso_alpha2 from countries where id = ${products.countryOfOriginId})`,
        originBloc: sql<string>`(select regional_bloc from countries where id = ${products.countryOfOriginId})`,
      })
      .from(cartItems)
      .innerJoin(carts, eq(carts.id, cartItems.cartId))
      .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
      .where(and(eq(carts.userId, principal.userId), eq(products.sellerProfileId, sellerRow.seller.id)))
      .orderBy(asc(cartItems.createdAt));
    if (!lines.length) throw problem('NOTHING_TO_CHECKOUT', 'Your cart has no items from this seller');
    const issues = lines
      .map((l) => ({
        sku: l.variant.sku,
        issue: !isPublicStatus(l.product.status) || l.variant.archived ? 'UNAVAILABLE' : l.quantity > l.available ? 'INSUFFICIENT_STOCK' : null,
      }))
      .filter((i) => i.issue);
    if (issues.length) throw problem('CART_HAS_ISSUES', 'Some items are no longer available in the quantity requested. Update your cart and try again.', issues);

    // 6. Shipping by total weight.
    const weightGrams = lines.reduce((n, l) => n + (l.product.weightGrams ?? 0) * l.quantity, 0);
    const [rate] = await this.db
      .select()
      .from(laneShippingRates)
      .where(and(eq(laneShippingRates.laneId, lane.id), eq(laneShippingRates.active, true), gte(laneShippingRates.maxWeightGrams, weightGrams)))
      .orderBy(asc(laneShippingRates.maxWeightGrams))
      .limit(1);
    if (!rate) throw problem('NO_SHIPPING_RATE', `This order (${(weightGrams / 1000).toFixed(1)} kg) is too heavy for the available shipping options. Reduce the quantity or contact IIE.`);

    // 7. Fee and duty estimate configuration.
    const [feeRule] = await this.db
      .select()
      .from(feeRules)
      .where(and(eq(feeRules.active, true), sql`(${feeRules.laneId} = ${lane.id} or ${feeRules.laneId} is null)`))
      .orderBy(sql`${feeRules.laneId} is null`)
      .limit(1);
    const feeBps = feeRule?.percentBps ?? 0;
    const feePayer = (sellerRow.storefront.feePayer ?? feeRule?.defaultPayer ?? 'BUYER') as FeePayer;
    const rules = await this.db.select().from(dutyEstimates).where(eq(dutyEstimates.destinationCountryId, destination.id));

    const priced = price({
      lines: lines.map((l) => ({ lineTotalMinor: l.variant.priceMinor * BigInt(l.quantity), hsCode: l.product.hsCode, originIsCaricom: l.originBloc === 'CARICOM' })),
      shippingMinor: rate.priceMinor,
      feeBps,
      feePayer,
      dutyRules: rules,
    });

    // 8. Buyer limits for their verification level, where configured.
    const [limit] = await this.db
      .select()
      .from(verificationLimits)
      .where(and(eq(verificationLimits.countryId, destination.id), eq(verificationLimits.level, buyer.verificationLevel)));
    if (limit?.maxTransactionMinor != null && priced.totalMinor > limit.maxTransactionMinor) {
      throw problem('LIMIT_EXCEEDED', 'This order is above the limit for your account level. Contact IIE to raise it.');
    }

    const currencyCode = lines[0]!.variant.currencyCode;
    const snapshot: QuoteSnapshot = {
      lines: lines.map((l) => ({
        variantId: l.variant.id,
        productId: l.product.id,
        sku: l.variant.sku,
        title: l.product.title,
        variantName: l.variant.name,
        hsCode: l.product.hsCode,
        countryOfOrigin: l.originCode,
        unitWeightGrams: l.product.weightGrams ?? 0,
        unitPriceMinor: l.variant.priceMinor.toString(),
        quantity: l.quantity,
        lineTotalMinor: (l.variant.priceMinor * BigInt(l.quantity)).toString(),
      })),
      weightGrams,
      shipping: { rateId: rate.id, serviceName: rate.serviceName, maxWeightGrams: rate.maxWeightGrams, priceMinor: rate.priceMinor.toString(), isPlaceholder: rate.isPlaceholder },
      fee: { bps: feeBps, payer: feePayer, amountMinor: priced.platformFeeMinor.toString(), buyerMinor: priced.buyerFeeMinor.toString(), sellerMinor: priced.sellerFeeMinor.toString() },
      duties: {
        dutyMinor: priced.dutyEstimateMinor.toString(),
        vatMinor: priced.vatEstimateMinor.toString(),
        totalMinor: priced.dutiesEstimateMinor.toString(),
        incomplete: priced.dutiesIncomplete,
        isPlaceholder: rules.some((r) => r.isPlaceholder),
        notes: rules.find((r) => r.hsPrefix === '')?.notes ?? '',
      },
      subtotalMinor: priced.subtotalMinor.toString(),
      totalMinor: priced.totalMinor.toString(),
      sellerPayoutMinor: priced.sellerPayoutMinor.toString(),
      estimatedLandedTotalMinor: priced.estimatedLandedTotalMinor.toString(),
      address: {
        line1: addressRow.address.line1,
        line2: addressRow.address.line2,
        city: addressRow.address.city,
        region: addressRow.address.region,
        postalCode: addressRow.address.postalCode,
        country: destination.name,
      },
      origin: { id: origin.id, code: origin.isoAlpha2, iieCode: origin.iieCode, name: origin.name },
      destination: { id: destination.id, code: destination.isoAlpha2, iieCode: destination.iieCode, name: destination.name },
      seller: { id: sellerRow.seller.id, slug: sellerRow.storefront.slug, name: sellerRow.storefront.displayName },
    };
    const [quote] = await this.db
      .insert(quotes)
      .values({
        buyerUserId: principal.userId,
        sellerProfileId: sellerRow.seller.id,
        addressId,
        currencyCode,
        snapshot,
        totalMinor: priced.totalMinor,
        expiresAt: new Date(Date.now() + QUOTE_VALID_MINUTES * 60_000),
      })
      .returning();
    return this.quoteDto(quote!.id, snapshot, quote!.expiresAt, await this.currency(currencyCode));
  }

  async placeOrder(principal: Principal, quoteId: string, meta: RequestMeta) {
    const iieId = await this.db.transaction(async (tx) => {
      const [quote] = await tx.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.buyerUserId, principal.userId))).for('update');
      if (!quote) throw Errors.notFound('Quote');
      if (quote.usedAt) throw Errors.conflict('QUOTE_USED', 'This checkout was already used to place an order');
      if (quote.expiresAt <= new Date()) throw Errors.conflict('QUOTE_EXPIRED', 'Prices may have changed. Review your order again.');
      const snap = quote.snapshot as QuoteSnapshot;

      // Reserve stock under row locks so two buyers cannot take the same last unit.
      const variantIds = snap.lines.map((l) => l.variantId);
      const stock = await tx.select().from(inventory).where(inArray(inventory.variantId, variantIds)).for('update');
      for (const line of snap.lines) {
        const row = stock.find((s) => s.variantId === line.variantId);
        if (!row || row.quantityOnHand - row.quantityReserved < line.quantity) {
          throw Errors.conflict('STOCK_CHANGED', `"${line.title}" no longer has ${line.quantity} available. Update your cart and try again.`);
        }
      }
      for (const line of snap.lines) {
        await tx
          .update(inventory)
          .set({ quantityReserved: sql`${inventory.quantityReserved} + ${line.quantity}`, updatedAt: new Date() })
          .where(eq(inventory.variantId, line.variantId));
      }

      const [order] = await tx
        .insert(orders)
        .values({ buyerUserId: principal.userId, sellerProfileId: snap.seller.id, quoteId: quote.id, deliveryAddress: snap.address })
        .returning();
      await tx.insert(orderItems).values(
        snap.lines.map((l) => ({
          orderId: order!.id,
          variantId: l.variantId,
          productId: l.productId,
          sku: l.sku,
          title: l.title,
          variantName: l.variantName,
          hsCode: l.hsCode,
          countryOfOrigin: l.countryOfOrigin,
          unitWeightGrams: l.unitWeightGrams,
          unitPriceMinor: BigInt(l.unitPriceMinor),
          quantity: l.quantity,
          lineTotalMinor: BigInt(l.lineTotalMinor),
          currencyCode: quote.currencyCode,
        })),
      );

      const [{ n }] = (await tx.execute<{ n: string }>(sql`select nextval('transaction_number_seq')::text as n`)).rows as [{ n: string }];
      const iieId = `IIE-${snap.origin.iieCode}-${snap.destination.iieCode}-${n.padStart(6, '0')}`;
      const [created] = await tx
        .insert(transactions)
        .values({
          iieId,
          orderId: order!.id,
          buyerUserId: principal.userId,
          sellerProfileId: snap.seller.id,
          originCountryId: snap.origin.id,
          destinationCountryId: snap.destination.id,
          status: 'CREATED',
          transactionCurrency: quote.currencyCode,
          buyerCurrency: quote.currencyCode,
          payoutCurrency: quote.currencyCode,
          subtotalMinor: BigInt(snap.subtotalMinor),
          shippingMinor: BigInt(snap.shipping.priceMinor),
          platformFeeMinor: BigInt(snap.fee.amountMinor),
          platformFeeBps: snap.fee.bps,
          feePayer: snap.fee.payer,
          dutiesEstimateMinor: BigInt(snap.duties.totalMinor),
          totalMinor: BigInt(snap.totalMinor),
          sellerPayoutMinor: BigInt(snap.sellerPayoutMinor),
        })
        .returning();
      const dueAt = new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60_000);
      await tx.insert(inventoryReservations).values(snap.lines.map((l) => ({ transactionId: created!.id, variantId: l.variantId, quantity: l.quantity, expiresAt: dueAt })));
      await this.engine.recordCreated(tx, created!.id, { type: 'BUYER', userId: principal.userId });
      await this.engine.transition(tx, created!.id, 'AWAITING_PAYMENT', { type: 'SYSTEM' }, { set: { paymentDueAt: dueAt }, reason: 'Order placed; stock reserved' });

      // The ordered lines leave the cart; lines from other sellers stay.
      const [cart] = await tx.select().from(carts).where(eq(carts.userId, principal.userId));
      if (cart) await tx.delete(cartItems).where(and(eq(cartItems.cartId, cart.id), inArray(cartItems.variantId, variantIds)));
      await tx.update(quotes).set({ usedAt: new Date() }).where(eq(quotes.id, quote.id));
      await this.audit.record(tx, meta, { action: 'order.placed', entityType: 'transaction', entityId: created!.id, after: { iieId, totalMinor: snap.totalMinor } });
      return iieId;
    });
    return { iieId };
  }

  private async currency(code: string): Promise<CurrencyInfo> {
    const [c] = await this.db.select().from(currencies).where(eq(currencies.code, code));
    return c!;
  }

  private quoteDto(id: string, s: QuoteSnapshot, expiresAt: Date, c: CurrencyInfo) {
    const m = (v: string) => toMoneyDto(BigInt(v), c);
    return {
      quoteId: id,
      expiresAt,
      seller: s.seller,
      shipsFrom: s.origin.name,
      shipsTo: s.destination.name,
      address: s.address,
      lines: s.lines.map((l) => ({ ...l, unitPrice: m(l.unitPriceMinor), lineTotal: m(l.lineTotalMinor) })),
      weightKg: s.weightGrams / 1000,
      productCost: m(s.subtotalMinor),
      shipping: { ...m(s.shipping.priceMinor), serviceName: s.shipping.serviceName, isPlaceholder: s.shipping.isPlaceholder },
      platformFee: { ...m(s.fee.amountMinor), percent: s.fee.bps / 100, payer: s.fee.payer, chargedToBuyer: m(s.fee.buyerMinor) },
      otherFees: m('0'),
      dutiesEstimate: { ...m(s.duties.totalMinor), duty: m(s.duties.dutyMinor), vat: m(s.duties.vatMinor), incomplete: s.duties.incomplete, isPlaceholder: s.duties.isPlaceholder, paidWhen: 'ON_ARRIVAL' as const },
      total: m(s.totalMinor),
      estimatedLandedTotal: m(s.estimatedLandedTotalMinor),
    };
  }
}

