'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { myEngagementRole, servicesLabel, type EngagementRow } from '@/lib/types';
import { Panel, Spinner, EmptyState, Badge } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { SectionSelect, useStoredSections } from '@/components/section-filter';
import { engagementListPath, myEngagementsHref } from '@/lib/list-paths';

export function MyEngagementsPanel(): JSX.Element {
  const { principal } = useAuth();
  const router = useRouter();
  const [sections, setSections] = useStoredSections('home-engagements');
  const q = useQuery({
    queryKey: ['engagements', 'mine', 'glance', sections],
    queryFn: () =>
      apiFetch<Paginated<EngagementRow>>(
        engagementListPath({ limit: 8, offset: 0, mine: true, sections }),
      ),
  });

  return (
    <Panel
      title="My Engagements — At a Glance"
      linkHref={myEngagementsHref(sections)}
      toolbar={<SectionSelect value={sections} onChange={setSections} />}
      bodyClassName="p-0"
    >
      {q.isLoading && (
        <div className="p-5">
          <Spinner />
        </div>
      )}
      {q.data && q.data.items.length === 0 && (
        <div className="p-5">
          <EmptyState>
            {sections.length
              ? 'None of your engagements are in this section.'
              : 'No engagements assigned to you.'}
          </EmptyState>
        </div>
      )}
      {q.data && q.data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="px-5 py-2 font-semibold">Entity / Engagement</th>
                <th className="px-3 py-2 font-semibold">Service</th>
                <th className="px-3 py-2 font-semibold">FY / Period</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Due Date</th>
                <th className="px-5 py-2 font-semibold">Role</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => router.push(`/engagements/${e.id}`)}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-raised"
                >
                  <td className="px-5 py-2.5">
                    <div className="font-medium text-ink">{e.entityName}</div>
                    <div className="text-xs text-ink-faint">{e.engagementCode}</div>
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{servicesLabel(e)}</td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {e.financialYear} {e.periodLabel !== 'FY' ? e.periodLabel : ''}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{formatDate(e.plannedEndDate)}</td>
                  <td className="px-5 py-2.5">
                    <Badge tone="neutral">
                      {myEngagementRole(e, principal?.employeeId ?? null)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
