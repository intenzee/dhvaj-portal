import type { PriorYearMatterType } from '@hsdg/contracts';

/**
 * 03.1.6 Prior-year intelligence from last year's audit file (Guide §1,
 * capture once): the matters the team would otherwise retype — significant
 * risks, Areas of Focus, blocking review points and high-severity exceptions —
 * are brought forward for this year's reassessment. Pure: the service reads
 * last year's records and inserts what this plans. Each matter keeps a stable
 * `sourceRef`, so re-importing never duplicates one. The reassessment itself
 * (still relevant / changed / resolved) is always the team's.
 */

export interface PriorYearSources {
  financialYear: string;
  risks: Array<{
    id: string;
    ref: string;
    description: string;
    fsArea: string | null;
    isFraudRisk: boolean;
    response: string | null;
  }>;
  focusAreas: Array<{
    id: string;
    name: string;
    why: string | null;
    partnerAttention: boolean;
  }>;
  blockingNotes: Array<{ id: string; body: string; status: string }>;
  exceptions: Array<{ id: string; description: string; severity: string; status: string }>;
}

export interface PlannedPriorYearMatter {
  sourceRef: string;
  matterType: PriorYearMatterType;
  description: string;
  sourceEvidence: string;
}

const clip = (s: string, n = 600) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function priorYearMattersFromFile(src: PriorYearSources): PlannedPriorYearMatter[] {
  const fy = `FY ${src.financialYear} audit file`;
  const out: PlannedPriorYearMatter[] = [];
  for (const r of src.risks) {
    out.push({
      sourceRef: `risk:${r.id}`,
      matterType: 'significant_risk',
      description: clip(
        `${r.isFraudRisk ? 'Significant (fraud) risk' : 'Significant risk'}${r.fsArea ? ` — ${r.fsArea}` : ''}: ${r.description.trim()}`,
      ),
      sourceEvidence: `${fy} — risk register ${r.ref}${r.response ? `; response: ${clip(r.response.trim(), 200)}` : ''}`,
    });
  }
  for (const f of src.focusAreas) {
    out.push({
      sourceRef: `focus:${f.id}`,
      matterType: 'partner_focus_area',
      description: clip(`${f.name.trim()}${f.why ? ` — ${f.why.trim()}` : ''}`),
      sourceEvidence: `${fy} — Area of Focus${f.partnerAttention ? ' (Partner attention)' : ''}`,
    });
  }
  for (const n of src.blockingNotes) {
    out.push({
      sourceRef: `note:${n.id}`,
      matterType: 'major_review_point',
      description: clip(n.body.trim()),
      sourceEvidence: `${fy} — blocking review note (${n.status.replace(/_/g, ' ')})`,
    });
  }
  for (const e of src.exceptions) {
    out.push({
      sourceRef: `exception:${e.id}`,
      matterType: 'major_review_point',
      description: clip(e.description.trim()),
      sourceEvidence: `${fy} — ${e.severity}-severity exception (${e.status.replace(/_/g, ' ')})`,
    });
  }
  return out;
}

// ── 03.2 carry-forward ───────────────────────────────────────────────────────

export interface PriorSection {
  key: string;
  answers: Record<string, unknown>;
}

/**
 * The 03.2 sections to seed: for every section the team has not saved yet,
 * last year's answers as the base with this year's master-derived answers on
 * top (the master is current; last year's file covers the rest). "Anything
 * changed?" is left for the team to answer.
 */
export function mergePriorSections<A>(
  planned: ReadonlyArray<{ key: string; answers: Record<string, A> }>,
  prior: readonly PriorSection[],
  saved: ReadonlySet<string>,
): Array<{ key: string; answers: Record<string, unknown>; fromPriorYear: boolean }> {
  const byKey = new Map<
    string,
    { key: string; answers: Record<string, unknown>; fromPriorYear: boolean }
  >();
  for (const p of prior) {
    if (saved.has(p.key) || Object.keys(p.answers ?? {}).length === 0) continue;
    byKey.set(p.key, { key: p.key, answers: { ...p.answers }, fromPriorYear: true });
  }
  for (const p of planned) {
    if (saved.has(p.key)) continue;
    const base = byKey.get(p.key);
    byKey.set(p.key, {
      key: p.key,
      answers: { ...(base?.answers ?? {}), ...p.answers },
      fromPriorYear: base != null,
    });
  }
  return [...byKey.values()];
}

/**
 * Last year's current-year figures become this year's prior-year column,
 * converted into this year's units. Only figures not yet recorded are planned.
 */
export function priorYearValues(
  priorCy: ReadonlyArray<{ metricKey: string; amount: number }>,
  factors: { priorUnits: number; targetUnits: number },
  recorded: ReadonlySet<string>,
): Array<{ metricKey: string; amount: number }> {
  return priorCy
    .filter((v) => !recorded.has(`${v.metricKey}:py`) && Number.isFinite(v.amount))
    .map((v) => ({
      metricKey: v.metricKey,
      amount: Math.round(((v.amount * factors.priorUnits) / factors.targetUnits) * 100) / 100,
    }));
}
