import type { FilingStatus } from '@hsdg/contracts';
import { Badge } from '@/components/ui';

export const FILING_STATUS_LABEL: Record<FilingStatus, string> = {
  not_started: 'Not started',
  awaiting_data: 'Awaiting data',
  in_preparation: 'In preparation',
  in_review: 'In review',
  ready_to_file: 'Ready to file',
  filed: 'Filed',
  not_applicable: 'Not applicable',
};

const TONE: Record<FilingStatus, string> = {
  not_started: 'neutral',
  awaiting_data: 'warn',
  in_preparation: 'info',
  in_review: 'info',
  ready_to_file: 'success',
  filed: 'success',
  not_applicable: 'neutral',
};

export function FilingStatusBadge({
  status,
  isLate,
  isOverdue,
}: {
  status: FilingStatus;
  isLate?: boolean;
  isOverdue?: boolean;
}): JSX.Element {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={isOverdue ? 'danger' : TONE[status]}>{FILING_STATUS_LABEL[status]}</Badge>
      {isLate && <Badge tone="warn">Filed late</Badge>}
    </span>
  );
}

/** Days-left colour for due dates (Overview and the trees). */
export function dueTone(daysLeft: number): string {
  if (daysLeft < 0) return 'text-danger-700 font-semibold';
  if (daysLeft <= 3) return 'text-danger-600';
  if (daysLeft <= 7) return 'text-warning-700';
  return 'text-ink-muted';
}

export function daysLeftText(daysLeft: number): string {
  if (daysLeft === 0) return 'due today';
  if (daysLeft < 0) return `${-daysLeft} day${daysLeft === -1 ? '' : 's'} overdue`;
  return `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
}
