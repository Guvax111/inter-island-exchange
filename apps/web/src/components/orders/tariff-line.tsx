import type { OrderDetail } from '@/lib/types';

const hs = (code: string | null) => (code && code.length >= 6 ? `${code.slice(0, 4)}.${code.slice(4, 6)}${code.length > 6 ? `.${code.slice(6)}` : ''}` : (code ?? ''));

/** The tariff line used for an item's duty estimate at checkout. */
export function TariffLine({ tariff }: { tariff: OrderDetail['items'][number]['tariff'] }) {
  if (!tariff) return null;
  return (
    <span className="block text-xs text-muted-foreground">
      HS {hs(tariff.hsCode)} · {tariff.description}
      {tariff.dutyPercent != null && ` · duty ${tariff.dutyPercent}%`}
      {tariff.vatPercent != null && ` · VAT ${tariff.vatPercent}%`}
      {tariff.source && ` (${tariff.source})`}
    </span>
  );
}
