/**
 * Statutory Audit — Reassessment detects changes in the file (Audit Spec §30).
 *
 * The team should not have to notice that something upstream moved. The file
 * compares itself with what the audit work was planned on and detects:
 *
 *   • materiality revised — audit areas still planned at a figure that is no
 *     longer the performance (or a specific) materiality;
 *   • a significant risk with no procedure responding to it;
 *   • Section 02 and the audit work out of step — a workstream the framework
 *     now requires is missing, or one it no longer requires is still active;
 *   • a subsidiary / associate on the client master while CFS is concluded
 *     not applicable;
 *   • the planned completion date moved while the work is still due on the
 *     old date.
 *
 * Each detection carries a stable key (with the values that changed — a new
 * change is a new detection), a pre-written reason, the facts, the work areas
 * raising it should flag (targeted, not every area) and its follow-through.
 * Raising stays a person's decision: it re-opens work and sign-off.
 *
 * Pure: no database, unit-tested on its own.
 */
import type { ReassessmentDetection } from '@hsdg/contracts';

export interface DetectionArea {
  id: string;
  key: string;
  title: string;
  /** A 03.5 financial-statement area (not a framework workstream). */
  isFs: boolean;
  materiality: number | null;
  dueDate: string | null;
}

export interface DetectionFacts {
  performanceMateriality: number | null;
  specificMateriality: readonly number[];
  /** Active work areas. */
  areas: readonly DetectionArea[];
  /** Not-complete procedures' due dates. */
  procedureDueDates: readonly string[];
  /** Significant, not-concluded risks with no procedure linked. */
  unansweredRisks: ReadonlyArray<{
    id: string;
    ref: string;
    description: string;
    areaId: string | null;
  }>;
  /** Framework workstreams the approved conclusions require, by key. */
  requiredWorkstreams: ReadonlyArray<{ key: string; title: string }>;
  /** Active framework workstream areas on the file. */
  activeWorkstreams: ReadonlyArray<{ id: string; key: string; title: string }>;
  frameworkVersion: number | null;
  /** Subsidiaries / associates / JVs on the client master. */
  investees: readonly string[];
  cfsConclusion: 'applicable' | 'not_applicable' | null;
  plannedEndDate: string | null;
}

const money = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

const named = (titles: readonly string[], max = 3): string =>
  titles.length > max
    ? `${titles.slice(0, max).join(', ')} +${titles.length - max} more`
    : titles.join(', ');

const scopeLabel = (areas: readonly { title: string }[]): string | null =>
  areas.length === 0 ? null : `${areas.length} area(s): ${named(areas.map((a) => a.title))}`;

