'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FEATURE_FLAG, TODAY_GROUP_LABEL, type TodayGroup, type TodayItem } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { useFeatureFlags } from '@/lib/feature-flags';
import { taskContextFor } from '@/lib/engagement-context';
import { useFirmChecks } from '@/lib/firm-checks';
import { deadlineLabel, formatDate } from '@/lib/format';
import { useWorkHref } from '@/lib/work-href';
import { cn } from '@/lib/cn';
import { Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { PRIMARY, TaskActions } from '@/components/tasks/task-actions';
import { RemindClientButton } from '@/components/filing/client-chase';
import { FilingDrawer, useOpenFiling } from '@/components/filing/filing-drawer';
import { DecideAdjustmentButtons } from '@/components/billing/decide-adjustment';
import {
  stepSelection,
  todayContextLine,
  todayDateLead,
  todayDrawerItems,
  todayQuery,
  todayRows,
  todayWorkTask,
} from '@/components/today/today-model';

const EMPTY: Record<TodayGroup, string> = {
  prepare: 'Nothing to prepare.',
  review: 'Nothing waiting for your review.',
  notices: 'No notice of yours has a date running.',
  write_offs: 'No write-off or credit note waiting for you.',
  waiting: 'Not waiting on any client.',
  due_soon: 'No other filings due this week.',
};

/** A key press that belongs to a field or carries a modifier is not a shortcut. */
function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return (
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    (!!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable))
  );
}

/**
 * Staff Workflow WF-201 — Today: the day's work in one ordered list. To
 * prepare, to review, notices (PS-102), write-offs to approve (PS-205),
 * waiting on client, due this week —
 * overdue first. A
 * filing opens in the drawer over the list (WF-202); its next move (Start work,
 * Start review …) is a button on the row. j / k move, Enter opens.
 */
function TodayScreen(): JSX.Element {
  const { principal } = useAuth();
  const router = useRouter();
  const flags = useFeatureFlags();
  const on = flags.isOn(FEATURE_FLAG.todayView);
  const workHref = useWorkHref();
  const drawer = useOpenFiling();
  const query = todayQuery();
  const q = useQuery({ ...query, enabled: on });

  const rows = useMemo(() => todayRows(q.data), [q.data]);
  const drawerItems = useMemo(() => todayDrawerItems(rows, workHref), [rows, workHref]);
  const checks = useFirmChecks();
  const ctx = useMemo(() => taskContextFor(principal, {}, checks), [principal, checks]);
  const [selected, setSelected] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const openItem = useCallback(
    (i: TodayItem) => {
      if (i.link.instanceId) drawer.open(i.link.instanceId);
      else router.push(workHref(i));
    },
    [drawer, router, workHref],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e) || rows.length === 0) return;
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        setSelected((s) => stepSelection(s, e.key === 'j' ? 1 : -1, rows.length));
      } else if (e.key === 'Enter' && selected >= 0 && rows[selected]) {
        // Enter on a focused button or link is that control's own.
        const el = e.target as HTMLElement | null;
        if (el && /^(BUTTON|A)$/.test(el.tagName)) return;
        e.preventDefault();
        openItem(rows[selected]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, selected, openItem]);

  useEffect(() => {
    if (selected < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-row="${selected}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  if (!flags.isLoading && !on) {
    return (
      <div className="space-y-4">
        <PageHeader title="Today" />
        <EmptyState>
          Today isn&rsquo;t switched on for your office yet.{' '}
          <Link href="/my-work" className="font-medium text-primary-700 hover:underline">
            Open My Work
          </Link>
        </EmptyState>
      </div>
    );
  }

  const todayLabel = q.data ? formatDate(q.data.today) : '';
  let index = -1;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Today"
        subtitle={`${todayLabel ? `${todayLabel} · ` : ''}Overdue first, then by internal due date. j / k to move, Enter to open.`}
      />
      {(q.isLoading || flags.isLoading) && <Spinner label="Loading your day…" />}
      {q.isError && (
        <EmptyState>Could not load your day. Check that the API is reachable.</EmptyState>
      )}
      {q.data && (
        <div ref={listRef} className="space-y-5">
          {q.data.groups.map((g) => (
            <section key={g.group} aria-labelledby={`today-${g.group}`}>
              <h2
                id={`today-${g.group}`}
                className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-muted"
              >
                {TODAY_GROUP_LABEL[g.group]}
                <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-ink">
                  {g.total}
                </span>
              </h2>
              <Card className="p-0">
                {g.items.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-ink-faint">{EMPTY[g.group]}</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {g.items.map((item) => {
                      index += 1;
                      const i = index;
                      const task = todayWorkTask(item);
                      const href = workHref(item);
                      return (
                        <li
                          key={item.key}
                          data-row={i}
                          aria-current={selected === i ? 'true' : undefined}
                          onClick={() => setSelected(i)}
                          className={cn(
                            'flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3',
                            selected === i && 'bg-primary-50 ring-1 ring-inset ring-primary-300',
                            drawer.openId &&
                              drawer.openId === item.link.instanceId &&
                              'bg-surface-sunken',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <Link
                              href={href}
                              onClick={(e) => {
                                // A plain click works the filing in the drawer; Ctrl/Cmd-click opens the page.
                                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                                if (!item.link.instanceId) return;
                                e.preventDefault();
                                drawer.open(item.link.instanceId);
                              }}
                              className="block truncate font-medium text-ink hover:underline"
                            >
                              {item.title}
                            </Link>
                            <span className="block truncate text-xs text-ink-faint">
                              {todayContextLine(item)}
                            </span>
                          </div>
                          <div className="w-36 shrink-0 text-sm">
                            {item.internalDate ? (
                              <span
                                title="Internal due date"
                                className={
                                  item.isOverdue ? 'font-medium text-danger-600' : 'text-ink'
                                }
                              >
                                {todayDateLead(item) && `${todayDateLead(item)} `}
                                {deadlineLabel(item.internalDate)}
                              </span>
                            ) : (
                              <span className="text-ink-faint">—</span>
                            )}
                            {item.statutoryDate && (
                              <span
                                title="Statutory due date"
                                className="block text-xs text-ink-faint"
                              >
                                {item.notice ? 'Department' : 'Statutory'}{' '}
                                {formatDate(item.statutoryDate)}
                              </span>
                            )}
                          </div>
                          <div className="w-28 shrink-0">
                            <StatusBadge status={item.status} />
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                            {task && <TaskActions task={task} ctx={ctx} only={PRIMARY} />}
                            {item.adjustment && (
                              <DecideAdjustmentButtons
                                adjustment={item.adjustment}
                                listKey={query.queryKey}
                              />
                            )}
                            {item.group === 'waiting' && item.link.instanceId && (
                              <RemindClientButton
                                instanceId={item.link.instanceId}
                                offersWhatsapp={item.offersWhatsapp}
                              />
                            )}
                            <Button size="sm" variant="secondary" onClick={() => openItem(item)}>
                              Open
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {g.total > g.items.length && (
                  <p className="border-t border-line px-4 py-2 text-xs text-ink-muted">
                    Showing the {g.items.length} most urgent of {g.total}.{' '}
                    <Link href="/my-work" className="text-primary-700 hover:underline">
                      See all on My Work
                    </Link>
                  </p>
                )}
              </Card>
            </section>
          ))}
        </div>
      )}
      <FilingDrawer items={drawerItems} listKey={query.queryKey} />
    </div>
  );
}

export default function TodayPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <TodayScreen />
    </Suspense>
  );
}
