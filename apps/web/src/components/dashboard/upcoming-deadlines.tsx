'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  FEATURE_FLAG,
  FILING_STATUSES,
  STREAM_SECTIONS,
  WORK_SECTION_LABEL,
  workSectionsParam,
  type ComplianceCalendarResponse,
  type WorkSection,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { openComplianceQuery } from '@/lib/queries';
import { useFeatureFlags } from '@/lib/feature-flags';
import { daysUntil, deadlineLabel } from '@/lib/format';
import type { ComplianceRow } from '@/lib/types';
import { Panel, Spinner, EmptyState } from '@/components/ui';
import { SectionSelect, useStoredSections } from '@/components/section-filter';
import { useCalendarHref } from '@/components/compliance/firm-calendar';
import { useWorkHref } from '@/lib/work-href';
import { cn } from '@/lib/cn';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const OPEN_STATUSES = FILING_STATUSES.filter((s) => s !== 'filed' && s !== 'not_applicable');

function labelTone(iso: string): string {
  const d = daysUntil(iso);
  if (d === null) return 'text-ink-faint';
  if (d < 0) return 'text-danger-600';
  if (d <= 3) return 'text-warning-600';
  return 'text-success-600';
}

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Open filings due from today to 90 days on, plus everything overdue. Pure. */
export function upcomingPath(today: Date, sections: readonly WorkSection[]): string {
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 90);
  const stream = workSectionsParam(sections);
  return (
    `/compliance/calendar?from=${iso(today)}&to=${iso(to)}&status=${OPEN_STATUSES.join(',')}` +
    (stream ? `&stream=${stream}` : '')
  );
}

interface Item {
  id: string;
  due: string;
  title: string;
  sub: string;
  href: string;
}

export function UpcomingDeadlinesPanel(): JSX.Element {
  const { isOn, isLoading } = useFeatureFlags();
  const v2 = isOn(FEATURE_FLAG.calendarV2);
  const calendarHref = useCalendarHref();
  const workHref = useWorkHref();
  const [sections, setSections] = useStoredSections('home-deadlines', STREAM_SECTIONS);
  const stream = workSectionsParam(sections);

  const legacy = useQuery({ ...openComplianceQuery, enabled: !isLoading && !v2 });
  const calendar = useQuery({
    queryKey: ['compliance', 'calendar-v2', 'home-deadlines', stream],
    queryFn: () => apiFetch<ComplianceCalendarResponse>(upcomingPath(new Date(), sections)),
    enabled: !isLoading && v2,
  });
  const q = v2 ? calendar : legacy;

  const items: Item[] = v2
    ? (calendar.data?.items ?? []).slice(0, 5).map((r) => ({
        id: r.id,
        due: r.dueDate,
        title: r.formLabel ?? r.ruleName,
        sub: `${sections.length !== 1 && r.stream ? `${WORK_SECTION_LABEL[r.stream]} · ` : ''}${r.entityName}`,
        href: calendarHref(r),
      }))
    : [...(legacy.data?.items ?? [])]
        .sort(
          (a: ComplianceRow, b: ComplianceRow) =>
            new Date(a.effectiveStatutoryDeadline).getTime() -
            new Date(b.effectiveStatutoryDeadline).getTime(),
        )
        .slice(0, 5)
        .map((r) => ({
          id: r.id,
          due: r.effectiveStatutoryDeadline,
          title: r.complianceRuleName,
          sub: `${r.engagementCode} · ${r.entityName}`,
          href: workHref(r),
        }));

  return (
    <Panel
      title="Upcoming Deadlines"
      linkHref={v2 && stream ? `/compliance?stream=${stream}` : '/compliance'}
      linkLabel="View calendar"
      bodyClassName="p-0"
      toolbar={
        v2 ? (
          <SectionSelect value={sections} onChange={setSections} sections={STREAM_SECTIONS} />
        ) : undefined
      }
    >
      {(isLoading || q.isLoading) && (
        <div className="p-5">
          <Spinner />
        </div>
      )}
      {q.data && items.length === 0 && (
        <div className="p-5">
          <EmptyState>
            {v2 && sections.length === 1
              ? `No open ${WORK_SECTION_LABEL[sections[0]!]} filings due.`
              : 'No open obligations in your scope.'}
          </EmptyState>
        </div>
      )}
      <ul>
        {items.map((r) => (
          <DeadlineRow key={r.id} item={r} />
        ))}
      </ul>
    </Panel>
  );
}

function DeadlineRow({ item }: { item: Item }): JSX.Element {
  const router = useRouter();
  const d = new Date(item.due);
  return (
    <li
      onClick={() => router.push(item.href)}
      className="flex cursor-pointer items-center gap-3 border-b border-line px-5 py-3 last:border-0 hover:bg-surface-raised"
    >
      <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-surface-sunken leading-none">
        <span className="text-[10px] font-semibold uppercase text-ink-faint">
          {MONTHS[d.getMonth()]}
        </span>
        <span className="text-base font-bold text-ink">{d.getDate()}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{item.title}</div>
        <div className="truncate text-xs text-ink-faint">{item.sub}</div>
      </div>
      <div className={cn('shrink-0 text-xs font-semibold', labelTone(item.due))}>
        {deadlineLabel(item.due)}
      </div>
    </li>
  );
}
