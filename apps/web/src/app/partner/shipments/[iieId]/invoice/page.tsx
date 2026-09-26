'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { Money } from '@/lib/types';

interface Invoice {
  documentNumber: string;
  iieId: string;
  date: string;
  currency: string;
  exporter: { name: string; phone: string; address: Record<string, string | null> };
  consignee: { name: string; phone: string | null; address: Record<string, string | null> };
  route: { origin: string; destination: string };
  lines: { description: string; sku: string; hsCode: string | null; tariffDescription: string | null; countryOfOrigin: string; countryOfOriginName: string; caricomOrigin: boolean; quantity: number; unitValue: Money; totalValue: Money; netWeightGrams: number }[];
  totals: { goodsValue: Money; freight: Money; declaredWeightGrams: number; parcelWeightGrams: number };
  declaration: string;
}

const address = (a: Record<string, string | null>) => [a.line1, a.line2, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(', ');
const hs = (code: string | null) => (code && code.length >= 6 ? `${code.slice(0, 4)}.${code.slice(4, 6)}${code.length > 6 ? `.${code.slice(6)}` : ''}` : (code ?? '—'));

/** Commercial invoice and packing list, laid out for printing (or saving as PDF from the browser). */
export default function InvoicePage() {
  const { iieId } = useParams<{ iieId: string }>();
  const { data: ci } = useQuery({ queryKey: ['ci', iieId], queryFn: () => api<Invoice>(`/partner/shipments/${iieId}/commercial-invoice`) });
  if (!ci) return <p className="container py-8 text-muted-foreground">Loading…</p>;
  return (
    <section className="container max-w-4xl py-8 text-sm print:max-w-none print:py-0">
      <div className="mb-4 flex gap-2 print:hidden">
        <Button asChild variant="outline" size="sm">
          <Link href={`/partner/shipments/${iieId}`}>Back to shipment</Link>
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </div>
      <header className="flex items-start justify-between border-b pb-3">
        <div>
          <h1 className="text-xl font-bold">Commercial invoice and packing list</h1>
          <p>
            No. {ci.documentNumber} · {new Date(ci.date).toLocaleDateString()}
          </p>
          <p>
            IIE transaction <span className="font-mono">{ci.iieId}</span> · {ci.route.origin} → {ci.route.destination}
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/iie-logo.webp" alt="Inter-Island Exchange" className="h-12 w-auto" />
      </header>
      <div className="grid grid-cols-2 gap-6 border-b py-3">
        <div>
          <p className="font-semibold">Exporter / shipper</p>
          <p>{ci.exporter.name}</p>
          <p>{address(ci.exporter.address)}</p>
          <p>{ci.exporter.phone}</p>
        </div>
        <div>
          <p className="font-semibold">Consignee</p>
          <p>{ci.consignee.name}</p>
          <p>{address(ci.consignee.address)}</p>
          <p>{ci.consignee.phone}</p>
        </div>
      </div>
      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="py-1 pr-2">Description</th>
            <th className="py-1 pr-2">HS code</th>
            <th className="py-1 pr-2">Origin</th>
            <th className="py-1 pr-2 text-right">Qty</th>
            <th className="py-1 pr-2 text-right">Net kg</th>
            <th className="py-1 pr-2 text-right">Unit value</th>
            <th className="py-1 text-right">Total ({ci.currency})</th>
          </tr>
        </thead>
        <tbody>
          {ci.lines.map((l) => (
            <tr key={l.sku} className="border-b align-top">
              <td className="py-1 pr-2">
                {l.description}
                <span className="block text-xs text-muted-foreground">SKU {l.sku}</span>
                {l.tariffDescription && <span className="block text-xs">Tariff: {l.tariffDescription}</span>}
              </td>
              <td className="py-1 pr-2 font-mono">{hs(l.hsCode)}</td>
              <td className="py-1 pr-2">
                {l.countryOfOriginName}
                {l.caricomOrigin && <span className="block text-xs">CARICOM origin</span>}
              </td>
              <td className="py-1 pr-2 text-right">{l.quantity}</td>
              <td className="py-1 pr-2 text-right">{(l.netWeightGrams / 1000).toFixed(2)}</td>
              <td className="py-1 pr-2 text-right">{l.unitValue.formatted}</td>
              <td className="py-1 text-right">{l.totalValue.formatted}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto mt-3 grid w-72 grid-cols-2 gap-1">
        <dt>Goods value</dt>
        <dd className="text-right">{ci.totals.goodsValue.formatted}</dd>
        <dt>Freight</dt>
        <dd className="text-right">{ci.totals.freight.formatted}</dd>
        <dt>Gross weight</dt>
        <dd className="text-right">{(ci.totals.parcelWeightGrams / 1000).toFixed(2)} kg</dd>
      </dl>
      <p className="mt-6 border-t pt-3">{ci.declaration}</p>
      <p className="mt-8">Signature of exporter: ______________________________ Date: ______________</p>
    </section>
  );
}
