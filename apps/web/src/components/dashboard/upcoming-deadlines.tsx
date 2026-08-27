'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { openComplianceQuery } from '@/lib/queries';
import { daysUntil, deadlineLabel } from '@/lib/format';
import type { ComplianceRow } from '@/lib/types';
import { Panel, Spinner, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function labelTone(iso: string): string {
  const d = daysUntil(iso);
  if (d === null) return 'text-ink-faint';
  if (d < 0) return 'text-danger-600';
  if (d <= 3) return 'text-warning-600';
  return 'text-success-600';
}

export function UpcomingDeadlinesPanel(): JSX.Element {
  const router = useRouter();
  const q = useQuery(openComplianceQuery);
  const rows: ComplianceRow[] = [...(q.data?.items ?? [])]
    .sort(
      (a, b) =>
        new Date(a.effectiveStatutoryDeadline).getTime() -
        new Date(b.effectiveStatutoryDeadline).getTime(),
    )
    .slice(0, 5);

  return (
    <Panel title="Upcoming Deadlines" linkHref="/compliance" linkLabel="View calendar" bodyClassName="p-0">
      {q.isLoading && <div className="p-5"><Spinner /></div>}
      {q.data && rows.length === 0 && (
        <div className="p-5"><EmptyState>No open obligations in your scope.</EmptyState></div>
      )}
      <ul>
        {rows.map((r) => {
          const d = new Date(r.effectiveStatutoryDeadline);
          return (
            <li
              key={r.id}
              onClick={() => router.push(`/engagements/${r.engagementId}`)}
              className="flex cursor-pointer items-center gap-3 border-b border-line px-5 py-3 last:border-0 hover:bg-surface-raised"
            >
              <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-surface-sunken leading-none">
                <span className="text-[10px] font-semibold uppercase text-ink-faint">
                  {MONTHS[d.getMonth()]}
                </span>
                <span className="text-base font-bold text-ink">{d.getDate()}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{r.complianceRuleName}</div>
                <div className="truncate text-xs text-ink-faint">
                  {r.engagementCode} · {r.entityName}
                </div>
              </div>
              <div className={cn('shrink-0 text-xs font-semibold', labelTone(r.effectiveStatutoryDeadline))}>
                {deadlineLabel(r.effectiveStatutoryDeadline)}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
