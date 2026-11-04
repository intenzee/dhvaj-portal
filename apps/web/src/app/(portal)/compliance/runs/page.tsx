'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, UserPlus } from 'lucide-react';
import {
  FEATURE_FLAG,
  PERMISSION,
  workItemHref,
  type FilingRunBulkResult,
  type FilingRunRemindResult,
  type FilingRunRow,
} from '@hsdg/contracts';
import { ApiError, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useToast } from '@/lib/toast';
import { useUrlState } from '@/lib/url-state';
import { useFirmChecks } from '@/lib/firm-checks';
import { deadlineLabel, formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Field, Select } from '@/components/form';
import { StatusBadge } from '@/components/status-badge';
import { FilingStatusBadge } from '@/components/filing/filing-status';
import { FilingDrawer, useOpenFiling, type DrawerItem } from '@/components/filing/filing-drawer';
import {
  RemindersToSend,
  remindersToSend,
  type ReminderToSend,
} from '@/components/filing/client-chase';
import {
  actionable,
  bulkSummary,
  dataLabel,
  defaultForm,
  formKey,
  formOptionLabel,
  formsQuery,
  parseFormKey,
  pruneSelection,
  runProgress,
  runQuery,
  runsKey,
  toggleSelection,
  type BulkAction,
  type RunScope,
} from '@/components/compliance/filing-runs-model';
import { BulkAssignModal } from '@/components/compliance/bulk-assign-modal';

const SCOPES: readonly (readonly [RunScope, string])[] = [
  ['all', 'All I can see'],
  ['mine', 'Mine'],
  ['team', 'My team'],
];

/** Bulk outcome, kept on screen until dismissed so each refused filing can be read. */
interface Outcome {
  action: BulkAction;
  result: FilingRunBulkResult;
}

/**
 * Staff Workflow WF-301 — filing runs: one form and period across every client.
 * Pick the run (defaults to the next due form), tick filings, then assign a
 * preparer / reviewer or remind the clients in one go. Lodging stays per
 * filing, in the drawer, and the grid updates when it lands.
 */
