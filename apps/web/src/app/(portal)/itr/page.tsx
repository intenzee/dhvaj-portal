'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Search, UserPlus } from 'lucide-react';
import {
  FEATURE_FLAG,
  ITR_FORM_LABEL,
  ITR_REFUND_STATUS_LABEL,
  ITR_STAGES,
  ITR_STAGE_LABEL,
  itrYearLabel,
  type FilingRunBulkResult,
  type FilingRunRemindResult,
  type ItrSeasonRow,
  type ItrStage,
} from '@hsdg/contracts';
import { ApiError, apiFetch } from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useToast } from '@/lib/toast';
import { useUrlState } from '@/lib/url-state';
import { formatDate } from '@/lib/format';
import { istToday } from '@/lib/people';
import { cn } from '@/lib/cn';
import {
  ITR_REFUND_TONE,
  ITR_STAGE_TONE,
  currentItrYear,
  fetchItrSeason,
  filterSeason,
  itrActionable,
  itrKey,
  itrReturnHref,
  itrSeasonKey,
  itrYearOptions,
  openItrReturn,
  type ItrScope,
} from '@/lib/itr-api';
import {
  bulkSummary,
  pruneSelection,
  toggleSelection,
} from '@/components/compliance/filing-runs-model';
import { BulkAssignModal } from '@/components/compliance/bulk-assign-modal';
import {
  RemindersToSend,
  remindersToSend,
  type ReminderToSend,
} from '@/components/filing/client-chase';
import { Badge, Button, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';

const SCOPES: readonly (readonly [ItrScope, string])[] = [
  ['all', 'All I can see'],
  ['mine', 'Mine'],
  ['team', 'My team'],
];

/**
 * Practice Services PS-403 — the ITR desk: the season's returns on
 * individuals, HUFs and proprietors in one grid. Tick returns to assign or
 * remind in bulk (the filing run's actions); open one to work it.
 */
function ItrSeasonScreen(): JSX.Element {
  const flags = useFeatureFlags();
  const on = flags.isOn(FEATURE_FLAG.itrDesk);
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const url = useUrlState();
  const today = istToday();
  const fy = url.get('fy') ?? currentItrYear(today);
  const scope = (url.get('scope') as ItrScope | null) ?? 'all';
  const stage = (url.get('stage') ?? '') as ItrStage | '';
  const overdue = url.get('overdue') === '1';
  const [term, setTerm] = useState(url.get('q') ?? '');

  const season = useQuery({
    queryKey: itrSeasonKey(fy, scope),
    queryFn: () => fetchItrSeason(fy, scope),
    enabled: on,
  });
  const all = season.data?.items;
  const rows = useMemo(
    () => filterSeason(all ?? [], { search: term, stage, overdue }),
    [all, term, stage, overdue],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [failed, setFailed] = useState<{
    message: string;
    items: { name: string; why: string }[];
  } | null>(null);
  const [toSend, setToSend] = useState<ReminderToSend[]>([]);
  useEffect(() => setSelected((s) => pruneSelection(s, rows)), [rows]);

  const toAssign = itrActionable(rows, selected, 'assign');
  const toRemind = itrActionable(rows, selected, 'remind');
  const allIds = rows.map((r) => r.instanceId);
  const allTicked = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const nameOf = (id: string): string =>
    rows.find((r) => r.instanceId === id)?.entityName ?? 'A return';

  const finish = (action: 'assign' | 'remind', result: FilingRunBulkResult): void => {
    const s = bulkSummary(action, result);
    toast(s.message, s.tone);
    setFailed(
      result.failed.length > 0
        ? {
            message: s.message,
            items: result.failed.map((f) => ({ name: nameOf(f.instanceId), why: f.message })),
          }
        : null,
    );
    void qc.invalidateQueries({ queryKey: itrKey });
  };
  const onError = (err: unknown): void => {
    toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
  };

  const remind = useMutation({
    mutationFn: () =>
      apiFetch<FilingRunRemindResult>('/compliance/runs/remind', {
        method: 'POST',
        body: { instanceIds: toRemind },
      }),
    onSuccess: (r) => {
      setToSend(remindersToSend(r.reminders));
      finish('remind', r);
    },
    onError,
  });
  const open = useMutation({
    mutationFn: (row: ItrSeasonRow) => openItrReturn(row.instanceId),
    onSuccess: (r) => router.push(itrReturnHref(r.id)),
    onError,
  });

  if (!flags.isLoading && !on) {
    return (
      <div className="space-y-4">
        <PageHeader title="ITR desk" />
        <EmptyState>
          The ITR desk isn&rsquo;t switched on for your office yet.{' '}
          <Link href="/compliance/runs" className="font-medium text-primary-700 hover:underline">
            Open Filing runs
          </Link>
        </EmptyState>
      </div>
    );
  }

  const s = season.data;
  const chip = (value: ItrStage | '', label: string, count: number | undefined): JSX.Element => (
    <button
      key={value || 'all'}
      type="button"
      aria-pressed={stage === value}
      onClick={() => url.set({ stage: value || null })}
      className={cn(
        'rounded-full border px-3 py-1 text-sm',
        stage === value
          ? 'border-primary-300 bg-primary-50 text-primary-700'
          : 'border-line text-ink-muted hover:bg-surface-sunken',
      )}
    >
      {label}
      {count !== undefined ? ` · ${count}` : ''}
    </button>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="ITR desk"
        subtitle="The season's returns on individuals, HUFs and proprietors: assign, chase, file, e-verify, and follow the refund."
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Year">
          <Select value={fy} onChange={(e) => url.set({ fy: e.target.value })}>
            {itrYearOptions(today).map((y) => (
              <option key={y} value={y}>
                {itrYearLabel(y)} (FY {y})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Whose">
          <Select
            value={scope}
            onChange={(e) => url.set({ scope: e.target.value === 'all' ? null : e.target.value })}
          >
            {SCOPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Search" className="min-w-60 flex-1 sm:max-w-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-muted" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onBlur={() => url.set({ q: term || null })}
              placeholder="Client, PAN, engagement or ack no."
              className="pl-8"
            />
          </div>
        </Field>
      </div>

      {s && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Stages">
          {chip('', 'All', s.total)}
          {ITR_STAGES.map((st) => chip(st, ITR_STAGE_LABEL[st], s.stages[st]))}
          <button
            type="button"
            aria-pressed={overdue}
            onClick={() => url.set({ overdue: overdue ? null : '1' })}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              overdue
                ? 'border-danger-300 bg-danger-50 text-danger-700'
                : 'border-line text-ink-muted hover:bg-surface-sunken',
            )}
          >
            E-verify overdue · {s.eVerifyOverdue}
          </button>
          <span className="text-sm text-ink-muted">Refunds pending · {s.refundsPending}</span>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Bulk actions">
          <span className="text-sm text-ink-muted">
            {selected.size > 0 ? `${selected.size} selected` : 'Select returns to act on them'}
          </span>
          {rows.some((r) => r.canAssign) && (
            <Button
              size="sm"
              variant="secondary"
              disabled={toAssign.length === 0}
              onClick={() => setAssignOpen(true)}
            >
              <UserPlus className="h-4 w-4" /> Assign
              {toAssign.length ? ` (${toAssign.length})` : ''}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={toRemind.length === 0 || remind.isPending}
            onClick={() => remind.mutate()}
          >
            <BellRing className="h-4 w-4" />
            {remind.isPending
              ? 'Reminding…'
              : `Remind clients${toRemind.length ? ` (${toRemind.length})` : ''}`}
          </Button>
        </div>
      )}

      {failed && (
        <div
          role="alert"
          className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium">{failed.message}</p>
            <button
              type="button"
              onClick={() => setFailed(null)}
              className="text-xs font-medium underline"
            >
              Dismiss
            </button>
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {failed.items.map((f, i) => (
              <li key={i}>
                {f.name}: {f.why}
              </li>
            ))}
          </ul>
        </div>
      )}

      {toSend.length > 0 && <RemindersToSend reminders={toSend} onDismiss={() => setToSend([])} />}

      {(season.isLoading || flags.isLoading) && <Spinner label="Loading the season…" />}
      {season.isError && (
        <EmptyState>Could not load the ITR desk. Check that the API is reachable.</EmptyState>
      )}
      {s && rows.length === 0 && (
        <EmptyState>
          {s.total === 0
            ? `No ITR filings for ${s.yearLabel} yet. They appear once the calendar rolls the year's IT_ITR filings onto client engagements.`
            : 'No returns match these filters.'}
        </EmptyState>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select every return"
                    checked={allTicked}
                    onChange={() => setSelected((x) => toggleSelection(x, allIds))}
                  />
                </th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Form</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Filed</th>
                <th className="px-3 py-2">E-verify by</th>
                <th className="px-3 py-2">Refund</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr
                  key={r.instanceId}
                  className={cn(selected.has(r.instanceId) && 'bg-primary-50')}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.entityName}`}
                      checked={selected.has(r.instanceId)}
                      onChange={() => setSelected((x) => toggleSelection(x, [r.instanceId]))}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-ink">{r.entityName}</div>
                    <div className="text-xs text-ink-muted">
                      {[r.pan, r.engagementCode].filter(Boolean).join(' · ')}
                      {r.requestsOpen > 0
                        ? ` · ${r.requestsOpen} open request${r.requestsOpen === 1 ? '' : 's'}`
                        : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2">{r.itrForm ? ITR_FORM_LABEL[r.itrForm] : '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    <div>{r.preparerName ?? 'Unassigned'}</div>
                    {r.reviewerName && (
                      <div className="text-ink-muted">Review: {r.reviewerName}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={ITR_STAGE_TONE[r.stage]}>{ITR_STAGE_LABEL[r.stage]}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.filedOn ? (
                      <>
                        <div>{formatDate(r.filedOn)}</div>
                        {r.ackNo && <div className="text-ink-muted">{r.ackNo}</div>}
                      </>
                    ) : (
                      <span className="text-ink-muted">Due {formatDate(r.statutoryDate)}</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-xs',
                      r.eVerifyOverdue && 'font-medium text-danger-700',
                    )}
                  >
                    {r.eVerifyDueOn ? formatDate(r.eVerifyDueOn) : '—'}
                    {r.eVerifyOverdue ? ' · overdue' : ''}
                  </td>
                  <td className="px-3 py-2">
                    {r.refundStatus !== 'none' && (
                      <Badge tone={ITR_REFUND_TONE[r.refundStatus]}>
                        {ITR_REFUND_STATUS_LABEL[r.refundStatus]}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.returnId ? (
                      <Link
                        href={itrReturnHref(r.returnId)}
                        className="font-medium text-primary-700 hover:underline"
                      >
                        Open
                      </Link>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={open.isPending}
                        onClick={() => open.mutate(r)}
                      >
                        Open
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BulkAssignModal
        open={assignOpen}
        noun="return"
        instanceIds={toAssign}
        onClose={() => setAssignOpen(false)}
        onDone={(r) => {
          setAssignOpen(false);
          finish('assign', r);
        }}
      />
    </div>
  );
}

export default function ItrDeskPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <ItrSeasonScreen />
    </Suspense>
  );
}
