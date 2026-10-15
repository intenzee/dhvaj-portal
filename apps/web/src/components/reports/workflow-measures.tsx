'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PERMISSION,
  WORKFLOW_TARGET_RULE,
  workflowTargetLabel,
  type WorkflowBaselineInfo,
  type WorkflowMeasure,
  type WorkflowMeasuresReport,
  type WorkflowTarget,
  type WorkflowTargetRule,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, hasRole, type Principal } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import type { OfficeRow } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';

const UNIT: Record<WorkflowMeasure['unit'], string> = {
  steps: 'steps',
  percent: '%',
  hours: 'h',
  filings: 'filings',
  days: 'days',
  notifications: 'per person',
};

/** `2 steps`, `93.5%`, `4.25 h`, `25 min` — or a dash when there is nothing to measure. */
export function formatMeasure(value: number | null, unit: WorkflowMeasure['unit']): string {
  if (value === null) return '—';
  // Under an hour, in minutes: a review picked up at once reads "< 1 min", not "0 h".
  if (unit === 'hours' && value < 1) {
    const min = Math.round(value * 60);
    return min < 1 ? '< 1 min' : `${min} min`;
  }
  const n = Number.isInteger(value) ? String(value) : value.toFixed(value < 10 ? 2 : 1);
  return unit === 'percent' ? `${n}%` : `${n} ${UNIT[unit]}`;
}

/** The change on the window before, as a signed percentage; null when either side is missing or zero. */
export function changeOf(m: Pick<WorkflowMeasure, 'value' | 'previous'>): number | null {
  if (m.value === null || m.previous === null || m.previous === 0) return null;
  return Math.round(((m.value - m.previous) / m.previous) * 100);
}

/** "−12.5% on the baseline" style: a signed change, or null. */
export function formatChange(pct: number | null): string | null {
  if (pct === null) return null;
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '±';
  return `${sign}${Math.abs(pct)}%`;
}

/**
 * Why this window cannot be saved as the baseline, or null when it can. The
 * managing partner baselines the firm or any office; a partner sees their own
 * office's people, so baselines that office only. A window still running is
 * not a baseline.
 */
export function baselineBlocker(
  principal: Pick<Principal, 'officeId' | 'roles' | 'effectiveRole' | 'permissions'> | null,
  scope: { from: string; to: string; officeId: string },
  today: string,
): string | null {
  const p = principal as Principal | null;
  if (!can(p, PERMISSION.workflowManage)) return 'Only the partners save a baseline';
  if (scope.from > scope.to) return 'Pick a window that ends after it starts';
  if (scope.to > today) return 'A baseline is a window already measured: end it today or earlier';
  if (!hasRole(p, 'managing_partner') && scope.officeId !== p!.officeId)
    return 'A partner saves the baseline for their own office: pick it above';
  return null;
}

/** What is wrong with a target, or null. Mirrors the API's checks. */
export function targetProblem(t: Pick<WorkflowTarget, 'rule' | 'value'>): string | null {
  if (!Number.isFinite(t.value)) return 'Enter a number';
  if (t.rule === WORKFLOW_TARGET_RULE.changeBy)
    return t.value < -100 || t.value > 1000 ? 'Between −100% and +1000%' : null;
  return t.value < 0 ? 'Zero or more' : null;
}

/** The targets the draft changed, in measure order. */
export function changedTargets(
  saved: readonly WorkflowTarget[],
  draft: Readonly<Record<string, Pick<WorkflowTarget, 'rule' | 'value'>>>,
): WorkflowTarget[] {
  return saved
    .filter((t) => {
      const d = draft[t.key];
      return d !== undefined && (d.rule !== t.rule || d.value !== t.value);
    })
    .map((t) => ({ key: t.key, ...draft[t.key]! }));
}

