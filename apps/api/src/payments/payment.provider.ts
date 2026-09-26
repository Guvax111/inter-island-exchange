import { createHmac, randomBytes } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import type { AppConfig } from '../config/config';
import { AppError } from '../common/errors';
import { safeEqual } from '../common/crypto';

export interface CreateIntentInput {
  reference: string; // IIE transaction ID
  amountMinor: bigint;
  currency: string;
  returnUrl: string;
}

export interface ProviderEvent {
  eventId: string;
  type: 'payment.processing' | 'payment.succeeded' | 'payment.failed' | 'refund.succeeded' | 'refund.failed' | 'payout.succeeded' | 'payout.failed';
  providerIntentId?: string;
  providerRefundId?: string;
  providerPayoutId?: string;
  amountMinor?: bigint;
  currency?: string;
  failureReason?: string;
  raw: Record<string, unknown>;
}

/**
 * Provider abstraction. IIE never handles card data and never holds funds: the provider collects, holds and
 * releases money; IIE records instructions and outcomes. Adapters for licensed providers implement this interface.
 */
export interface PaymentProvider {
  readonly key: string;
  createIntent(input: CreateIntentInput): Promise<{ providerIntentId: string; redirectUrl: string }>;
  refund(input: { providerIntentId: string; amountMinor: bigint; currency: string; reason: string; idempotencyKey: string }): Promise<{
    providerRefundId: string;
    status: 'SUCCEEDED' | 'PENDING';
  }>;
  /**
   * Pays a seller out of the funds the provider holds for a transaction. `SUCCEEDED` when settled at once;
   * `PENDING` when the provider confirms later with a payout.succeeded / payout.failed webhook.
   */
  payout(input: { reference: string; amountMinor: bigint; currency: string; sellerReference: string; idempotencyKey: string }): Promise<{
    providerPayoutId: string;
    status: 'SUCCEEDED' | 'PENDING';
  }>;
  /** Verifies the signature and parses the event. Throws on anything invalid. */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): ProviderEvent;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

const SIGNATURE_TOLERANCE_SECONDS = 300;
export const SANDBOX_SIGNATURE_HEADER = 'x-sandbox-signature';

/**
 * Sandbox provider: behaves like a hosted-payment-page provider (redirect, then signed webhooks) without real money.
 * Its "hosted page" is served by SandboxPaymentController. Refused in production by configuration.
 */
export class SandboxPaymentProvider implements PaymentProvider {
  readonly key = 'sandbox';
  private readonly secret: string;

  constructor(private readonly config: AppConfig) {
    this.secret = config.SANDBOX_PAYMENT_SECRET ?? 'sandbox-local-development-secret';
  }

  async createIntent(input: CreateIntentInput) {
    const providerIntentId = `sbx_pi_${randomBytes(12).toString('hex')}`;
    const web = this.config.WEB_BASE_URL.replace(/\/$/, '');
    return { providerIntentId, redirectUrl: `${web}/api/v1/sandbox-pay/${providerIntentId}?token=${this.pageToken(providerIntentId)}` };
  }

  async refund() {
    return { providerRefundId: `sbx_re_${randomBytes(12).toString('hex')}`, status: 'SUCCEEDED' as const };
  }

  async payout() {
    return { providerPayoutId: `sbx_po_${randomBytes(12).toString('hex')}`, status: 'SUCCEEDED' as const };
  }

  /** Link token for the hosted page, so only the buyer who was redirected can complete the payment. */
  pageToken(providerIntentId: string): string {
    return createHmac('sha256', this.secret).update(`page:${providerIntentId}`).digest('base64url');
  }

  /** Builds a signed webhook, as the provider would send it. */
  signedEvent(event: Record<string, unknown>, timestamp = Math.floor(Date.now() / 1000)) {
    const body = JSON.stringify(event);
    const signature = createHmac('sha256', this.secret).update(`${timestamp}.${body}`).digest('hex');
    return { body: Buffer.from(body), headers: { [SANDBOX_SIGNATURE_HEADER]: `t=${timestamp},v1=${signature}` } };
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): ProviderEvent {
    const invalid = () => new AppError(HttpStatus.BAD_REQUEST, 'INVALID_WEBHOOK', 'Webhook signature is missing or invalid');
    const header = headers[SANDBOX_SIGNATURE_HEADER];
    const match = typeof header === 'string' ? /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header) : null;
    if (!match) throw invalid();
    const [, t, v1] = match;
    if (Math.abs(Date.now() / 1000 - Number(t)) > SIGNATURE_TOLERANCE_SECONDS) throw invalid();
    const expected = createHmac('sha256', this.secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
    if (!safeEqual(expected, v1!)) throw invalid();
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw invalid();
    }
    const type = raw.type as ProviderEvent['type'];
    if (!['payment.processing', 'payment.succeeded', 'payment.failed', 'refund.succeeded', 'refund.failed', 'payout.succeeded', 'payout.failed'].includes(type) || typeof raw.id !== 'string') {
      throw invalid();
    }
    return {
      eventId: raw.id,
      type,
      providerIntentId: raw.payment_intent as string | undefined,
      providerRefundId: raw.refund as string | undefined,
      providerPayoutId: raw.payout as string | undefined,
      amountMinor: raw.amount_minor !== undefined ? BigInt(String(raw.amount_minor)) : undefined,
      currency: raw.currency as string | undefined,
      failureReason: raw.failure_reason as string | undefined,
      raw,
    };
  }
}

export function createPaymentProvider(config: AppConfig): PaymentProvider {
  return new SandboxPaymentProvider(config);
}
