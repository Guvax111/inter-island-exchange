'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { FormError } from '@/components/forms/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api';

interface Partner {
  id: string;
  kind: 'LOGISTICS' | 'CUSTOMS_BROKER';
  name: string;
  country: string;
  countryName: string;
  contactEmail: string;
  contactPhone: string;
  clearsCustoms: boolean;
  active: boolean;
  lanes: { laneId: string; origin: string; destination: string; active: boolean }[];
  members: { userId: string; email: string; name: string; invitationAccepted: boolean }[];
}
interface AttentionItem {
  iieId: string;
  statusLabel: string;
  logisticsPartner: string | null;
  customsBroker: string | null;
  partnerClearsCustoms: boolean;
  declaredWeightGrams: number;
  actualWeightGrams: number | null;
  issues: string[];
}

const ISSUE_LABELS: Record<string, string> = {
  NO_LOGISTICS_PARTNER: 'No logistics partner',
  NO_CUSTOMS_PARTY: 'No customs broker',
  WEIGHT_OVER_DECLARED: 'Heavier than declared',
  CUSTOMS_HOLD: 'Held by customs',
  PROBLEM_REPORTED: 'Buyer reported a problem',
};

export default function AdminLogisticsPage() {
  const qc = useQueryClient();
  const partners = useQuery({ queryKey: ['partners'], queryFn: () => api<{ items: Partner[] }>('/admin/partners').then((r) => r.items) });
  const attention = useQuery({ queryKey: ['shipments-attention'], queryFn: () => api<{ items: AttentionItem[] }>('/admin/shipments?view=attention').then((r) => r.items) });
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['partners'] });
      await qc.invalidateQueries({ queryKey: ['shipments-attention'] });
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }
  const carriers = partners.data?.filter((p) => p.kind === 'LOGISTICS' && p.active) ?? [];
  const brokers = partners.data?.filter((p) => p.kind === 'CUSTOMS_BROKER' && p.active) ?? [];

  return (
    <div className="space-y-10">
      <FormError message={error} />
      <section>
        <h2 className="text-lg font-semibold">Shipments needing attention</h2>
        <p className="text-sm text-muted-foreground">Unassigned shipments, parcels heavier than declared, customs holds and reported problems.</p>
        {attention.data?.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing needs attention.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shipment</TableHead>
                  <TableHead>Issues</TableHead>
                  <TableHead>Logistics partner</TableHead>
                  <TableHead>Customs broker</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attention.data?.map((s) => (
                  <TableRow key={s.iieId}>
                    <TableCell>
                      <span className="font-mono text-sm font-semibold">{s.iieId}</span>
                      <p className="text-xs text-muted-foreground">{s.statusLabel}</p>
                    </TableCell>
                    <TableCell className="space-x-1">
                      {s.issues.map((i) => (
                        <Badge key={i} variant="secondary">
                          {ISSUE_LABELS[i] ?? i}
                        </Badge>
                      ))}
                      {s.issues.includes('WEIGHT_OVER_DECLARED') && (
                        <p className="mt-1 text-xs">
                          {(s.declaredWeightGrams / 1000).toFixed(2)} kg declared, {((s.actualWeightGrams ?? 0) / 1000).toFixed(2)} kg weighed
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <select
                        aria-label={`Logistics partner for ${s.iieId}`}
                        className="rounded border p-1 text-sm"
                        value={carriers.find((c) => c.name === s.logisticsPartner)?.id ?? ''}
                        onChange={(e) => run(() => api(`/admin/shipments/${s.iieId}`, { method: 'PATCH', body: { logisticsPartnerId: e.target.value || null } }))}
                      >
                        <option value="">— none —</option>
                        {carriers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>
                      {s.partnerClearsCustoms ? (
                        <span className="text-sm text-muted-foreground">Partner clears customs</span>
                      ) : (
                        <select
                          aria-label={`Customs broker for ${s.iieId}`}
                          className="rounded border p-1 text-sm"
                          value={brokers.find((b) => b.name === s.customsBroker)?.id ?? ''}
                          onChange={(e) => run(() => api(`/admin/shipments/${s.iieId}`, { method: 'PATCH', body: { customsBrokerId: e.target.value || null } }))}
                        >
                          <option value="">— none —</option>
                          {brokers.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name} ({b.country})
                            </option>
                          ))}
                        </select>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold">Logistics partners and customs brokers</h2>
        <p className="text-sm text-muted-foreground">
          New shipments go to the active logistics partner serving the lane. If it does not clear customs itself, the active customs broker in the destination country handles customs.
        </p>
        <NewPartnerForm onCreate={(body) => run(() => api('/admin/partners', { method: 'POST', body }))} />
        <div className="mt-4 space-y-4">
          {partners.data?.map((p) => (
            <PartnerCard key={p.id} p={p} run={run} />
          ))}
          {partners.data?.length === 0 && <p className="text-sm text-muted-foreground">No partners yet.</p>}
        </div>
      </section>
    </div>
  );
}

function NewPartnerForm({ onCreate }: { onCreate: (body: object) => Promise<boolean> }) {
  const empty = { kind: 'LOGISTICS', name: '', countryCode: 'LC', contactEmail: '', contactPhone: '', clearsCustoms: false };
  const [f, setF] = useState(empty);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await onCreate(f)) setF(empty);
  }
  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
      <div className="space-y-1">
        <Label htmlFor="p-kind">Type</Label>
        <select id="p-kind" className="w-full rounded border p-2 text-sm" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="LOGISTICS">Logistics partner</option>
          <option value="CUSTOMS_BROKER">Customs broker</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="p-name">Name</Label>
        <Input id="p-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="p-country">Country (2-letter code)</Label>
        <Input id="p-country" value={f.countryCode} maxLength={2} onChange={(e) => setF({ ...f, countryCode: e.target.value.toUpperCase() })} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="p-email">Contact email</Label>
        <Input id="p-email" type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="p-phone">Contact phone</Label>
        <Input id="p-phone" placeholder="+17845551234" value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} required />
      </div>
      {f.kind === 'LOGISTICS' && (
        <label className="flex items-center gap-2 text-sm sm:mt-6">
          <input type="checkbox" checked={f.clearsCustoms} onChange={(e) => setF({ ...f, clearsCustoms: e.target.checked })} />
          Clears customs itself
        </label>
      )}
      <div className="sm:col-span-3">
        <Button type="submit">Add partner</Button>
      </div>
    </form>
  );
}

