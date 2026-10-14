import type {
  FilingRun,
  FilingRunBulkResult,
  FilingRunData,
  FilingRunForm,
  FilingRunRow,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';

/**
 * Staff Workflow WF-301 — the filing-run page's pure pieces (tested): which
 * run the picker opens on, the grid's Data / progress labels, selection, and
 * how a bulk call's partial result reads.
 */

export type RunScope = 'all' | 'mine' | 'team';

/** `rule|period` — one picker option. */
export function formKey(f: { rule: string; periodKey: string }): string {
  return `${f.rule}|${f.periodKey}`;
}

export function parseFormKey(key: string | null): { rule: string; period: string } | null {
  if (!key) return null;
  const at = key.indexOf('|');
  if (at <= 0 || at === key.length - 1) return null;
  return { rule: key.slice(0, at), period: key.slice(at + 1) };
}

/**
 * The run the picker opens on: the one the URL names when it is offered, else
 * the next due form — the earliest statutory date not yet fully filed — else
 * the first form.
 */
export function defaultForm(
  forms: readonly FilingRunForm[],
  wanted: { rule: string; period: string } | null,
): FilingRunForm | null {
  if (wanted) {
    const hit = forms.find((f) => f.rule === wanted.rule && f.periodKey === wanted.period);
    if (hit) return hit;
  }
  const open = forms
    .filter((f) => f.filed < f.total)
    .sort((a, b) => (a.statutoryDate ?? '9999').localeCompare(b.statutoryDate ?? '9999'));
  return open[0] ?? forms[0] ?? null;
}

/** The picker's option text: "GSTR-1 · Sep 2026 — 18 of 42 filed". */
export function formOptionLabel(f: FilingRunForm): string {
  return `${f.formLabel} · ${f.periodLabel} — ${f.filed} of ${f.total} filed`;
}

/** "18 of 42 filed" and the bar's width (0–100). */
export function runProgress(run: Pick<FilingRun, 'filed' | 'total'>): {
  label: string;
  percent: number;
} {
  const percent = run.total > 0 ? Math.round((run.filed / run.total) * 100) : 0;
  return { label: `${run.filed} of ${run.total} filed`, percent };
}

/** The Data column: what the client has sent, and whether it is all in. */
export function dataLabel(d: FilingRunData): {
  text: string;
  tone: 'success' | 'warn' | 'neutral';
  title: string;
} {
  const title = d.waitingOn.length > 0 ? `Waiting on: ${d.waitingOn.join(', ')}` : '';
  if (d.slotsRequired === 0 && d.requestsTotal === 0) {
    return { text: '—', tone: 'neutral', title: 'No client data needed' };
  }
  const slots = d.slotsRequired > 0 ? `${d.slotsFilled}/${d.slotsRequired} slots` : '';
  const complete =
    d.requestsOpen === 0 && (d.slotsRequired === 0 || d.slotsFilled >= d.slotsRequired);
  if (complete) return { text: slots ? `In · ${slots}` : 'In', tone: 'success', title };
  const waiting = d.requestsOpen > 0 ? `${d.requestsOpen} waiting` : '';
  return { text: [waiting, slots].filter(Boolean).join(' · '), tone: 'warn', title };
}

/** Rows a bulk action may touch: assign needs `canAssign`; remind is open to any row not yet filed. */
export function actionable(
  rows: readonly FilingRunRow[],
  selected: ReadonlySet<string>,
  action: 'assign' | 'remind',
): string[] {
  return rows
    .filter((r) => selected.has(r.instanceId))
    .filter((r) => (action === 'assign' ? r.canAssign : r.workflowStatus !== 'filed'))
    .map((r) => r.instanceId);
}

/** Toggle one id, or every id (when all are already selected, clear). */
export function toggleSelection(
  selected: ReadonlySet<string>,
  ids: readonly string[],
): Set<string> {
  const next = new Set(selected);
  const all = ids.length > 0 && ids.every((id) => next.has(id));
  for (const id of ids) {
    if (all) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** Drop selected ids no longer in the run (after a period change or a refetch). */
export function pruneSelection(
  selected: ReadonlySet<string>,
  rows: readonly FilingRunRow[],
): Set<string> {
  const ids = new Set(rows.map((r) => r.instanceId));
  return new Set([...selected].filter((id) => ids.has(id)));
}

export type BulkAction = 'assign' | 'remind';
const DONE: Record<BulkAction, string> = { assign: 'Assigned', remind: 'Reminded' };

/** A bulk call's outcome, for the toast and the failure list. */
export function bulkSummary(
  action: BulkAction,
  result: FilingRunBulkResult,
): { message: string; tone: 'success' | 'error' } {
  const ok = result.succeeded.length;
  const bad = result.failed.length;
  const filings = (n: number): string => `${n} filing${n === 1 ? '' : 's'}`;
  if (bad === 0) return { message: `${DONE[action]} ${filings(ok)}.`, tone: 'success' };
  if (ok === 0) return { message: `Could not ${action} ${filings(bad)}.`, tone: 'error' };
  return { message: `${DONE[action]} ${filings(ok)}; ${bad} could not be done.`, tone: 'error' };
}

export const runsKey = ['compliance', 'runs'] as const;

export function formsQuery(scope: RunScope) {
  return {
    queryKey: [...runsKey, 'forms', scope] as const,
    queryFn: () =>
      apiFetch<FilingRunForm[]>(
        `/compliance/runs/forms${scope === 'all' ? '' : `?scope=${scope}`}`,
      ),
  };
}

export function runQuery(scope: RunScope, rule: string, period: string) {
  const qs = new URLSearchParams({ rule, period });
  if (scope !== 'all') qs.set('scope', scope);
  return {
    queryKey: [...runsKey, 'run', scope, rule, period] as const,
    queryFn: () => apiFetch<FilingRun>(`/compliance/runs?${qs.toString()}`),
  };
}