function istDay(offsetDays = 0): string {
  return new Date(Date.now() + 5.5 * 3_600_000 + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

const RULE_LABEL: Record<WorkflowTargetRule, string> = {
  at_most: 'At most',
  at_least: 'At least',
  change_by: 'Change on baseline (%)',
};

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function BaselineLine({ baseline }: { baseline: WorkflowBaselineInfo | null }): JSX.Element {
  if (!baseline)
    return (
      <p className="text-sm text-ink-muted">
        No baseline saved for this scope yet — the targets on the baseline can’t be judged until one
        is.
      </p>
    );
  const saved = new Date(baseline.savedAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return (
    <p className="text-sm text-ink-muted">
      Baseline: <span className="text-ink">{dayLabel(baseline.from)}</span> –{' '}
      <span className="text-ink">{dayLabel(baseline.to)}</span>, saved{' '}
      {baseline.savedBy ? `by ${baseline.savedBy} ` : ''}on {saved}.
    </p>
  );
}

/**
 * Staff Workflow · How we measure it — the six numbers for a window of days,
 * each next to the window before it, the saved baseline and the target the
 * partners set, with whether it is on track. Partners save the baseline and
 * edit the targets here.
 */
export function WorkflowMeasures(): JSX.Element {
  const { principal } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [to, setTo] = useState(() => istDay());
  const [from, setFrom] = useState(() => istDay(-6));
  const [officeId, setOfficeId] = useState('');
  const [draft, setDraft] = useState<Record<string, Pick<WorkflowTarget, 'rule' | 'value'>> | null>(
    null,
  );
  const manage = can(principal, PERMISSION.workflowManage);

  const offices = useQuery({
    queryKey: ['offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
  });
  const qs = new URLSearchParams({ from, to, ...(officeId ? { officeId } : {}) });
  const report = useQuery({
    queryKey: ['telemetry-measures', from, to, officeId],
    queryFn: () => apiFetch<WorkflowMeasuresReport>(`/telemetry/measures?${qs.toString()}`),
    enabled: from <= to,
  });
  const fail = (e: unknown, fallback: string) =>
    toast(e instanceof ApiError ? e.message : fallback, 'error');
  const save = useMutation({
    mutationFn: () =>
      apiFetch<WorkflowBaselineInfo>('/telemetry/baselines', {
        method: 'POST',
        body: { from, to, officeId: officeId || null },
      }),
    onSuccess: () => {
      toast('Saved as the baseline');
      void qc.invalidateQueries({ queryKey: ['telemetry-measures'] });
    },
    onError: (e) => fail(e, 'Could not save the baseline.'),
  });
  const saveTargets = useMutation({
    mutationFn: (items: WorkflowTarget[]) =>
      apiFetch<WorkflowTarget[]>('/telemetry/targets', { method: 'PUT', body: { items } }),
    onSuccess: () => {
      toast('Targets saved');
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['telemetry-measures'] });
    },
    onError: (e) => fail(e, 'Could not save the targets.'),
  });

  const blocker = baselineBlocker(principal, { from, to, officeId }, istDay());
  const measures = report.data?.measures ?? [];
  const saved = measures.map((m) => m.target);
  const edits = draft ? changedTargets(saved, draft) : [];
  const problems = draft ? Object.values(draft).some((t) => targetProblem(t) !== null) : false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Office">
          <Select value={officeId} onChange={(e) => setOfficeId(e.target.value)} className="w-44">
            <option value="">All offices</option>
            {(offices.data ?? [])
              .filter((o) => o.isActive)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </Select>
        </Field>
        {manage && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={blocker !== null || save.isPending || !report.data}
              title={blocker ?? 'Freeze these numbers as the baseline for this scope'}
              onClick={() => save.mutate()}
            >
              Save as baseline
            </Button>
            {draft ? (
              <>
                <Button variant="ghost" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={edits.length === 0 || problems || saveTargets.isPending}
                  onClick={() => saveTargets.mutate(edits)}
                >
                  Save targets
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                disabled={!report.data}
                onClick={() =>
                  setDraft(
                    Object.fromEntries(saved.map((t) => [t.key, { rule: t.rule, value: t.value }])),
                  )
                }
              >
                Edit targets
              </Button>
            )}
          </div>
        )}
      </div>
      {manage && blocker && (
        <p className="text-xs text-ink-muted" role="note">
          {blocker}.
        </p>
      )}

      {report.isLoading ? (
        <Spinner />
      ) : report.isError || !report.data ? (
        <EmptyState>Couldn’t load the measures for these dates.</EmptyState>
      ) : (
        <>
          <BaselineLine baseline={report.data.baseline} />
          <Card className="divide-y divide-line">
            {measures.map((m) => {
              const change = changeOf(m);
              const vs = formatChange(m.vsBaseline);
              const d = draft?.[m.key];
              const problem = d ? targetProblem(d) : null;
              return (
                <section
                  key={m.key}
                  aria-label={m.label}
                  className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{m.label}</p>
                    <p className="text-xs text-ink-muted">{m.how}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums text-ink">
                      {formatMeasure(m.value, m.unit)}
                    </p>
                    <p className="text-xs text-ink-muted">
                      before: {formatMeasure(m.previous, m.unit)}
                      {change !== null && ` (${change > 0 ? '+' : ''}${change}%)`} · n = {m.sample}
                    </p>
                    {report.data.baseline && (
                      <p className="text-xs text-ink-muted">
                        baseline: {formatMeasure(m.baseline, m.unit)}
                        {vs !== null && ` (${vs})`}
                      </p>
                    )}
                  </div>
                  <div className="sm:w-56 sm:text-right">
                    {d ? (
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <Select
                          aria-label={`${m.label}: target rule`}
                          value={d.rule}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              [m.key]: { ...d, rule: e.target.value as WorkflowTargetRule },
                            })
                          }
                          className="w-auto"
                        >
                          {Object.values(WORKFLOW_TARGET_RULE).map((r) => (
                            <option key={r} value={r}>
                              {RULE_LABEL[r]}
                            </option>
                          ))}
                        </Select>
                        <Input
                          aria-label={`${m.label}: target value`}
                          type="number"
                          step="any"
                          value={Number.isFinite(d.value) ? d.value : ''}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              [m.key]: {
                                ...d,
                                value: e.target.value === '' ? NaN : Number(e.target.value),
                              },
                            })
                          }
                          className="w-20"
                        />
                        <p
                          className={
                            problem
                              ? 'w-full text-xs text-danger-700'
                              : 'w-full text-xs text-ink-muted'
                          }
                        >
                          {problem ?? workflowTargetLabel(d, m.unit)}
                        </p>
                      </div>
                    ) : (
                      <>
                        <Badge
                          tone={m.onTrack === null ? 'neutral' : m.onTrack ? 'success' : 'warn'}
                        >
                          Target {m.targetLabel}
                        </Badge>
                        <p className="mt-1 text-xs text-ink-muted">
                          {m.onTrack === null
                            ? m.target.rule === WORKFLOW_TARGET_RULE.changeBy &&
                              !report.data.baseline
                              ? 'Needs a baseline'
                              : 'Nothing to judge yet'
                            : m.onTrack
                              ? 'On track'
                              : 'Off track'}
                        </p>
                      </>
                    )}
                  </div>
                </section>
              );
            })}
          </Card>
        </>
      )}
      <p className="text-xs text-ink-muted">
        Steps and clicks come from page visits only — never what is on the page. A baseline freezes
        the numbers for its window; the targets on the baseline are judged against the latest one
        saved for the firm or the office shown.
      </p>
    </div>
  );
}
