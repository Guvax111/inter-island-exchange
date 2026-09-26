import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res, type RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import { formatMinor, sandboxOutcomeSchema } from '@iie/shared';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Database, DB } from '../db/db';
import { currencies, paymentIntents, payouts, sellerProfiles, sellerStorefronts, transactions } from '../db/schema';
import { DeclineSaleDto, ExchangeRateDto } from '../common/dto';
import { Errors } from '../common/errors';
import { toMoneyDto } from '../common/money';
import { requestMeta } from '../common/request';
import { safeEqual } from '../common/crypto';
import type { Principal } from '../rbac/principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { IgnoreSession, RequireActiveAccount, RequirePermissions } from '../auth/decorators';
import { FxService } from './fx.service';
import { LedgerService } from './ledger.service';
import { PAYMENT_PROVIDER, PaymentProvider, SandboxPaymentProvider } from './payment.provider';
import { PaymentsService } from './payments.service';

@ApiTags('buyer')
@Controller('me')
export class PaymentActionsController {
  constructor(private readonly payments: PaymentsService) {}

  @RequireActiveAccount()
  @RequirePermissions('order.create')
  @Post('orders/:iieId/pay')
  @HttpCode(200)
  pay(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string, @Req() req: Request) {
    return this.payments.startPayment(p, iieId, requestMeta(req));
  }

  @RequirePermissions('order.fulfil.own')
  @Post('sales/:iieId/confirm')
  @HttpCode(204)
  async confirm(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string, @Req() req: Request) {
    await this.payments.confirmSale(p, iieId, requestMeta(req));
  }

  @RequirePermissions('order.fulfil.own')
  @Post('sales/:iieId/decline')
  @HttpCode(204)
  async decline(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string, @Body() body: DeclineSaleDto, @Req() req: Request) {
    await this.payments.declineSale(p, iieId, body.reason, requestMeta(req));
  }
}