function RunsScreen(): JSX.Element {
  const { principal } = useAuth();
  const flags = useFeatureFlags();
  const on = flags.isOn(FEATURE_FLAG.filingRuns);
  const url = useUrlState();
  const drawer = useOpenFiling();
  const toast = useToast();
  const qc = useQueryClient();
  const scope = (
    ['mine', 'team'].includes(url.get('scope') ?? '') ? url.get('scope') : 'all'
  ) as RunScope;

  const forms = useQuery({ ...formsQuery(scope), enabled: on });
  const form = useMemo(
    () => defaultForm(forms.data ?? [], parseFormKey(url.get('run'))),
    [forms.data, url],
  );
  const runQ = runQuery(scope, form?.rule ?? '', form?.periodKey ?? '');
  const run = useQuery({ ...runQ, enabled: on && !!form });
  // "To tidy up": filings lodged without their acknowledgement or reference.
  const tidy = url.get('tidy') === '1';
  const rows = useMemo(
    () =>
      (run.data?.items ?? []).filter(
        (r) => !tidy || (r.filed && (r.filed.ackMissing || r.filed.referenceMissing)),
      ),
    [run.data, tidy],
  );
  const checks = useFirmChecks();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // WhatsApp / copy reminders from the last bulk remind, for the team to send.
  const [toSend, setToSend] = useState<ReminderToSend[]>([]);

  useEffect(() => setSelected((s) => pruneSelection(s, rows)), [rows]);

  // Managers, and stream leads where the firm allows it (the API marks each row).
  const canManage = can(principal, PERMISSION.engagementManage) || rows.some((r) => r.canAssign);
  const toAssign = actionable(rows, selected, 'assign');
  const toRemind = actionable(rows, selected, 'remind');
  const allIds = rows.map((r) => r.instanceId);
  const allTicked = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const finish = (action: BulkAction, result: FilingRunBulkResult): void => {
    const s = bulkSummary(action, result);
    toast(s.message, s.tone);
    setOutcome(result.failed.length > 0 ? { action, result } : null);
    void qc.invalidateQueries({ queryKey: runsKey });
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

  const drawerItems: DrawerItem[] = rows.map((r) => ({
    instanceId: r.instanceId,
    title: `${run.data?.formLabel ?? ''} · ${r.entityName}`,
    href: workItemHref(r.link),
  }));
  const nameOf = (id: string): string =>
    rows.find((r) => r.instanceId === id)?.entityName ?? 'A filing';

  if (!flags.isLoading && !on) {
    return (
      <div className="space-y-4">
        <PageHeader title="Filing runs" />
        <EmptyState>
          Filing runs aren&rsquo;t switched on for your office yet.{' '}
          <Link href="/compliance" className="font-medium text-primary-700 hover:underline">
            Open the Compliance calendar
          </Link>
        </EmptyState>
      </div>
    );
  }

  const progress = run.data ? runProgress(run.data) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Filing runs"
        subtitle="One form and period across every client. Tick filings to assign or remind them together; lodge each one in the drawer."
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Form and period" className="min-w-72 flex-1 sm:max-w-md">
          <Select
            aria-label="Form and period"
            value={form ? formKey(form) : ''}
            onChange={(e) => url.set({ run: e.target.value, open: null })}
            disabled={!forms.data || forms.data.length === 0}
          >
            {(forms.data ?? []).map((f) => (
              <option key={formKey(f)} value={formKey(f)}>
                {formOptionLabel(f)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap gap-2 pb-1" role="group" aria-label="Whose filings">
          {SCOPES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={scope === key}
              onClick={() => url.set({ scope: key === 'all' ? null : key, open: null })}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition',
                scope === key
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-raised',
              )}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={tidy}
            onClick={() => url.set({ tidy: tidy ? null : '1', open: null })}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition',
              tidy
                ? 'border-warning-600 bg-warning-600 text-white'
                : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-raised',
            )}
          >
            Filed — ack/ref missing
          </button>
        </div>
      </div>

      {progress && (
        <div className="space-y-1" aria-label="Run progress">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-ink">{progress.label}</span>
            {form?.statutoryDate && (
              <span className="text-ink-faint">Statutory {formatDate(form.statutoryDate)}</span>
            )}
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
            aria-label={progress.label}
            className="h-2 overflow-hidden rounded-full bg-surface-sunken"
          >
            <div className="h-full bg-success-600" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Bulk actions">
          <span className="text-sm text-ink-muted">
            {selected.size > 0 ? `${selected.size} selected` : 'Select filings to act on them'}
          </span>
          {canManage && (
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

      {outcome && (
        <div
          role="alert"
          className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium">{bulkSummary(outcome.action, outcome.result).message}</p>
            <button
              type="button"
              onClick={() => setOutcome(null)}
              className="text-xs font-medium underline"
            >
              Dismiss
            </button>
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {outcome.result.failed.map((f) => (
              <li key={f.instanceId}>
                {nameOf(f.instanceId)}: {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {toSend.length > 0 && <RemindersToSend reminders={toSend} onDismiss={() => setToSend([])} />}

      {(forms.isLoading || run.isLoading || flags.isLoading) && (
        <Spinner label="Loading the run…" />
      )}
      {(forms.isError || run.isError) && (
        <EmptyState>Could not load filing runs. Check that the API is reachable.</EmptyState>
      )}
      {forms.data && forms.data.length === 0 && (
        <EmptyState>No filings are due around today for the engagements you can see.</EmptyState>
      )}

      {run.data && rows.length === 0 && (
        <EmptyState>
          {tidy
            ? 'Every lodged filing in this run has its acknowledgement and reference.'
            : 'No filings in this run.'}
        </EmptyState>
      )}
      {run.data && rows.length > 0 && (
        <Card className="p-0">
          <div className="scroll-slim overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-raised/70 text-left">
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select every filing"
                      checked={allTicked}
                      onChange={() => setSelected((s) => toggleSelection(s, allIds))}
                    />
                  </th>
                  {['Client', 'Registration', 'Data', 'Prepared', 'Reviewed', 'Filed', 'Due'].map(
                    (h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RunRow
                    key={r.instanceId}
                    row={r}
                    ticked={selected.has(r.instanceId)}
                    open={drawer.openId === r.instanceId}
                    lodgeAnyStage={!checks.lodge_ready_to_file}
                    onTick={() => setSelected((s) => toggleSelection(s, [r.instanceId]))}
                    onOpen={() => drawer.open(r.instanceId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <BulkAssignModal
        open={assignOpen}
        instanceIds={toAssign}
        onClose={() => setAssignOpen(false)}
        onDone={(r) => {
          setAssignOpen(false);
          finish('assign', r);
        }}
      />
      <FilingDrawer items={drawerItems} listKey={runsKey} />
    </div>
  );
}

function RunRow({
  row: r,
  ticked,
  open,
  onTick,
  onOpen,
  lodgeAnyStage = false,
}: {
  row: FilingRunRow;
  ticked: boolean;
  open: boolean;
  onTick: () => void;
  onOpen: () => void;
  /** The firm lets a filing be lodged before it is Ready to file. */
  lodgeAnyStage?: boolean;
}): JSX.Element {
  const data = dataLabel(r.data);
  const href = workItemHref(r.link);
  return (
    <tr
      data-instance={r.instanceId}
      className={cn(
        'border-b border-line last:border-0',
        ticked && 'bg-primary-50/60',
        open && 'bg-surface-sunken',
      )}
    >
      <td className="px-4 py-2.5">
        <input
          type="checkbox"
          aria-label={`Select ${r.entityName}`}
          checked={ticked}
          onChange={onTick}
        />
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <Link
          href={href}
          onClick={(e) => {
            // A plain click works the filing in the drawer; Ctrl/Cmd-click opens the page.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            onOpen();
          }}
          className="font-medium text-primary-700 hover:underline"
        >
          {r.entityName}
        </Link>
        <span className="ml-1 text-xs text-ink-faint">· {r.engagementCode}</span>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-ink-muted">
        {r.registrationNumber ?? '—'}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5" title={data.title}>
        <Badge tone={data.tone}>{data.text}</Badge>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        {r.preparerName ?? <span className="text-ink-faint">Unassigned</span>}
        {r.taskStatus && (
          <span className="ml-1.5">
            <StatusBadge status={r.taskStatus} />
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        {r.reviewerName ?? <span className="text-ink-faint">—</span>}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        {r.filed ? (
          <span title={`Filed ${formatDate(r.filed.filedOn)}`}>
            <Badge tone="success">Filed</Badge>
            {r.filed.referenceNo && (
              <span className="ml-1.5 font-mono text-xs text-ink-muted">{r.filed.referenceNo}</span>
            )}
            {(r.filed.ackMissing || r.filed.referenceMissing) && (
              <button type="button" className="ml-1.5" onClick={onOpen}>
                <Badge tone="warn">
                  {r.filed.ackMissing && r.filed.referenceMissing
                    ? 'Ack & ref to add'
                    : r.filed.ackMissing
                      ? 'Ack to add'
                      : 'Ref to add'}
                </Badge>
              </button>
            )}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <FilingStatusBadge status={r.workflowStatus} />
            {r.canLodge && (lodgeAnyStage || r.workflowStatus === 'ready_to_file') && (
              <Button size="sm" variant="subtle" onClick={onOpen}>
                Lodge
              </Button>
            )}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        {r.internalDate ? (
          <span title="Internal due date">{deadlineLabel(r.internalDate)}</span>
        ) : (
          '—'
        )}
        {r.statutoryDate && (
          <span title="Statutory due date" className="block text-xs text-ink-faint">
            Statutory {formatDate(r.statutoryDate)}
          </span>
        )}
      </td>
    </tr>
  );
}

export default function FilingRunsPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <RunsScreen />
    </Suspense>
  );
}
