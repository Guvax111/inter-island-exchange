import type { FeePayer } from '@iie/shared';

/** amount x basis points, rounded half-up. Amounts are non-negative minor units. */
export function applyBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps) + 5000n) / 10000n;
}

/** Splits `total` across `weights` in proportion; the rounding remainder goes to the last share so the sum is exact. */
export function allocate(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return weights.map((_, i) => (i === weights.length - 1 ? total : 0n));
  const shares = weights.map((w) => (total * w) / sum);
  shares[shares.length - 1]! += total - shares.reduce((a, b) => a + b, 0n);
  return shares;
}

export interface PricingLine {
  lineTotalMinor: bigint;
  hsCode: string | null;
  originIsCaricom: boolean;
}

export interface DutyRule {
  hsPrefix: string;
  caricomOriginDutyBps: number;
  otherOriginDutyBps: number;
  vatBps: number;
}

/** The most specific rule whose prefix matches the HS code ('' matches everything). */
export function matchDutyRule(rules: DutyRule[], hsCode: string | null): DutyRule | null {
  return (
    rules
      .filter((r) => (hsCode ?? '').startsWith(r.hsPrefix))
      .sort((a, b) => b.hsPrefix.length - a.hsPrefix.length)[0] ?? null
  );
}

export interface PricingInput {
  lines: PricingLine[];
  shippingMinor: bigint;
  feeBps: number;
  feePayer: FeePayer;
  dutyRules: DutyRule[];
}

export interface PricingResult {
  subtotalMinor: bigint;
  shippingMinor: bigint;
  platformFeeMinor: bigint;
  /** Fee added to the buyer's total (0 when the seller pays). */
  buyerFeeMinor: bigint;
  /** Fee deducted from the seller's payout (0 when the buyer pays). */
  sellerFeeMinor: bigint;
  dutyEstimateMinor: bigint;
  vatEstimateMinor: bigint;
  dutiesEstimateMinor: bigint;
  /** True when at least one line had no duty rule (the estimate is incomplete). */
  dutiesIncomplete: boolean;
  /** Paid to IIE's payment partner at checkout. Duties are not included: they are payable on arrival. */
  totalMinor: bigint;
  sellerPayoutMinor: bigint;
  /** What the buyer should expect to pay overall, including estimated duties and taxes. */
  estimatedLandedTotalMinor: bigint;
}

/**
 * Checkout arithmetic (pilot rules):
 *  - IIE fee = fee% of the product subtotal (not of shipping); paid by the buyer (added to the total)
 *    or by the seller (deducted from the payout).
 *  - Duty estimate per line = rate x (line value + its share of shipping); the rate depends on whether the
 *    goods are of CARICOM origin. VAT estimate = VAT% x (value + shipping share + duty).
 */
export function price(input: PricingInput): PricingResult {
  const subtotalMinor = input.lines.reduce((a, l) => a + l.lineTotalMinor, 0n);
  const shippingShares = allocate(input.shippingMinor, input.lines.map((l) => l.lineTotalMinor));
  let dutyEstimateMinor = 0n;
  let vatEstimateMinor = 0n;
  let dutiesIncomplete = false;
  input.lines.forEach((line, i) => {
    const rule = matchDutyRule(input.dutyRules, line.hsCode);
    if (!rule) {
      dutiesIncomplete = true;
      return;
    }
    const dutiable = line.lineTotalMinor + shippingShares[i]!;
    const duty = applyBps(dutiable, line.originIsCaricom ? rule.caricomOriginDutyBps : rule.otherOriginDutyBps);
    dutyEstimateMinor += duty;
    vatEstimateMinor += applyBps(dutiable + duty, rule.vatBps);
  });
  const platformFeeMinor = applyBps(subtotalMinor, input.feeBps);
  const buyerFeeMinor = input.feePayer === 'BUYER' ? platformFeeMinor : 0n;
  const sellerFeeMinor = input.feePayer === 'SELLER' ? platformFeeMinor : 0n;
  const totalMinor = subtotalMinor + input.shippingMinor + buyerFeeMinor;
  const dutiesEstimateMinor = dutyEstimateMinor + vatEstimateMinor;
  return {
    subtotalMinor,
    shippingMinor: input.shippingMinor,
    platformFeeMinor,
    buyerFeeMinor,
    sellerFeeMinor,
    dutyEstimateMinor,
    vatEstimateMinor,
    dutiesEstimateMinor,
    dutiesIncomplete,
    totalMinor,
    sellerPayoutMinor: subtotalMinor - sellerFeeMinor,
    estimatedLandedTotalMinor: totalMinor + dutiesEstimateMinor,
  };
}
