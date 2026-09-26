import type { ShipmentView } from '@/lib/types';

const kg = (g: number) => `${(g / 1000).toFixed(2)} kg`;
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** Tracking history, partners, customs and proof of delivery for one shipment. */
export function ShipmentPanel({ shipment, showWeights = false }: { shipment: ShipmentView; showWeights?: boolean }) {
  const pod = shipment.proofOfDelivery;
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Logistics partner</dt>
        <dd>{shipment.logisticsPartner ? shipment.logisticsPartner.name : <span className="text-muted-foreground">Being arranged by IIE</span>}</dd>
        <dt className="text-muted-foreground">Customs</dt>
        <dd>
          {shipment.customsBroker
            ? shipment.customsBroker.name
            : shipment.logisticsPartner?.clearsCustoms
              ? `${shipment.logisticsPartner.name} (clears customs itself)`
              : <span className="text-muted-foreground">Being arranged by IIE</span>}
        </dd>
        {shipment.trackingReference && (
          <>
            <dt className="text-muted-foreground">Partner reference</dt>
            <dd className="font-mono">{shipment.trackingReference}</dd>
          </>
        )}
        {shipment.pickupScheduledFor && !shipment.pickedUpAt && (
          <>
            <dt className="text-muted-foreground">Pickup</dt>
            <dd>{when(shipment.pickupScheduledFor)}</dd>
          </>
        )}
        {shipment.customs.dutiesAssessed && (
          <>
            <dt className="text-muted-foreground">Duties and taxes</dt>
            <dd>
              <strong>{shipment.customs.dutiesAssessed.formatted}</strong> assessed by customs, paid on arrival
              {shipment.customs.entryNumber && <span className="text-muted-foreground"> (entry {shipment.customs.entryNumber})</span>}
            </dd>
          </>
        )}
        {showWeights && shipment.weights && (
          <>
            <dt className="text-muted-foreground">Weight</dt>
            <dd>
              declared {kg(shipment.weights.declaredGrams)} · packed {kg(shipment.weights.parcelGrams)}
              {shipment.weights.actualGrams != null && <> · weighed {kg(shipment.weights.actualGrams)}</>}
              {shipment.weights.flagged && <span className="ml-1 font-semibold text-red-700">over the declared weight</span>}
            </dd>
          </>
        )}
      </dl>

      {pod && (
        <div className="rounded-lg border bg-green-50 p-3">
          <p className="font-semibold">
            Received by {pod.recipientName} on {when(pod.deliveredAt)}
          </p>
          {pod.note && <p className="mt-1">{pod.note}</p>}
          {(pod.photoUrl || pod.signatureUrl) && (
            <div className="mt-2 flex flex-wrap gap-3">
              {pod.photoUrl && (
                <a href={pod.photoUrl} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pod.photoUrl} alt="Delivery photo" className="h-28 w-auto rounded border object-cover" />
                </a>
              )}
              {pod.signatureUrl && (
                <a href={pod.signatureUrl} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pod.signatureUrl} alt="Recipient’s signature" className="h-28 w-auto rounded border bg-white" />
                </a>
              )}
            </div>
          )}
        </div>
      )}

      <ol className="space-y-2 border-l-2 border-ocean-100 pl-4">
        {[...shipment.events].reverse().map((e, i) => (
          <li key={`${e.step}-${e.at}`} className={i === 0 ? 'font-medium' : 'text-muted-foreground'}>
            <span>{e.label}</span>
            {e.location && <span> · {e.location}</span>}
            <span className="block text-xs font-normal text-muted-foreground">
              {when(e.at)}
              {e.actorType && ` · ${e.actorType.toLowerCase()}`}
            </span>
            {e.note && <span className="block text-xs font-normal">{e.note}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
