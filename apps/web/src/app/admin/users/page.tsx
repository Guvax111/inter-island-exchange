'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ACCOUNT_STATUSES } from '@iie/shared';
import { FormError } from '@/components/forms/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api';

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  emailVerified: boolean;
  country: string;
  roles: string[];
  createdAt: string;
}

export default function AdminUsersPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [acting, setActing] = useState<{ user: UserRow; action: 'suspend' | 'reactivate' } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams({ page: String(page), pageSize: '25', ...(q && { q }), ...(status && { status }) });
  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', params.toString()],
    queryFn: () => api<{ items: UserRow[]; total: number }>(`/admin/users?${params}`),
  });

  async function confirm() {
    if (!acting) return;
    setError(null);
    try {
      await api(`/admin/users/${acting.user.id}/${acting.action}`, { method: 'POST', body: { reason } });
      setActing(null);
      setReason('');
      await qc.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 25));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Search name or email" aria-label="Search users" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="sm:max-w-xs" />
        <select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-10 rounded-md border border-input px-3 text-sm">
          <option value="">All statuses</option>
          {ACCOUNT_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      {acting && (
        <div className="space-y-2 rounded-lg border p-4">
          <p className="font-medium">
            {acting.action === 'suspend' ? 'Suspend' : 'Reactivate'} {acting.user.email}
          </p>
          <FormError message={error} />
          <Input placeholder="Reason (required, recorded in the audit log)" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" variant={acting.action === 'suspend' ? 'destructive' : 'default'} disabled={reason.trim().length < 3} onClick={confirm}>
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setActing(null)}>Cancel</Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={5}>Loading…</TableCell></TableRow>
            )}
            {data?.items.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <p className="font-medium">{u.firstName} {u.lastName}</p>
                  <p className="text-xs text-muted-foreground">{u.email}{u.emailVerified ? '' : ' · email not confirmed'}</p>
                </TableCell>
                <TableCell>{u.country}</TableCell>
                <TableCell className="text-xs">{u.roles.join(', ')}</TableCell>
                <TableCell><Badge variant={u.status === 'SUSPENDED' ? 'destructive' : 'secondary'}>{u.status}</Badge></TableCell>
                <TableCell className="text-right">
                  {u.status === 'SUSPENDED' ? (
                    <Button size="sm" variant="outline" onClick={() => setActing({ user: u, action: 'reactivate' })}>Reactivate</Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setActing({ user: u, action: 'suspend' })}>Suspend</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span>{data?.total ?? 0} users</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="self-center">Page {page} of {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}
