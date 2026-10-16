'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import {
  FEATURE_FLAG,
  NOTICE_STATUSES,
  NOTICE_STATUS_LABEL,
  NOTICE_STREAMS,
  NOTICE_STREAM_LABEL,
  PERMISSION,
} from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useUrlState } from '@/lib/url-state';
import { fetchNotices, noticesKey } from '@/lib/notices-api';
import {
  noticeFiltersFrom,
  noticeFiltersPatch,
  noticeListPath,
  type NoticeFilters,
} from '@/lib/notices';
import { todayIst } from '@/components/work/my-task-columns';
import { Button, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Select } from '@/components/form';
import { DataTable } from '@/components/data-table';
import { noticeColumns, noticeHref } from '@/components/notices/notice-bits';
import { NewNoticeModal } from '@/components/notices/new-notice-modal';

const columns = noticeColumns();

/** PS-102 — every notice the caller can see, by stream, status, owner and how soon it falls due. */
function NoticesScreen(): JSX.Element {
  const router = useRouter();
  const { principal } = useAuth();
  const flags = useFeatureFlags();
  const on = flags.isOn(FEATURE_FLAG.notices);
  const url = useUrlState();
  const filters = noticeFiltersFrom(url.get);
  const setFilters = (patch: Partial<NoticeFilters>): void =>
    url.set(noticeFiltersPatch({ ...filters, ...patch }));
  const today = useMemo(() => todayIst(), []);
  const [adding, setAdding] = useState(false);

  // The search box writes to the URL after a pause.
  const [term, setTerm] = useState(filters.search);
  useEffect(() => {
    if (term === filters.search) return;
    const t = setTimeout(() => setFilters({ search: term }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const path = noticeListPath(filters, today);
  const list = useInfiniteQuery({
    queryKey: [...noticesKey, 'list', path],
    queryFn: ({ pageParam }) =>
      fetchNotices(pageParam ? noticeListPath(filters, today, { cursor: pageParam }) : path),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: on,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const canManage = can(principal, PERMISSION.noticeManage);

  if (!flags.isLoading && !on) {
    return (
      <div>
        <PageHeader title="Notices" />
        <EmptyState>The notice register isn&rsquo;t switched on for your office yet.</EmptyState>
      </div>
    );
  }

  const chip = (active: boolean): string =>
    `rounded-full border px-3 py-1 text-xs font-medium transition ${
      active
        ? 'border-primary-600 bg-primary-600 text-white'
        : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-raised'
    }`;

  return (
    <div>
      <PageHeader
        title="Notices"
        subtitle="Department notices served on clients — who owns each, and the date that matters now."
        actions={
          canManage ? (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add notice
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-56 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-1.5">
          <Search className="h-4 w-4 text-ink-faint" aria-hidden />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Reference or client…"
            aria-label="Search notices"
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </div>
        <Select
          className="w-auto"
          aria-label="Stream"
          value={filters.stream}
          onChange={(e) => setFilters({ stream: e.target.value as NoticeFilters['stream'] })}
        >
          <option value="">Every stream</option>
          {NOTICE_STREAMS.map((s) => (
            <option key={s} value={s}>
              {NOTICE_STREAM_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto"
          aria-label="Status"
          value={filters.status}
          onChange={(e) => setFilters({ status: e.target.value as NoticeFilters['status'] })}
        >
          <option value="open">Open</option>
          <option value="all">Every status</option>
          {NOTICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {NOTICE_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1" role="group" aria-label="Owner">
          {(
            [
              ['anyone', 'Anyone'],
              ['me', 'Mine'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={filters.owner === k}
              className={chip(filters.owner === k)}
              onClick={() => setFilters({ owner: k })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Due">
          {(
            [
              ['', 'Any date'],
              ['7', 'Due in 7 days'],
              ['30', 'Due in 30 days'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k || 'any'}
              type="button"
              aria-pressed={filters.due === k}
              className={chip(filters.due === k)}
              onClick={() => setFilters({ due: k })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {list.isLoading && <Spinner />}
      {list.isError && (
        <EmptyState>Could not load notices. Check that the API is reachable.</EmptyState>
      )}
      {list.data && (
        <DataTable
          columns={columns}
          data={rows}
          rowHref={noticeHref}
          empty={
            filters.status === 'open' &&
            !filters.stream &&
            !filters.due &&
            !filters.search &&
            filters.owner === 'anyone'
              ? 'No open notices on the engagements you can see.'
              : 'No notices match these filters.'
          }
        />
      )}
      {list.hasNextPage && (
        <div className="mt-3 flex justify-center">
          <Button
            variant="secondary"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}

      {adding && (
        <NewNoticeModal
          onClose={() => setAdding(false)}
          onCreated={(n) => {
            setAdding(false);
            router.push(`/notices/${n.id}`);
          }}
        />
      )}
    </div>
  );
}

export default function NoticesPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <NoticesScreen />
    </Suspense>
  );
}
