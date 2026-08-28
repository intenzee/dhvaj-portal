import { Badge } from './ui';
import { humanize } from '@/lib/format';

/** Colour a domain status consistently across screens (matches the style guide). */
const STATUS_TONE: Record<string, string> = {
  // Engagement lifecycle
  prospect: 'neutral',
  pending_acceptance: 'info',
  accepted: 'info',
  active: 'success',
  on_hold: 'warn',
  completed: 'success',
  closed: 'neutral',
  declined: 'danger',
  withdrawn: 'danger',
  cancelled: 'danger',
  // Workflow-ish states seen in "at a glance"
  planning: 'info',
  fieldwork: 'info',
  in_progress: 'info',
  manager_review: 'warn',
  // Task
  todo: 'neutral',
  blocked: 'warn',
  done: 'success',
  // Client dependency
  pending: 'warn',
  partially_received: 'info',
  received: 'success',
  waived: 'neutral',
  // Invoice lifecycle (§31)
  draft: 'neutral',
  issued: 'info',
  paid: 'success',
  void: 'danger',
};

export function StatusBadge({ status }: { status: string | null | undefined }): JSX.Element {
  if (!status) return <Badge tone="neutral">—</Badge>;
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{humanize(status)}</Badge>;
}

const PRIORITY_TONE: Record<string, string> = {
  urgent: 'danger',
  high: 'danger',
  normal: 'info',
  medium: 'warn',
  low: 'success',
};

export function PriorityBadge({ priority }: { priority: string | null | undefined }): JSX.Element {
  if (!priority) return <Badge tone="neutral">—</Badge>;
  return <Badge tone={PRIORITY_TONE[priority] ?? 'neutral'}>{humanize(priority)}</Badge>;
}
