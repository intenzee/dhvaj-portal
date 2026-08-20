import { Badge } from './ui';
import { humanize } from '@/lib/format';

/** Colour a domain status consistently across screens. */
const STATUS_TONE: Record<string, string> = {
  // Engagement lifecycle
  prospect: 'neutral',
  pending_acceptance: 'info',
  accepted: 'info',
  active: 'success',
  on_hold: 'warn',
  completed: 'neutral',
  closed: 'neutral',
  declined: 'danger',
  withdrawn: 'danger',
  cancelled: 'danger',
  // Task
  todo: 'neutral',
  in_progress: 'info',
  blocked: 'warn',
  done: 'success',
  // Client dependency
  pending: 'warn',
  partially_received: 'info',
  received: 'success',
  waived: 'neutral',
};

export function StatusBadge({ status }: { status: string | null | undefined }): JSX.Element {
  if (!status) return <Badge tone="neutral">—</Badge>;
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{humanize(status)}</Badge>;
}