function PartnerCard({ p, run }: { p: Partner; run: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [lane, setLane] = useState({ origin: 'LC', destination: 'VC' });
  const [invite, setInvite] = useState({ email: '', firstName: '', lastName: '' });
  return (
    <section aria-label={p.name} className={`rounded-lg border p-4 ${p.active ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">
            {p.name} <Badge variant="outline">{p.kind === 'LOGISTICS' ? 'Logistics partner' : 'Customs broker'}</Badge> {!p.active && <Badge variant="secondary">Inactive</Badge>}
          </p>
          <p className="text-sm text-muted-foreground">
            {p.countryName} · {p.contactEmail} · {p.contactPhone}
            {p.kind === 'LOGISTICS' && (p.clearsCustoms ? ' · clears customs itself' : ' · uses a customs broker')}
          </p>
        </div>
        <div className="flex gap-2">
          {p.kind === 'LOGISTICS' && (
            <Button size="sm" variant="outline" onClick={() => run(() => api(`/admin/partners/${p.id}`, { method: 'PATCH', body: { clearsCustoms: !p.clearsCustoms } }))}>
              {p.clearsCustoms ? 'Uses a broker' : 'Clears customs itself'}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => run(() => api(`/admin/partners/${p.id}`, { method: 'PATCH', body: { active: !p.active } }))}>
            {p.active ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      </div>

      {p.kind === 'LOGISTICS' && (
        <div className="mt-3">
          <p className="text-sm font-medium">Lanes</p>
          <ul className="mt-1 flex flex-wrap gap-2 text-sm">
            {p.lanes.filter((l) => l.active).map((l) => (
              <li key={l.laneId} className="flex items-center gap-1 rounded border px-2 py-1">
                {l.origin} → {l.destination}
                <button aria-label={`Remove lane ${l.origin} to ${l.destination}`} className="text-muted-foreground hover:text-destructive" onClick={() => run(() => api(`/admin/partners/${p.id}/lanes/${l.laneId}`, { method: 'DELETE' }))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api(`/admin/partners/${p.id}/lanes`, { method: 'POST', body: lane }));
            }}
          >
            <Input aria-label="Origin country" className="w-16" maxLength={2} value={lane.origin} onChange={(e) => setLane({ ...lane, origin: e.target.value.toUpperCase() })} />
            <span className="pb-2">→</span>
            <Input aria-label="Destination country" className="w-16" maxLength={2} value={lane.destination} onChange={(e) => setLane({ ...lane, destination: e.target.value.toUpperCase() })} />
            <Button size="sm" type="submit" variant="outline">
              Add lane
            </Button>
          </form>
        </div>
      )}

      <div className="mt-3">
        <p className="text-sm font-medium">Team (partner portal access)</p>
        <ul className="mt-1 space-y-1 text-sm">
          {p.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2">
              {m.name} · {m.email} {!m.invitationAccepted && <Badge variant="secondary">Invitation sent</Badge>}
              <button className="text-xs underline" onClick={() => confirm(`Remove ${m.email} from ${p.name}?`) && run(() => api(`/admin/partners/${p.id}/members/${m.userId}`, { method: 'DELETE' }))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api(`/admin/partners/${p.id}/members`, { method: 'POST', body: invite }))) setInvite({ email: '', firstName: '', lastName: '' });
          }}
        >
          <Input aria-label="First name" placeholder="First name" value={invite.firstName} onChange={(e) => setInvite({ ...invite, firstName: e.target.value })} required />
          <Input aria-label="Last name" placeholder="Last name" value={invite.lastName} onChange={(e) => setInvite({ ...invite, lastName: e.target.value })} required />
          <Input aria-label="Email" type="email" placeholder="Email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} required />
          <Button size="sm" type="submit">
            Invite
          </Button>
        </form>
      </div>
    </section>
  );
}