export function detectChanges(f: DetectionFacts): ReassessmentDetection[] {
  const out: ReassessmentDetection[] = [];

  // ── Materiality revised ──────────────────────────────────────────────────
  const pm = f.performanceMateriality;
  if (pm != null) {
    const stale = f.areas.filter(
      (a) =>
        a.isFs &&
        a.materiality != null &&
        a.materiality !== pm &&
        !f.specificMateriality.includes(a.materiality),
    );
    if (stale.length > 0) {
      const old = [...new Set(stale.map((a) => a.materiality!))].sort((a, b) => a - b);
      out.push({
        key: `materiality:${pm}`,
        changeType: 'materiality_revised',
        reason: `Performance materiality is now ${money(pm)}; ${stale.length} audit area(s) were planned at ${old.map(money).join(' / ')}. Reassess sample sizes, testing thresholds and the evaluation of misstatements (SA 320).`,
        facts: [
          `03.3 performance materiality: ${money(pm)}.`,
          ...stale.slice(0, 4).map((a) => `${a.title}: planned at ${money(a.materiality!)}.`),
          ...(stale.length > 4 ? [`+${stale.length - 4} more area(s).`] : []),
        ],
        scopeAreaIds: stale.map((a) => a.id),
        scopeLabel: scopeLabel(stale),
        followThrough: `Updates those areas' materiality to ${money(pm)}.`,
      });
    }
  }

  // ── Significant risk without a response ──────────────────────────────────
  for (const r of f.unansweredRisks) {
    const area = r.areaId ? f.areas.find((a) => a.id === r.areaId) : undefined;
    out.push({
      key: `risk:${r.id}`,
      changeType: 'risk_changed',
      reason: `Significant risk ${r.ref} (${r.description}) has no procedure responding to it — design and perform a specific response (SA 330.21).`,
      facts: [
        `Section 04: ${r.ref} ${r.description} is significant.`,
        'No audit procedure is linked to it.',
        'Refresh suggested work on the audit work to add its response.',
      ],
      scopeAreaIds: area ? [area.id] : [],
      scopeLabel: area ? scopeLabel([area]) : null,
      followThrough: null,
    });
  }

  // ── Section 02 and the audit work out of step ────────────────────────────
  const activeKeys = new Set(f.activeWorkstreams.map((w) => w.key));
  const requiredKeys = new Set(f.requiredWorkstreams.map((w) => w.key));
  const missing = f.requiredWorkstreams.filter((w) => !activeKeys.has(w.key));
  const extra = f.activeWorkstreams.filter((w) => !requiredKeys.has(w.key));
  if (missing.length > 0 || extra.length > 0) {
    const keys = [...missing.map((w) => `+${w.key}`), ...extra.map((w) => `-${w.key}`)].sort();
    const touches = (k: string) => keys.some((x) => x.slice(1) === k);
    const changeType =
      touches('caro') || touches('ifc')
        ? 'caro_ifc_applicability'
        : touches('cfs')
          ? 'new_subsidiary'
          : 'framework_rule_version_changed';
    const parts = [
      missing.length > 0 &&
        `${named(missing.map((w) => w.title))} now appl${missing.length === 1 ? 'ies' : 'y'} but the audit work has no workstream for it`,
      extra.length > 0 &&
        `${named(extra.map((w) => w.title))} no longer appl${extra.length === 1 ? 'ies' : 'y'} but still has active work`,
    ].filter(Boolean);
    out.push({
      key: `framework:v${f.frameworkVersion ?? 0}:${keys.join(',')}`,
      changeType,
      reason: `Section 02 changed after the work was planned: ${parts.join('; ')}.`,
      facts: [
        ...missing.map((w) => `Required by Section 02, not in the audit work: ${w.title}.`),
        ...extra.map((w) => `In the audit work, no longer required: ${w.title}.`),
        ...(missing.length > 0 ? ['Refresh suggested work adds the missing workstreams.'] : []),
      ],
      scopeAreaIds: extra.map((w) => w.id),
      scopeLabel: scopeLabel(extra),
      followThrough: null,
    });
  }

  // ── A subsidiary while CFS is not applicable ─────────────────────────────
  if (f.investees.length > 0 && f.cfsConclusion === 'not_applicable') {
    out.push({
      key: `cfs:${[...f.investees].sort().join('|')}`,
      changeType: 'new_subsidiary',
      reason: `The client master shows ${named(f.investees)} as subsidiary / associate / joint venture, but Section 02 concludes consolidation (CFS) not applicable. Reassess CFS and component work (SA 600).`,
      facts: [
        `Client master: ${named(f.investees, 5)}.`,
        'Section 02: Consolidation / CFS — not applicable.',
      ],
      scopeAreaIds: [],
      scopeLabel: null,
      followThrough: null,
    });
  }

  // ── Planned completion date moved ────────────────────────────────────────
  const end = f.plannedEndDate;
  if (end) {
    const dated = f.areas.filter((a) => a.dueDate != null);
    const old = [...new Set(dated.map((a) => a.dueDate!))];
    if (old.length === 1 && old[0] !== end) {
      const from = old[0]!;
      const procs = f.procedureDueDates.filter((d) => d === from).length;
      out.push({
        key: `date:${from}->${end}`,
        changeType: 'reporting_date_changed',
        reason: `The planned completion date moved from ${from} to ${end}; ${dated.length} area(s) and ${procs} procedure(s) are still due on ${from}.`,
        facts: [`Planned completion: ${end}.`, `Work still due on the old date: ${from}.`],
        scopeAreaIds: [],
        scopeLabel: null,
        followThrough: `Moves the due dates on ${from} to ${end} (the original date stays in this record).`,
      });
    }
  }
  return out;
}

/** What is left to offer: not raised before (any status) and not dismissed. */
export function openDetections(
  detections: readonly ReassessmentDetection[],
  raisedKeys: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
): ReassessmentDetection[] {
  return detections.filter((d) => !raisedKeys.has(d.key) && !dismissed.has(d.key));
}

/**
 * Progress of an open reassessment: the areas it flagged that have been
 * re-concluded, and whether everything it re-opened is done.
 */
export function reassessmentProgress(input: {
  status: 'open' | 'resolved';
  flaggedAreas: ReadonlyArray<{ concluded: boolean }>;
  phasesStillOpen: number;
}): { progress: { done: number; total: number } | null; readyToResolve: boolean } {
  const total = input.flaggedAreas.length;
  const done = input.flaggedAreas.filter((a) => a.concluded).length;
  return {
    progress: total > 0 ? { done, total } : null,
    readyToResolve: input.status === 'open' && done === total && input.phasesStillOpen === 0,
  };
}
