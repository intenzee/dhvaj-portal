/**
 * Statutory Audit — Sections 05 / 06 audit work, drafted from the file.
 *
 * Neither section has an approval of its own: the work is finished when every
 * procedure is complete, every exception dealt with, every significant risk
 * answered by a completed procedure and every area's conclusion submitted —
 * what Completion (07) then relies on. The pack says what is still open, with
 * the facts and a link to the area it sits in, and what is worth knowing
 * (conclusions awaiting review, procedures with no evidence, blank owners,
 * overdue areas).
 *
 * Each area's conclusion is drafted from its procedures — what was done, the
 * exceptions and how they were dealt with — and recorded when the area is
 * submitted with the conclusion left blank.
 *
 *   05 Controls   — the IFC and internal-audit-reliance workstreams only.
 *   06 Audit work — every active area, plus the significant risks (§29).
 *
 * Pure: no database, unit-tested on its own.
 */
import type {
  AreaConclusionState,
  CompletionGoTo,
  ExceptionStatus,
  ProcedureState,
  SectionPack,
  SignOffCheck,
} from '@hsdg/contracts';
import { money } from './completion-automation';
import { check, listed, pack } from './section-packs';

/** The workstreams Section 05 (Internal Controls / IFC) covers. */
export const CONTROLS_WORK_AREA_KEYS: readonly string[] = ['ifc', 'internal_audit_reliance'];

export interface WorkPackArea {
  id: string;
  workAreaKey: string;
  title: string;
  isActive: boolean;
  ownerName: string | null;
  reviewerName: string | null;
  dueDate: string | null;
  materiality: number | null;
  conclusion: string | null;
  conclusionState: AreaConclusionState;
  reviewed: boolean;
}

export interface WorkPackException {
  description: string;
  status: ExceptionStatus;
  resolution: string | null;
}

export interface WorkPackProcedure {
  ref: string;
  title: string;
  state: ProcedureState;
  conclusion: string | null;
  /** Home area first, then the areas it is linked to (§14). */
  areaIds: string[];
  riskId: string | null;
  evidenceCount: number;
  exceptions: WorkPackException[];
}

export interface WorkPackRisk {
  id: string;
  riskRef: string;
  description: string;
  isSignificant: boolean;
}

export interface WorkPackFacts {
  frameworkApproved: boolean;
  areas: WorkPackArea[];
  procedures: WorkPackProcedure[];
  risks: WorkPackRisk[];
  /** Today, 'YYYY-MM-DD'. */
  today: string;
}

const STATE_LABEL: Record<ProcedureState, string> = {
  not_started: 'not started',
  in_progress: 'in progress',
  ready_for_review: 'ready for review',
  returned: 'returned by the reviewer',
  complete: 'complete',
};

const areaAnchor = (a: WorkPackArea, phaseKey: string): CompletionGoTo => ({
  phaseKey,
  label: `Open ${a.title}`,
  anchor: `area-${a.id}`,
});

/** The procedures that support an area (home or linked). */
export function proceduresIn(
  areaId: string,
  procedures: readonly WorkPackProcedure[],
): WorkPackProcedure[] {
  return procedures.filter((p) => p.areaIds.includes(areaId));
}

/**
 * An area's conclusion drafted from its procedures, or null when it has none.
 * While procedures are open the last line says so instead of concluding.
 */
export function draftAreaConclusion(
  area: Pick<WorkPackArea, 'title' | 'materiality'>,
  procedures: readonly WorkPackProcedure[],
): string | null {
  if (procedures.length === 0) return null;
  const lines = [`${area.title} — procedures performed:`];
  for (const p of procedures) {
    lines.push(`• ${p.ref} ${p.title}: ${p.conclusion?.trim() || 'conclusion not yet recorded.'}`);
  }
  const exceptions = procedures.flatMap((p) => p.exceptions);
  if (exceptions.length === 0) {
    lines.push('Exceptions: none identified.');
  } else {
    lines.push('Exceptions:');
    for (const x of exceptions) {
      lines.push(
        x.status === 'resolved'
          ? `• ${x.description} — resolved${x.resolution ? `: ${x.resolution}` : '.'}`
          : x.status === 'carried_forward'
            ? `• ${x.description} — carried forward to completion.`
            : `• ${x.description} — open.`,
      );
    }
  }
  const pm = money(area.materiality);
  if (pm) lines.push(`Materiality applied: ${pm}.`);
  const open = procedures.filter((p) => p.state !== 'complete').length;
  if (open > 0) {
    lines.push(`Conclusion: not yet reached — ${open} procedure(s) still open.`);
  } else {
    const carried = exceptions.some((x) => x.status === 'carried_forward');
    lines.push(
      `Conclusion: based on the procedures performed, sufficient appropriate evidence has been obtained and no material misstatement was identified in ${area.title}.` +
        (carried ? ' Exceptions carried forward are evaluated at completion.' : ''),
    );
  }
  return lines.join('\n');
}

