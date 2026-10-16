'use client';

import type { ColumnDef } from '@tanstack/react-table';
import {
  NOTICE_STATUS_LABEL,
  noticeTypeLabel,
  type NoticeClock,
  type NoticeListItem,
  type NoticeStatus,
} from '@hsdg/contracts';
import { formatMoney } from '@/lib/format';
import { clockBadge, type ClockTone } from '@/lib/notices';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui';

const CLOCK_TONE: Record<ClockTone, string> = {
  danger: 'border-danger-500/40 bg-danger-50 text-danger-700',
  warn: 'border-warning-500/40 bg-warning-50 text-warning-700',
  info: 'border-primary-200 bg-primary-50 text-primary-700',
  neutral: 'border-line-strong bg-surface-sunken text-ink-muted',
};

/** "Reply due · 23 Oct 2026 · 7 days left" — red when overdue. */
export function NoticeClockBadge({
  clock,
  className,
}: {
  clock: NoticeClock | null | undefined;
  className?: string;
}): JSX.Element {
  const m = clockBadge(clock);
  if (!m) return <span className="text-ink-faint">No date running</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium',
        CLOCK_TONE[m.tone],
        className,
      )}
      title={`${m.label} ${m.date}`}
    >
      <span className="font-semibold">{m.label}</span>
      <span>· {m.date}</span>
      <span>· {m.left}</span>
    </span>
  );
}

const STATUS_TONE: Record<NoticeStatus, string> = {
  received: 'warn',
  in_progress: 'info',
  reply_filed: 'info',
  hearing_scheduled: 'warn',
  order_received: 'danger',
  appealed: 'neutral',
  closed: 'success',
  withdrawn: 'neutral',
};

export function NoticeStatusBadge({ status }: { status: NoticeStatus }): JSX.Element {
  return <Badge tone={STATUS_TONE[status]}>{NOTICE_STATUS_LABEL[status] ?? status}</Badge>;
}

/** ₹ in the Indian grouping, or a dash. */
export function money(amount: string | null | undefined): string {
  return amount == null || amount === '' ? '—' : formatMoney(amount);
}

/** The notice list's columns (the /notices page, My Work's Notices tab, the report). */
export function noticeColumns(
  opts: { owner?: boolean } = {},
): ColumnDef<NoticeListItem, unknown>[] {
  return [
    {
      header: 'Client',
      cell: ({ row }) => (
        <span>
          {row.original.entityName}
          <span className="ml-1 text-xs font-normal text-ink-faint">
            {row.original.engagementCode}
          </span>
        </span>
      ),
    },
    {
      header: 'Notice',
      cell: ({ row }) => (
        <span className="text-ink" title={row.original.noticeType.code}>
          {noticeTypeLabel(row.original.noticeType)}
        </span>
      ),
    },
    {
      header: 'Reference',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.referenceNo}</span>,
    },
    { header: 'Clock', cell: ({ row }) => <NoticeClockBadge clock={row.original.clock} /> },
    {
      header: 'Amount',
      cell: ({ row }) => <span className="tabular-nums">{money(row.original.amountDemanded)}</span>,
    },
    ...(opts.owner === false
      ? []
      : ([{ header: 'Owner', cell: ({ row }) => row.original.ownerName }] as ColumnDef<
          NoticeListItem,
          unknown
        >[])),
    { header: 'Status', cell: ({ row }) => <NoticeStatusBadge status={row.original.status} /> },
  ];
}

export const noticeHref = (n: { id: string }): string => `/notices/${n.id}`;
