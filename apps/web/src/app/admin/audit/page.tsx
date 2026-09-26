'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const { data, error } = useQuery({
    queryKey: ['audit', page],
    queryFn: () => api<{ items: AuditRow[]; total: number }>(`/admin/audit-logs?page=${page}&pageSize=50`),
  });
  if (error) return <p className="text-destructive">{errorMessage(error)}</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Every security, account and administrative change. Entries cannot be edited or deleted.</p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-xs">{new Date(row.createdAt).toLocaleString()}</TableCell>
                <TableCell className="font-mono text-xs">{row.action}</TableCell>
                <TableCell className="text-xs">{row.entityType}<br /><span className="text-muted-foreground">{row.entityId}</span></TableCell>
                <TableCell className="text-xs">{row.actorUserId ?? 'system'}<br /><span className="text-muted-foreground">{row.ip}</span></TableCell>
                <TableCell className="max-w-xs text-xs">
                  {row.before != null && <pre className="whitespace-pre-wrap text-muted-foreground">- {JSON.stringify(row.before)}</pre>}
                  {row.after != null && <pre className="whitespace-pre-wrap">+ {JSON.stringify(row.after)}</pre>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button>
        <Button size="sm" variant="outline" disabled={(data?.items.length ?? 0) < 50} onClick={() => setPage(page + 1)}>Older</Button>
      </div>
    </div>
  );
}
