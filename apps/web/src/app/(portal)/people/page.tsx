'use client';

import { useState } from 'react';
import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { GRADE, PERMISSION, type GradeSlug, type PeopleDesk } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, type Principal } from '@/lib/principal';
import { QUEUE_LABEL } from '@/lib/people';
import { formatDate } from '@/lib/format';
import { PeopleSubnav, Tile } from '@/components/people/people-subnav';
import { NewJoinerModal } from '@/components/people/new-joiner-modal';
import { Badge, Button, EmptyState, PageHeader, Panel, Spinner } from '@/components/ui';

function mayOnboard(principal: Principal | null): boolean {
  return (
    can(principal, PERMISSION.employeeManage) &&
    (can(principal, PERMISSION.userOnboard) || can(principal, PERMISSION.userManage))
  );
}

const GRADE_ORDER: GradeSlug[] = [GRADE.partner, GRADE.manager, GRADE.senior, GRADE.article];
const GRADE_SHORT: Record<GradeSlug, string> = {
  partner: 'Partners',
  manager: 'Managers',
  senior: 'Seniors',
  article: 'Articles',
};

/** The HR desk (spec §4.4): headcount, the "needs action" queues, load this week. */
export default function PeopleDeskPage(): JSX.Element {
  const { principal } = useAuth();
  const allowed = can(principal, PERMISSION.employeeManage);
  const [joining, setJoining] = useState(false);
  const desk = useQuery({
    queryKey: ['people', 'desk'],
    queryFn: () => apiFetch<PeopleDesk>('/people/desk'),
    enabled: allowed,
  });

  if (!allowed) {
    return (
      <div>
        <PageHeader title="People" />
        <EmptyState>You don’t have access to the People desk.</EmptyState>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="People"
        subtitle="The firm’s people: who is here, who needs something done, and how loaded they are. Never client work."
        actions={
          mayOnboard(principal) ? (
            <Button size="sm" onClick={() => setJoining(true)}>
              <UserPlus className="h-4 w-4" /> New joiner
            </Button>
          ) : undefined
        }
      />
      <PeopleSubnav />
      {desk.isLoading && <Spinner label="Loading the desk…" />}
      {desk.isError && <EmptyState>Could not load the desk.</EmptyState>}
      {desk.data && <Desk desk={desk.data} />}
      {joining && <NewJoinerModal onClose={() => setJoining(false)} />}
    </div>
  );
}

function Desk({ desk }: { desk: PeopleDesk }): JSX.Element {
  const needsAction = desk.queues.filter((q) => q.count > 0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Headcount" value={desk.headcount} />
        <Tile label="Articles" value={desk.articles} />
        <Tile label="Joined this month" value={desk.joinedThisMonth} tone="success" />
        <Tile label="On notice" value={desk.onNotice} tone={desk.onNotice ? 'warn' : 'neutral'} />
        <Tile label="On leave" value={desk.onLeave} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Needs action" className="lg:col-span-2">
          {needsAction.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing needs doing today.</p>
          ) : (
            <ul className="divide-y divide-line">
              {needsAction.map((q) => (
                <li key={q.key} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <div>
                      <span className="font-medium text-ink">{QUEUE_LABEL[q.key].title}</span>
                      <span className="ml-2 text-xs text-ink-faint">{QUEUE_LABEL[q.key].hint}</span>
                    </div>
                    <Badge tone="warn">{q.count}</Badge>
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {q.people.slice(0, 12).map((p) => (
                      <li key={p.employeeId}>
                        <Link
                          href={`/people/employees/${p.employeeId}`}
                          className="inline-flex flex-col rounded-lg border border-line-strong px-2.5 py-1.5 text-sm hover:bg-surface-raised"
                        >
                          <span className="font-medium text-ink">{p.employeeName}</span>
                          <span className="text-xs text-ink-faint">
                            {p.employeeCode} · {p.officeCode}
                            {p.detail ? ` · ${p.detail}` : ''}
                          </span>
                        </Link>
                      </li>
                    ))}
                    {q.people.length > 12 && (
                      <li className="self-center text-xs text-ink-muted">
                        and {q.people.length - 12} more
                      </li>
                    )}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-6">
          {desk.workload.available && (
            <Panel
              title={`Load, week of ${formatDate(desk.workload.weekStart)}`}
              linkHref="/people/workload"
              linkLabel="Workload"
            >
              <div className="grid grid-cols-2 gap-3 text-center">
                <div>
                  <div className="text-2xl font-bold text-danger-600 tabular-nums">
                    {desk.workload.over}
                  </div>
                  <div className="text-xs text-ink-muted">over 45 hours</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-warning-700 tabular-nums">
                    {desk.workload.under}
                  </div>
                  <div className="text-xs text-ink-muted">under 20 hours</div>
                </div>
              </div>
            </Panel>
          )}
          <Panel title="By office">
            {desk.byOffice.length === 0 ? (
              <p className="text-sm text-ink-muted">No one yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-faint">
                    <th className="pb-1 font-medium">Office</th>
                    {GRADE_ORDER.map((g) => (
                      <th key={g} className="pb-1 text-right font-medium">
                        {GRADE_SHORT[g]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {desk.byOffice.map((o) => (
                    <tr key={o.officeCode} className="border-t border-line">
                      <td className="py-1.5 font-medium">{o.officeCode}</td>
                      {GRADE_ORDER.map((g) => (
                        <td key={g} className="py-1.5 text-right tabular-nums">
                          {o.byGrade.find((b) => b.gradeSlug === g)?.count ?? 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