/** Whether an area's drafted conclusion is final (every procedure complete). */
export function conclusionReady(procedures: readonly WorkPackProcedure[]): boolean {
  return procedures.length > 0 && procedures.every((p) => p.state === 'complete');
}

/**
 * What finishing the work in Section 05 (`controls`) or 06 (`audit_areas`)
 * needs. Section 05 with no controls workstream is simply not applicable.
 */
export function planWork(f: WorkPackFacts, phaseKey: 'controls' | 'audit_areas'): SectionPack {
  const controls = phaseKey === 'controls';
  const areas = f.areas.filter(
    (a) => a.isActive && (!controls || CONTROLS_WORK_AREA_KEYS.includes(a.workAreaKey)),
  );
  const areaIds = new Set(areas.map((a) => a.id));
  const procs = f.procedures.filter((p) => p.areaIds.some((id) => areaIds.has(id)));
  const areaOf = (p: WorkPackProcedure): WorkPackArea =>
    areas.find((a) => a.id === p.areaIds.find((id) => areaIds.has(id)))!;
  const checks: SignOffCheck[] = [];

  // The work exists.
  if (!f.frameworkApproved) {
    checks.push(
      check(
        'work_built',
        'Audit work built from the approved framework',
        false,
        true,
        ['The framework (Section 02) is not approved yet — the work builds itself once it is.'],
        { phaseKey: 'framework', label: 'Open Section 02 framework' },
      ),
    );
    return pack(checks, null);
  }
  if (areas.length === 0) {
    checks.push(
      controls
        ? check(
            'work_built',
            'Controls workstream',
            true,
            true,
            [
              'IFC reporting and internal-audit reliance are not applicable in the framework — nothing to do here.',
            ],
            { phaseKey: 'framework', label: 'Open Section 02 framework' },
          )
        : check(
            'work_built',
            'Audit work built from the approved framework',
            false,
            true,
            ['No work areas yet — the partner or manager opening this builds them.'],
            { phaseKey: 'audit_areas', label: 'Open audit work' },
          ),
    );
    return pack(checks, null);
  }

  // Every procedure complete.
  const open = procs.filter((p) => p.state !== 'complete');
  checks.push(
    check(
      'procedures_complete',
      'Every procedure complete',
      open.length === 0,
      true,
      procs.length === 0
        ? ['No procedures recorded yet.']
        : [
            `${procs.length - open.length} of ${procs.length} procedure(s) complete${open.length ? '; still open:' : '.'}`,
            ...listed(
              open.map((p) => `${p.ref} ${p.title} — ${STATE_LABEL[p.state]} (${areaOf(p).title})`),
            ),
          ],
      open[0] ? areaAnchor(areaOf(open[0]), phaseKey) : { phaseKey, label: 'Open audit work' },
    ),
  );

  // Every exception dealt with.
  const openX = procs.flatMap((p) =>
    p.exceptions.filter((x) => x.status === 'open').map((x) => ({ p, x })),
  );
  checks.push(
    check(
      'exceptions',
      'Exceptions resolved or carried forward',
      openX.length === 0,
      true,
      openX.length === 0
        ? ['No open exceptions.']
        : [
            `${openX.length} open exception(s):`,
            ...listed(openX.map(({ p, x }) => `${p.ref}: ${x.description}`)),
          ],
      openX[0] ? areaAnchor(areaOf(openX[0].p), phaseKey) : { phaseKey, label: 'Open audit work' },
    ),
  );

  // Every significant risk answered by a completed procedure (§29).
  if (!controls) {
    const significant = f.risks.filter((r) => r.isSignificant);
    const untested = significant.filter(
      (r) => !procs.some((p) => p.riskId === r.id && p.state === 'complete'),
    );
    const first = untested[0];
    const firstProc = first ? procs.find((p) => p.riskId === first.id) : undefined;
    checks.push(
      check(
        'significant_risks',
        'Each significant risk answered by a completed procedure',
        untested.length === 0,
        true,
        significant.length === 0
          ? ['No significant risks in the register.']
          : untested.length === 0
            ? [`All ${significant.length} significant risk(s) tested.`]
            : [
                `${untested.length} of ${significant.length} significant risk(s) not yet tested:`,
                ...listed(
                  untested.map((r) =>
                    procs.some((p) => p.riskId === r.id)
                      ? `${r.riskRef} ${r.description} — procedure not complete`
                      : `${r.riskRef} ${r.description} — no procedure`,
                  ),
                ),
              ],
        firstProc
          ? areaAnchor(areaOf(firstProc), phaseKey)
          : {
              phaseKey: 'risk',
              label: 'Open risk register',
              anchor: first ? `risk-${first.id}` : undefined,
            },
      ),
    );
  }

  // Every area's conclusion submitted.
  const unsubmitted = areas.filter((a) => a.conclusionState !== 'submitted');
  checks.push(
    check(
      'conclusions_submitted',
      'Each area concluded and submitted for review',
      unsubmitted.length === 0,
      true,
      unsubmitted.length === 0
        ? [`All ${areas.length} area conclusion(s) submitted.`]
        : [
            `${areas.length - unsubmitted.length} of ${areas.length} area(s) submitted; still to conclude:`,
            ...listed(
              unsubmitted.map((a) => {
                const ps = proceduresIn(a.id, procs);
                const left = ps.filter((p) => p.state !== 'complete').length;
                return ps.length === 0
                  ? `${a.title} — no procedures`
                  : left > 0
                    ? `${a.title} — ${left} procedure(s) open`
                    : `${a.title} — conclusion drafted, ready to submit`;
              }),
            ),
          ],
      unsubmitted[0]
        ? areaAnchor(unsubmitted[0], phaseKey)
        : { phaseKey, label: 'Open audit work' },
    ),
  );

  // Worth knowing.
  const awaiting = areas.filter((a) => a.conclusionState === 'submitted' && !a.reviewed);
  checks.push(
    check(
      'conclusions_reviewed',
      'Area conclusions reviewed',
      awaiting.length === 0,
      false,
      awaiting.length === 0
        ? ['No conclusion is waiting for review.']
        : [
            `${awaiting.length} submitted conclusion(s) awaiting review:`,
            ...listed(awaiting.map((a) => a.title)),
          ],
      { phaseKey: 'review', label: 'Open review' },
    ),
  );

  const empty = areas.filter((a) => proceduresIn(a.id, procs).length === 0);
  checks.push(
    check(
      'areas_without_procedures',
      'Every area has procedures',
      empty.length === 0,
      false,
      empty.length === 0
        ? ['Every area has at least one procedure.']
        : [`${empty.length} area(s) with no procedure:`, ...listed(empty.map((a) => a.title))],
      empty[0] ? areaAnchor(empty[0], phaseKey) : { phaseKey, label: 'Open audit work' },
    ),
  );

  const unevidenced = procs.filter((p) => p.state === 'complete' && p.evidenceCount === 0);
  checks.push(
    check(
      'evidence',
      'Completed procedures carry evidence',
      unevidenced.length === 0,
      false,
      unevidenced.length === 0
        ? ['Every completed procedure has evidence linked.']
        : [
            `${unevidenced.length} completed procedure(s) with no evidence linked:`,
            ...listed(unevidenced.map((p) => `${p.ref} ${p.title}`)),
          ],
      unevidenced[0]
        ? areaAnchor(areaOf(unevidenced[0]), phaseKey)
        : { phaseKey, label: 'Open audit work' },
    ),
  );

  const unowned = areas.filter((a) => !a.ownerName || !a.reviewerName);
  const overdue = areas.filter(
    (a) => a.dueDate != null && a.dueDate < f.today && a.conclusionState !== 'submitted',
  );
  const detailFacts = [
    ...unowned.map(
      (a) =>
        `${a.title} — no ${[!a.ownerName ? 'owner' : null, !a.reviewerName ? 'reviewer' : null]
          .filter(Boolean)
          .join(', ')}`,
    ),
    ...overdue.map((a) => `${a.title} — due ${a.dueDate}, not yet concluded`),
  ];
  const firstDetail = unowned[0] ?? overdue[0];
  checks.push(
    check(
      'area_details',
      'Owners, reviewers and due dates',
      detailFacts.length === 0,
      false,
      detailFacts.length === 0
        ? ['Every area has an owner and a reviewer, and none is overdue.']
        : listed(detailFacts),
      firstDetail ? areaAnchor(firstDetail, phaseKey) : { phaseKey, label: 'Open audit work' },
    ),
  );

  return pack(checks, null);
}
