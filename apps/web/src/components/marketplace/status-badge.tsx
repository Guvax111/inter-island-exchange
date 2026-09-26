import { Badge } from '@/components/ui/badge';

const LABELS: Record<string, { label: string; tone: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  DRAFT: { label: 'Draft', tone: 'outline' },
  PENDING_REVIEW: { label: 'In review', tone: 'secondary' },
  UNDER_REVIEW: { label: 'In review', tone: 'secondary' },
  PENDING_VERIFICATION: { label: 'Waiting for email', tone: 'outline' },
  APPROVED: { label: 'Approved', tone: 'secondary' },
  ACTIVE: { label: 'Live', tone: 'default' },
  OUT_OF_STOCK: { label: 'Out of stock', tone: 'secondary' },
  REJECTED: { label: 'Not approved', tone: 'destructive' },
  SUSPENDED: { label: 'Suspended', tone: 'destructive' },
  ARCHIVED: { label: 'Archived', tone: 'outline' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = LABELS[status] ?? { label: status, tone: 'outline' as const };
  return <Badge variant={s.tone}>{s.label}</Badge>;
}
