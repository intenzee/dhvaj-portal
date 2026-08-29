'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  PERMISSION,
  escalationAction,
  type EscalationLevel,
  type Paginated,
} from '@hsdg/contracts';
import { Settings2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { formatDate, deadlineLabel } from '@/lib/format';
import type { ComplianceRow, ComplianceEventRow } from '@/lib/types';
import { PageHeader, Spinner, Card, Badge, Button } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { DataTable } from '@/components/data-table';
import { RollHorizonButton } from '@/components/compliance/roll-horizon-button';
import { EscalationLegend } from '@/components/compliance/escalation-legend';
import { cn } from '@/lib/cn';

type Filter = 'all' | 'overdue' | 'due-soon';
/** Which slice of the calendar is shown: the obligation rows, or the §16 event fan-out. */
type View = 'obligations' | 'events';
/** §22 event-model view — by clock (statutory / internal-SLA) or milestone layers. */
type EventKind = 'all' | 'statutory' | 'internal_sla' | 'layer';

/** Humanise a frozen due-date category code (§2), e.g. STATUTORY_FIXED → "Statutory fixed". */
function humanise(code: string | null): string {
  if (!code) return '';
  const spaced = code.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** An escalation band → badge, sourced from the shared §24 descriptor (tone + label). */
function EscalationBadge({ level }: { level: string }): JSX.Element | null {
  const d = escalationAction(level as EscalationLevel);
  if (d.level === 'none') return null;
  return <Badge tone={d.tone}>{d.label}</Badge>;
}

const KIND_LABEL: Record<Exclude<EventKind, 'all'>, string> = {
  statutory: 'Statutory',
  internal_sla: 'Internal SLA',
  layer: 'Milestone',
};

const columns: ColumnDef<ComplianceRow, unknown>[] = [
  {
    header: 'Engagement',
    cell: ({ row }) => (
      <span>
        <span className="font-medium text-primary-700">{row.original.engagementCode}</span>
        <span className="ml-1 text-ink-faint">· {row.original.entityName}</span>
      </span>
    ),
  },
  { header: 'Obligation', accessorKey: 'complianceRuleName' },
  {
    header: 'Category',
    cell: ({ row }) =>
      row.original.dueDateCategory ? (
        <Badge tone="neutral">{humanise(row.original.dueDateCategory)}</Badge>
      ) : null,
  },
  {
    header: 'Statutory deadline',
    cell: ({ row }) => (
      <span className={row.original.isStatutoryOverdue ? 'font-medium text-rose-600' : ''}>
        {formatDate(row.original.effectiveStatutoryDeadline)}
        <span className="ml-1 text-xs text-ink-faint">
          ({deadlineLabel(row.original.effectiveStatutoryDeadline)})
        </span>
        {row.original.isExtended && (
          <span
            className="ml-1 text-xs font-medium text-sky-700"
            title={
              row.original.revisedStatutoryDeadline
                ? `Government extension applied — revised from ${formatDate(row.original.statutoryDeadline)}`
                : 'Government extension applied'
            }
          >
            · Extended
          </span>
        )}
      </span>
    ),
  },
  {
    header: 'Internal SLA',
    cell: ({ row }) => (
      <span className={row.original.isInternallyOverdue ? 'font-medium text-amber-700' : ''}>
        {formatDate(row.original.effectiveInternalSlaDate)}
      </span>
    ),
  },
  {
    header: 'Escalation',
    cell: ({ row }) => <EscalationBadge level={row.original.escalation} />,
  },
  {
    header: 'Flags',
    cell: ({ row }) => (
      <div className="flex gap-1">
        {row.original.isInternallyOverdue && <Badge tone="warn">SLA overdue</Badge>}
      </div>
    ),
  },
  { header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
];

/** The §16 event fan-out columns — each obligation's statutory/SLA/milestone rows. */
const eventColumns: ColumnDef<ComplianceEventRow, unknown>[] = [
  {
    header: 'Due',
    cell: ({ row }) => (
      <span className={row.original.isOverdue ? 'font-medium text-rose-600' : ''}>
        {formatDate(row.original.dueDate)}
        <span className="ml-1 text-xs text-ink-faint">
          ({deadlineLabel(row.original.dueDate)})
        </span>
      </span>
    ),
  },
  {
    header: 'Kind',
    cell: ({ row }) => (
      <Badge tone={row.original.kind === 'statutory' ? 'info' : 'neutral'}>
        {KIND_LABEL[row.original.kind]}
        {row.original.isExtended && <span className="ml-1 text-sky-700">· Ext</span>}
      </Badge>
    ),
  },
  {
    header: 'Engagement',
    cell: ({ row }) => (
      <span>
        <span className="font-medium text-primary-700">{row.original.engagementCode}</span>
        <span className="ml-1 text-ink-faint">· {row.original.entityName}</span>
      </span>
    ),
  },
  {
    header: 'Event',
    cell: ({ row }) => (
      <span>
        {row.original.label}
        <span className="ml-1 text-xs text-ink-faint">· {row.original.serviceCode}</span>
      </span>
    ),
  },
  {
    header: 'Owner',
    cell: ({ row }) => row.original.ownerName ?? <span className="text-ink-faint">—</span>,
  },
  {
    header: 'Escalation',
    cell: ({ row }) => <EscalationBadge level={row.original.escalation} />,
  },
  { header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
];

function inNextDays(iso: string, days: number): boolean {
  const d = new Date(iso).getTime();
  const now = Date.now();
  return d >= now - 86_400_000 && d <= now + days * 86_400_000;
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition',
            value === key
              ? 'border-primary-600 bg-primary-600 text-white'
              : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-raised',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ComplianceInner(): JSX.Element {
  const params = useSearchParams();
  const router = useRouter();
  const { principal } = useAuth();
  const initial: Filter =
    params.get('filter') === 'overdue'
      ? 'overdue'
      : params.get('filter') === 'due-soon'
        ? 'due-soon'
        : 'all';
  const [view, setView] = useState<View>('obligations');
  const [filter, setFilter] = useState<Filter>(initial);
  const [kind, setKind] = useState<EventKind>('all');

  const obligations = useQuery({
    queryKey: ['compliance', 'calendar'],
    queryFn: () => apiFetch<Paginated<ComplianceRow>>('/compliance?status=open&limit=100'),
    enabled: view === 'obligations',
  });

  const events = useQuery({
    queryKey: ['compliance', 'events', kind],
    queryFn: () =>
      apiFetch<Paginated<ComplianceEventRow>>(
        `/compliance/events?openOnly=true&limit=100${kind === 'all' ? '' : `&kind=${kind}`}`,
      ),
    enabled: view === 'events',
  });

  const rows = (obligations.data?.items ?? []).filter((r) => {
    if (filter === 'overdue') return r.isStatutoryOverdue;
    if (filter === 'due-soon')
      return !r.isStatutoryOverdue && inNextDays(r.effectiveStatutoryDeadline, 7);
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Compliance Calendar"
        subtitle="Open obligations across your engagements. Two clocks: statutory vs internal SLA, each with its own deadline events (§16)."
        actions={
          <div className="flex flex-wrap gap-2">
            {can(principal, PERMISSION.engagementManage) && <RollHorizonButton />}
            {can(principal, PERMISSION.complianceManage) && (
              <Link href="/compliance/rules">
                <Button variant="secondary">
                  <Settings2 className="h-4 w-4" /> Configure rules
                </Button>
              </Link>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          options={
            [
              ['obligations', 'Obligations'],
              ['events', 'Deadline events'],
            ] as const
          }
          value={view}
          onChange={setView}
        />
        {view === 'obligations' ? (
          <Segmented
            options={
              [
                ['all', 'All open'],
                ['overdue', 'Statutory overdue'],
                ['due-soon', 'Due soon (7d)'],
              ] as const
            }
            value={filter}
            onChange={setFilter}
          />
        ) : (
          <Segmented
            options={
              [
                ['all', 'All clocks'],
                ['statutory', 'Statutory'],
                ['internal_sla', 'Internal SLA'],
                ['layer', 'Milestones'],
              ] as const
            }
            value={kind}
            onChange={setKind}
          />
        )}
      </div>

      <div className="mb-4">
        <EscalationLegend />
      </div>

      <Card className="p-0">
        {view === 'obligations' ? (
          <>
            {obligations.isLoading && (
              <div className="p-4">
                <Spinner />
              </div>
            )}
            {obligations.data && (
              <DataTable
                columns={columns}
                data={rows}
                empty="No obligations match this filter."
                onRowClick={(row) => router.push(`/engagements/${row.engagementId}`)}
              />
            )}
          </>
        ) : (
          <>
            {events.isLoading && (
              <div className="p-4">
                <Spinner />
              </div>
            )}
            {events.data && (
              <DataTable
                columns={eventColumns}
                data={events.data.items}
                empty="No deadline events match this view."
                onRowClick={(row) => router.push(`/engagements/${row.engagementId}`)}
              />
            )}
          </>
        )}
      </Card>
    </div>
  );
}

export default function CompliancePage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <ComplianceInner />
    </Suspense>
  );
}
