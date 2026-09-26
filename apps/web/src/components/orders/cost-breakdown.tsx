import type { Money } from '@/lib/types';

interface Props {
  productCost: Money;
  shipping: Money & { isPlaceholder?: boolean };
  platformFee: Money & { percent: number; payer: 'BUYER' | 'SELLER'; chargedToBuyer: Money };
  otherFees: Money;
  dutiesEstimate: Money;
  total: Money;
  estimatedLandedTotal?: Money;
  sellerPayout?: Money;
}

/** PRODUCT COST + SHIPPING + PLATFORM FEE + OTHER FEES = TOTAL, with estimated duties shown separately. */
export function CostBreakdown(p: Props) {
  const row = (label: string, value: string, note?: string) => (
    <div className="flex justify-between gap-4 py-1.5">
      <dt>
        {label}
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
      </dt>
      <dd className="whitespace-nowrap font-medium">{value}</dd>
    </div>
  );
  return (
    <dl className="text-sm">
      {row('Product cost', p.productCost.formatted)}
      {row('Shipping', p.shipping.formatted, p.shipping.isPlaceholder ? 'Provisional pilot rate' : undefined)}
      {p.platformFee.payer === 'BUYER'
        ? row(`IIE platform fee (${p.platformFee.percent}%)`, p.platformFee.chargedToBuyer.formatted)
        : row('IIE platform fee', 'Paid by the seller')}
      {p.otherFees.amountMinor !== '0' && row('Other fees', p.otherFees.formatted)}
      <div className="mt-1 flex justify-between gap-4 border-t pt-2 text-base font-bold text-ocean-900">
        <dt>Total to pay</dt>
        <dd>
          {p.total.formatted} <span className="text-xs font-normal text-muted-foreground">{p.total.currency}</span>
        </dd>
      </div>
      <div className="mt-3 rounded-md bg-muted p-3">
        {row('Estimated duties and taxes', p.dutiesEstimate.formatted, 'Paid to customs when the parcel arrives. Customs sets the final amount.')}
        {p.estimatedLandedTotal && row('Estimated total including duties', p.estimatedLandedTotal.formatted)}
      </div>
      {p.sellerPayout && (
        <div className="mt-3 flex justify-between gap-4 rounded-md border p-3">
          <dt>Seller receives on completion</dt>
          <dd className="font-semibold">{p.sellerPayout.formatted}</dd>
        </div>
      )}
    </dl>
  );
}