/** Provider webhooks: public, authenticated by the provider's signature over the raw body. */
@ApiTags('webhooks')
@Controller('webhooks/payments')
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @IgnoreSession()
  @Post(':provider')
  @HttpCode(200)
  receive(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    if (!req.rawBody) throw Errors.badRequest('INVALID_WEBHOOK', 'Missing body');
    return this.payments.receiveWebhook(provider, req.headers, req.rawBody);
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The sandbox provider's "hosted payment page". Stands in for a licensed provider's checkout page so the full
 * redirect -> webhook flow can be tested. Only available when PAYMENT_PROVIDER=sandbox (never in production).
 */
@ApiExcludeController()
@Controller('sandbox-pay')
export class SandboxPaymentController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly payments: PaymentsService,
  ) {}

  private sandbox(): SandboxPaymentProvider {
    if (!(this.provider instanceof SandboxPaymentProvider)) throw Errors.notFound('Page');
    return this.provider;
  }

  private async load(providerIntentId: string, token: string | undefined) {
    const sandbox = this.sandbox();
    if (!token || !safeEqual(token, sandbox.pageToken(providerIntentId))) throw Errors.notFound('Payment');
    const [row] = await this.db
      .select({ intent: paymentIntents, iieId: transactions.iieId, store: sellerStorefronts.displayName, currency: currencies })
      .from(paymentIntents)
      .innerJoin(transactions, eq(transactions.id, paymentIntents.transactionId))
      .innerJoin(sellerStorefronts, eq(sellerStorefronts.sellerProfileId, transactions.sellerProfileId))
      .innerJoin(currencies, eq(currencies.code, paymentIntents.currencyCode))
      .where(eq(paymentIntents.providerIntentId, providerIntentId));
    if (!row) throw Errors.notFound('Payment');
    return { sandbox, ...row };
  }

  @IgnoreSession()
  @Get(':id')
  async page(@Param('id') id: string, @Query('token') token: string | undefined, @Res() res: Response) {
    const { intent, iieId, store, currency } = await this.load(id, token);
    const amount = `${currency.symbol}${formatMinor(intent.amountMinor, currency.minorUnit)} ${currency.code}`;
    const open = ['REQUIRES_ACTION', 'PROCESSING'].includes(intent.status);
    const button = (outcome: string, label: string, colour: string) =>
      `<form method="post" action="/api/v1/sandbox-pay/${esc(id)}"><input type="hidden" name="token" value="${esc(token!)}"><input type="hidden" name="outcome" value="${outcome}"><button style="width:100%;padding:14px;margin-top:10px;border:0;border-radius:8px;background:${colour};color:#fff;font-size:16px">${label}</button></form>`;
    res.setHeader('Cache-Control', 'no-store');
    // Helmet's default no-referrer makes browsers send "Origin: null" on the form post, which the origin check refuses.
    res.setHeader('Referrer-Policy', 'same-origin');
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sandbox payment</title></head>
<body style="font-family:Arial,sans-serif;background:#f1f5f9;margin:0;padding:16px">
<div style="max-width:420px;margin:24px auto;background:#fff;border-radius:12px;padding:24px;border:3px dashed #f97316">
<p style="margin:0;color:#c2410c;font-weight:bold;letter-spacing:1px">SANDBOX PAYMENT PAGE · NO REAL MONEY</p>
<p style="color:#475569;font-size:14px">This page stands in for IIE's licensed payment partner during testing. Choose what the "bank" should answer.</p>
<p style="margin:16px 0 4px;color:#475569">Order ${esc(iieId)} · ${esc(store)}</p>
<p style="margin:0;font-size:28px;font-weight:bold;color:#011e4d">${esc(amount)}</p>
${open ? button('SUCCEED', 'Pay successfully', '#3d8a1a') + button('DECLINE', 'Decline the card', '#b91c1c') + button('PROCESSING', 'Bank transfer (pending)', '#024381') : `<p style="margin-top:16px">This payment is ${esc(intent.status.toLowerCase())}.</p>`}
</div></body></html>`);
  }

  @IgnoreSession()
  @Post(':id')
  async complete(@Param('id') id: string, @Body() body: unknown, @Res() res: Response) {
    const parsed = sandboxOutcomeSchema.safeParse(body);
    if (!parsed.success) throw Errors.badRequest('INVALID_REQUEST', 'Choose an outcome');
    const { sandbox, intent, iieId } = await this.load(id, parsed.data.token);
    const base = { payment_intent: intent.providerIntentId, amount_minor: intent.amountMinor.toString(), currency: intent.currencyCode };
    const event = {
      SUCCEED: { ...base, type: 'payment.succeeded' },
      DECLINE: { ...base, type: 'payment.failed', failure_reason: 'Card declined (sandbox)' },
      PROCESSING: { ...base, type: 'payment.processing' },
    }[parsed.data.outcome];
    const signed = sandbox.signedEvent({ id: `sbx_evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`, ...event });
    // Delivered through the same verification and processing path as a real provider's webhook.
    await this.payments.receiveWebhook('sandbox', signed.headers, signed.body);
    const web = this.config.WEB_BASE_URL.replace(/\/$/, '');
    res.redirect(303, `${web}/orders/${iieId}?payment=${parsed.data.outcome.toLowerCase()}`);
  }
}

@ApiTags('admin')
@Controller('admin')
export class AdminPaymentsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    private readonly fx: FxService,
  ) {}

  /** Money trail for one transaction: payments, refunds, ledger lines and per-account balances. */
  @RequirePermissions('transaction.read.any')
  @Get('transactions/:iieId/money')
  async money(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string) {
    const [t] = await this.db.select().from(transactions).where(eq(transactions.iieId, iieId.toUpperCase()));
    if (!t || (!p.canInCountry('transaction.read.any', t.originCountryId) && !p.canInCountry('transaction.read.any', t.destinationCountryId))) {
      throw Errors.notFound('Transaction');
    }
    const [currency] = await this.db.select().from(currencies).where(eq(currencies.code, t.transactionCurrency));
    const m = (v: bigint) => toMoneyDto(v, currency!);
    const { rows, balances } = await this.ledger.entries(t.id);
    const summary = await this.payments.paymentSummary(t.id);
    const debits = rows.filter((r) => r.direction === 'DEBIT').reduce((a, r) => a + r.amountMinor, 0n);
    const credits = rows.filter((r) => r.direction === 'CREDIT').reduce((a, r) => a + r.amountMinor, 0n);
    return {
      balanced: debits === credits,
      ledger: rows.map((r) => ({ posting: r.postingId, account: r.account, direction: r.direction, amount: m(r.amountMinor), description: r.description, at: r.createdAt })),
      balances: Object.fromEntries([...balances].map(([k, v]) => [k, { ...m(v < 0n ? -v : v), side: v < 0n ? 'CREDIT' : v > 0n ? 'DEBIT' : 'NONE' }])),
      payments: summary.intents.map((i) => ({ provider: i.provider, providerIntentId: i.providerIntentId, status: i.status, amount: m(i.amountMinor), createdAt: i.createdAt })),
      refunds: summary.refunds.map((r) => ({ status: r.status, amount: m(r.amountMinor), reason: r.reason, requestedBy: r.requestedBy, providerRefundId: r.providerRefundId, createdAt: r.createdAt })),
      events: summary.events.map((e) => ({ type: e.type, amount: e.amountMinor != null ? m(e.amountMinor) : null, detail: e.detail, at: e.createdAt })),
    };
  }

  @RequirePermissions('payout.approve')
  @Post('payouts/:iieId/retry')
  @HttpCode(204)
  async retryPayout(@Param('iieId') iieId: string, @Req() req: Request) {
    await this.payments.retryPayout(iieId, requestMeta(req));
  }

  @RequirePermissions('payout.approve')
  @Get('payouts')
  async payoutList(@Query('status') status?: string) {
    const rows = await this.db
      .select({ payout: payouts, iieId: transactions.iieId, store: sellerStorefronts.displayName, currency: currencies })
      .from(payouts)
      .innerJoin(transactions, eq(transactions.id, payouts.transactionId))
      .innerJoin(sellerStorefronts, eq(sellerStorefronts.sellerProfileId, payouts.sellerProfileId))
      .innerJoin(currencies, eq(currencies.code, payouts.currencyCode))
      .where(status ? eq(payouts.status, status) : undefined)
      .orderBy(desc(payouts.createdAt))
      .limit(200);
    return { items: rows.map((r) => ({ iieId: r.iieId, seller: r.store, status: r.payout.status, amount: toMoneyDto(r.payout.amountMinor, r.currency), createdAt: r.payout.createdAt })) };
  }

  @RequirePermissions('config.manage')
  @Get('exchange-rates')
  async rates() {
    return { items: await this.fx.list() };
  }

  @RequirePermissions('config.manage')
  @Post('exchange-rates')
  addRate(@Body() body: ExchangeRateDto, @Req() req: Request) {
    return this.fx.add(body, requestMeta(req));
  }
}

/** A seller's payouts: held, paid or cancelled, per order. */
@ApiTags('seller')
@Controller('me/payouts')
export class SellerPayoutsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @RequirePermissions('payout.read.own')
  @Get()
  async list(@CurrentPrincipal() p: Principal) {
    const [seller] = await this.db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, p.userId));
    if (!seller) return { items: [], totals: [] };
    const rows = await this.db
      .select({ payout: payouts, iieId: transactions.iieId, status: transactions.status, reviewEndsAt: transactions.reviewEndsAt, currency: currencies })
      .from(payouts)
      .innerJoin(transactions, eq(transactions.id, payouts.transactionId))
      .innerJoin(currencies, eq(currencies.code, payouts.currencyCode))
      .where(eq(payouts.sellerProfileId, seller.id))
      .orderBy(desc(payouts.createdAt))
      .limit(200);
    return {
      items: rows.map((r) => ({
        iieId: r.iieId,
        status: r.payout.status,
        amount: toMoneyDto(r.payout.amountMinor, r.currency),
        // When the payout is due: the end of the review period, once delivery is confirmed.
        dueAt: r.status === 'DISPUTE_WINDOW' ? r.reviewEndsAt : null,
        paidAt: r.payout.releasedAt,
        providerReference: r.payout.providerPayoutId,
      })),
    };
  }
}
