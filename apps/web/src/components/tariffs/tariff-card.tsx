import type { TariffResolution } from '@/lib/types';

export const formatHs = (code: string) => (code.length >= 6 ? `${code.slice(0, 4)}.${code.slice(4, 6)}${code.length > 6 ? `.${code.slice(6)}` : ''}` : code.length === 4 ? `${code.slice(0, 2)}.${code.slice(2)}` : code);
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

/**
 * What applies when a product is imported into a country: HS description, duty (CARICOM and other origins, and the
 * one for this product when its origin is known), VAT, restrictions, and where the figures come from.
 */
export function TariffCard({ t, originName }: { t: TariffResolution; originName?: string }) {
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <p className="font-medium">
        Importing into {t.country.name}
        {t.restriction === 'PROHIBITED' && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">Prohibited import</span>}
        {t.restriction === 'LICENCE_REQUIRED' && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">Import licence required</span>}
      </p>
      {t.description && (
        <p>
          <span className="font-mono">HS {formatHs(t.matchedHsCode)}</span> · {t.description}
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {t.applicableDutyPercent !== null && (
          <>
            <dt className="text-muted-foreground">Duty{originName ? ` (made in ${originName})` : ''}</dt>
            <dd className="font-semibold">{pct(t.applicableDutyPercent)}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Duty, CARICOM origin</dt>
        <dd>{pct(t.caricomDutyPercent)}</dd>
        <dt className="text-muted-foreground">Duty, other origin</dt>
        <dd>
          {pct(t.generalDutyPercent)}
          {t.rateText && <span className="text-muted-foreground"> ({t.rateText})</span>}
        </dd>
        <dt className="text-muted-foreground">VAT</dt>
        <dd>{pct(t.vatPercent)}</dd>
      </dl>
      {t.varies && <p className="text-xs text-amber-900">Rates vary within this heading; the highest is shown. A more specific HS code gives the exact rate.</p>}
      {t.notes && <p className="text-xs text-muted-foreground">{t.notes}</p>}
      <p className="text-xs text-muted-foreground">
        {t.source.kind === 'TARIFF_SCHEDULE'
          ? `Source: ${t.source.name} (${t.source.publisher}), in force from ${new Date(t.source.effectiveFrom).toLocaleDateString()}.`
          : `IIE estimate${t.source.isPlaceholder ? ' (provisional)' : ''}: no tariff schedule for ${t.country.name} has been published on IIE yet.`}{' '}
        Duties and taxes are paid by the buyer on arrival; customs sets the final amount.
      </p>
    </div>
  );
}
