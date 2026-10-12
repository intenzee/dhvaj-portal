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

/**
 * What finishing an item is called. A return is lodged and Filed; an Inward
 * reconciliation, a Bookkeeping month-close or an MIS pack ends inside the firm.
 */
export function filingEnd(
  stream: string | null,
  section?: string | null,
): { action: string; done: string; ready: string } {
  if (stream === 'gst' && section === 'inward')
    return { action: 'Mark reconciled', done: 'Reconciled', ready: 'Ready to reconcile' };
  if (stream === 'bookkeeping')
    return { action: 'Close books', done: 'Books closed', ready: 'Ready to close' };
  if (stream === 'mis') return { action: 'Mark sent', done: 'Sent to client', ready: 'Ready to send' };
  return { action: 'Lodge filing', done: 'Filed', ready: 'Ready to file' };
}

/** A status label in the item's own words (Filed → Reconciled, …). */
export function filingStatusLabel(
  status: FilingStatus,
  stream?: string | null,
  section?: string | null,
): string {
  const end = filingEnd(stream ?? null, section);
  if (status === 'filed') return end.done;
  if (status === 'ready_to_file') return end.ready;
  return FILING_STATUS_LABEL[status];
}

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
  stream,
  section,
}: {
  status: FilingStatus;
  isLate?: boolean;
  isOverdue?: boolean;
  stream?: string | null;
  section?: string | null;
}): JSX.Element {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={isOverdue ? 'danger' : TONE[status]}>{filingStatusLabel(status, stream, section)}</Badge>
      {isLate && <Badge tone="warn">{filingEnd(stream ?? null, section).done} late</Badge>}
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
