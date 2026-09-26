import { describe, expect, it } from 'vitest';
import { allocate, applyBps, matchDutyRule, price } from './pricing';

const svg = [{ hsPrefix: '', caricomOriginDutyBps: 0, otherOriginDutyBps: 2000, vatBps: 1600 }];

describe('pricing', () => {
  it('rounds basis points half-up in minor units', () => {
    expect(applyBps(9000n, 500)).toBe(450n);
    expect(applyBps(1n, 5000)).toBe(1n); // 0.5 -> 1
    expect(applyBps(3n, 500)).toBe(0n); // 0.15 -> 0
  });

  it('allocates shipping exactly, remainder to the last line', () => {
    expect(allocate(1000n, [1n, 1n, 1n])).toEqual([333n, 333n, 334n]);
    expect(allocate(3500n, [9000n])).toEqual([3500n]);
    expect(allocate(100n, [0n, 0n])).toEqual([0n, 100n]);
  });

  it('prices the pilot order: 2 x EC$45 diapers, EC$35 shipping, 5% fee paid by the buyer', () => {
    const r = price({ lines: [{ lineTotalMinor: 9000n, hsCode: '961900', originIsCaricom: true }], shippingMinor: 3500n, feeBps: 500, feePayer: 'BUYER', dutyRules: svg });
    expect(r).toMatchObject({
      subtotalMinor: 9000n,
      platformFeeMinor: 450n,
      buyerFeeMinor: 450n,
      sellerFeeMinor: 0n,
      totalMinor: 12950n, // 90 + 35 + 4.50
      sellerPayoutMinor: 9000n,
      dutyEstimateMinor: 0n, // CARICOM origin
      vatEstimateMinor: 2000n, // 16% of (90 + 35)
      estimatedLandedTotalMinor: 14950n,
      dutiesIncomplete: false,
    });
  });

  it('deducts the fee from the payout when the seller pays', () => {
    const r = price({ lines: [{ lineTotalMinor: 9000n, hsCode: '961900', originIsCaricom: true }], shippingMinor: 3500n, feeBps: 500, feePayer: 'SELLER', dutyRules: svg });
    expect(r.totalMinor).toBe(12500n);
    expect(r.sellerPayoutMinor).toBe(8550n);
    expect(r.buyerFeeMinor + r.sellerFeeMinor).toBe(r.platformFeeMinor);
  });

  it('applies non-CARICOM duty before VAT, per line', () => {
    const r = price({
      lines: [
        { lineTotalMinor: 10000n, hsCode: '961900', originIsCaricom: false },
        { lineTotalMinor: 10000n, hsCode: '961900', originIsCaricom: true },
      ],
      shippingMinor: 2000n,
      feeBps: 0,
      feePayer: 'BUYER',
      dutyRules: svg,
    });
    // Line 1: dutiable 110.00 -> duty 22.00, VAT 16% of 132.00 = 21.12. Line 2: duty 0, VAT 16% of 110.00 = 17.60.
    expect(r.dutyEstimateMinor).toBe(2200n);
    expect(r.vatEstimateMinor).toBe(2112n + 1760n);
  });

  it('uses the most specific HS rule and flags lines with no rule', () => {
    const rules = [...svg, { hsPrefix: '9619', caricomOriginDutyBps: 0, otherOriginDutyBps: 500, vatBps: 0 }];
    expect(matchDutyRule(rules, '961900')?.hsPrefix).toBe('9619');
    expect(matchDutyRule(rules, '210390')?.hsPrefix).toBe('');
    const none = price({ lines: [{ lineTotalMinor: 100n, hsCode: '961900', originIsCaricom: true }], shippingMinor: 0n, feeBps: 500, feePayer: 'BUYER', dutyRules: [] });
    expect(none.dutiesIncomplete).toBe(true);
    expect(none.dutiesEstimateMinor).toBe(0n);
  });
});
