/**
 * Statutory Audit — Section 07 / 08 completion checklist drafted from the file.
 *
 * Each Completion and Reporting checklist item reads the rest of the audit
 * file — the procedures linked to it, the Section 04 risks, exceptions raised
 * on procedures, 03.3 materiality and the Section 02 framework conclusions —
 * and produces:
 *
 *   • evidence — short plain facts, whether the linked work is all done
 *     (`ready`), where the work is done (`goTo`), and the state the evidence
 *     supports. The suggested state is never `complete`: concluding an item is
 *     the team's judgement. It is `not_applicable` only when the approved
 *     framework says the report does not apply.
 *   • a draft note — the conclusion wording, including a draft completion
 *     memo, written from the same facts for the team to edit.
 *
 * Pure: no database, unit-tested on its own.
 */
import type {
  CompletionGoTo,
  CompletionItemEvidence,
  CompletionItemState,
  FrameworkConclusion,
} from '@hsdg/contracts';

export interface CompletionProcedure {
  ref: string;
  title: string;
  state: 'not_started' | 'in_progress' | 'ready_for_review' | 'returned' | 'complete';
  sourceKey: string | null;
  riskId: string | null;
  workAreaKey: string;
  workAreaTitle: string;
}

export interface CompletionArea {
  key: string;
  title: string;
  concluded: boolean;
}

export interface CompletionRisk {
  id: string;
  ref: string;
  description: string;
  fsArea: string | null;
  sourceKey: string | null;
  isSignificant: boolean;
  status: string;
}

export interface CompletionException {
  status: 'open' | 'resolved' | 'carried_forward';
  severity: 'low' | 'medium' | 'high';
  description: string;
  procedureRef: string;
}

export interface CompletionFacts {
  /** Engagement financial year, e.g. `2024-25`. */
  financialYear: string | null;
  framework: ReadonlyMap<string, { conclusion: FrameworkConclusion | null; basis: string | null }>;
  /** Active audit work areas. */
  areas: readonly CompletionArea[];
  procedures: readonly CompletionProcedure[];
  risks: readonly CompletionRisk[];
  exceptions: readonly CompletionException[];
  materiality: { om: number | null; pm: number | null; ctt: number | null } | null;
}

export interface PlannedCompletionItem {
  evidence: CompletionItemEvidence;
  draftNote: string | null;
}

const WORK: CompletionGoTo = { phaseKey: 'audit_areas', label: 'Open audit work' };
const RISK: CompletionGoTo = { phaseKey: 'risk', label: 'Open risk register' };
const FRAMEWORK: CompletionGoTo = { phaseKey: 'framework', label: 'Open Section 02 framework' };

/** Section 02 areas whose reports / certificates fall under "Other reports". */
const OTHER_REPORT_AREAS: ReadonlyArray<[string, string]> = [
  ['cost_records', 'Cost records / cost audit'],
  ['secretarial_audit', 'Secretarial audit'],
  ['csr', 'CSR / governance matters'],
  ['other_regulatory', 'Other regulatory / industry requirements'],
];

const MAX_LISTED = 4;

/** `2024-25` → `31 March 2025`; anything else → `the period end`. */
export function periodEndLabel(financialYear: string | null): string {
  const m = /^(\d{4})-(\d{2}|\d{4})$/.exec(financialYear ?? '');
  if (!m) return 'the period end';
  const end = m[2]!.length === 2 ? `${m[1]!.slice(0, 2)}${m[2]}` : m[2]!;
  return `31 March ${end}`;
}

export function money(n: number | null | undefined): string | null {
  return n == null ? null : `₹${n.toLocaleString('en-IN')}`;
}

function refs(procs: readonly CompletionProcedure[]): string {
  return procs.map((p) => p.ref).join(', ');
}

/** Summary + per-procedure lines, the suggested state and readiness. */
function progress(
  procs: readonly CompletionProcedure[],
  none: string,
): { facts: string[]; state: CompletionItemState; ready: boolean } {
  if (procs.length === 0) return { facts: [none], state: 'not_started', ready: false };
  const done = procs.filter((p) => p.state === 'complete').length;
  const facts = [`${done} of ${procs.length} linked procedure(s) complete.`];
  for (const p of procs.slice(0, MAX_LISTED)) {
    facts.push(`${p.ref} ${p.title} — ${p.state.replace(/_/g, ' ')}`);
  }
  if (procs.length > MAX_LISTED) facts.push(`+${procs.length - MAX_LISTED} more`);
  const started = procs.some((p) => p.state !== 'not_started');
  return { facts, state: started ? 'in_progress' : 'not_started', ready: done === procs.length };
}

function evidence(
  facts: string[],
  suggestedState: CompletionItemState,
  ready: boolean,
  goTo: CompletionGoTo | null,
): CompletionItemEvidence {
  return { facts, suggestedState, ready, goTo };
}

/** A report item driven by one Section 02 applicability conclusion. */
function reportItem(
  f: CompletionFacts,
  areaKey: string,
  name: string,
  procs: readonly CompletionProcedure[],
  applicableNote: string,
): PlannedCompletionItem {
  const fw = f.framework.get(areaKey);
  if (fw?.conclusion === 'not_applicable') {
    const basis = fw.basis?.trim();
    return {
      evidence: evidence(
        [`Section 02: ${name} not applicable${basis ? ` — ${basis}` : '.'}`],
        'not_applicable',
        true,
        FRAMEWORK,
      ),
      draftNote: `Not applicable — Section 02 framework${basis ? `: ${basis}` : '.'}`,
    };
  }
  if (fw?.conclusion !== 'applicable') {
    return {
      evidence: evidence(
        [`Section 02: ${name} applicability is not yet concluded.`],
        'not_started',
        false,
        FRAMEWORK,
      ),
      draftNote: null,
    };
  }
  const p = progress(procs, `No ${name} procedure in the audit work yet.`);
  return {
    evidence: evidence([`Section 02: ${name} applicable.`, ...p.facts], p.state, p.ready, WORK),
    draftNote: procs.length ? `${applicableNote} Work performed: ${refs(procs)}.` : applicableNote,
  };
}

/** Plan every completion / reporting item from the file. Keyed by item key. */
export function planCompletionItems(f: CompletionFacts): Map<string, PlannedCompletionItem> {
  const out = new Map<string, PlannedCompletionItem>();
  const procs = f.procedures;
  const by = (test: (p: CompletionProcedure) => boolean) => procs.filter(test);
  const periodEnd = periodEndLabel(f.financialYear);
  const ctt = money(f.materiality?.ctt);
  const pm = money(f.materiality?.pm);
  const om = money(f.materiality?.om);
  const matLine =
    ctt || pm || om
      ? `03.3 materiality: ${[om && `OM ${om}`, pm && `PM ${pm}`, ctt && `clearly trivial ${ctt}`]
          .filter(Boolean)
          .join(' · ')}.`
      : '03.3 materiality is not yet determined.';

  // ── Completion (07) ───────────────────────────────────────────────────────
  {
    const linked = by(
      (p) =>
        p.sourceKey === 'std:overall_responses:subsequent_events' ||
        /subsequent/i.test(p.workAreaTitle) ||
        /subsequent event/i.test(p.title),
    );
    const p = progress(linked, 'No subsequent-events procedure in the audit work yet.');
    out.set('subsequent_events', {
      evidence: evidence(p.facts, p.state, p.ready, WORK),
      draftNote:
        `SA 560 — events after ${periodEnd} up to the date of the auditor's report reviewed` +
        (linked.length ? ` (${refs(linked)})` : '') +
        ` for adjustment or disclosure. Written representation to be obtained (SA 580).`,
    });
  }

  {
    const gc = /going concern/i;
    const risks = f.risks.filter(
      (r) =>
        gc.test(r.description) ||
        gc.test(r.fsArea ?? '') ||
        /going_concern/.test(r.sourceKey ?? ''),
    );
    const riskIds = new Set(risks.map((r) => r.id));
    const linked = by((p) => (p.riskId != null && riskIds.has(p.riskId)) || gc.test(p.title));
    const facts = risks.length
      ? risks.map(
          (r) => `Section 04: ${r.ref} ${r.description}${r.isSignificant ? ' (significant)' : ''}`,
        )
      : ['Section 04: no going-concern risk identified.'];
    const p = progress(linked, 'No going-concern procedure in the audit work.');
    const allConcluded = f.areas.length > 0 && f.areas.every((a) => a.concluded);
    out.set('going_concern', {
      evidence: evidence(
        [...facts, ...(linked.length || risks.length ? p.facts : [])],
        p.state,
        linked.length ? p.ready : risks.length === 0 && allConcluded,
        RISK,
      ),
      draftNote: risks.length
        ? `Going-concern risk ${risks.map((r) => r.ref).join(', ')} identified in Section 04` +
          (linked.length ? `; responses ${refs(linked)}` : '') +
          `. Conclude on management's assessment, its plans and the adequacy of disclosure (SA 570).`
        : `No events or conditions casting significant doubt on the entity's ability to continue as a going concern were identified in the risk assessment (Section 04). Reassessed at completion; management's assessment and written representations obtained (SA 570).`,
    });
  }

  {
    const ex = f.exceptions;
    const open = ex.filter((e) => e.status === 'open');
    const carried = ex.filter((e) => e.status === 'carried_forward');
    const resolved = ex.length - open.length - carried.length;
    const facts = ex.length
      ? [
          `${ex.length} exception(s) raised on procedures — ${open.length} open, ${carried.length} carried forward, ${resolved} resolved.`,
        ]
      : ['No exceptions raised on procedures.'];
    if (open.length)
      facts.push('Resolve or carry forward the open exception(s) before concluding.');
    facts.push(matLine);
    const allDone = procs.length > 0 && procs.every((p) => p.state === 'complete');
    const list = carried
      .map((e) => `• ${e.procedureRef}: ${e.description} (${e.severity})`)
      .join('\n');
    out.set('misstatements', {
      evidence: evidence(
        facts,
        ex.length ? 'in_progress' : 'not_started',
        open.length === 0 && allDone,
        WORK,
      ),
      draftNote: carried.length
        ? `Uncorrected misstatements carried forward from the procedures:\n${list}\n` +
          `Aggregate compared with materiality${om ? ` (OM ${om})` : ''}; communicated to those charged with governance and management's representation obtained (SA 450).`
        : `No misstatements carried forward from the procedures${ctt ? ` above the clearly trivial threshold of ${ctt}` : ''} (SA 450).`,
    });
  }

  {
    const linked = by(
      (p) =>
        p.sourceKey === 'std:overall_responses:final_analytics' ||
        /analytic/i.test(p.workAreaTitle) ||
        /final analytic/i.test(p.title),
    );
    const p = progress(linked, 'No final analytical review procedure in the audit work yet.');
    out.set('final_analytics', {
      evidence: evidence(p.facts, p.state, p.ready, WORK),
      draftNote:
        `Final analytical review performed near the end of the audit (SA 520)` +
        (linked.length ? ` in ${refs(linked)}` : '') +
        `; the financial statements are consistent with our understanding of the entity.`,
    });
  }

  const concluded = f.areas.filter((a) => a.concluded).length;
  const procsDone = procs.filter((p) => p.state === 'complete').length;
  {
    const facts = [
      `${concluded} of ${f.areas.length} audit area(s) concluded.`,
      `${procsDone} of ${procs.length} procedure(s) complete.`,
    ];
    const open = f.areas.filter((a) => !a.concluded);
    if (open.length) {
      facts.push(
        `Not yet concluded: ${open
          .slice(0, MAX_LISTED)
          .map((a) => a.title)
          .join(', ')}${open.length > MAX_LISTED ? ` +${open.length - MAX_LISTED} more` : ''}.`,
      );
    }
    const started = concluded > 0 || procs.some((p) => p.state !== 'not_started');
    out.set('fs_final_review', {
      evidence: evidence(
        facts,
        started ? 'in_progress' : 'not_started',
        f.areas.length > 0 && open.length === 0,
        WORK,
      ),
      draftNote: `Final financial statements agreed to the trial balance and the audited figures; ${concluded} of ${f.areas.length} audit areas concluded and ${procsDone} of ${procs.length} procedures complete.`,
    });
  }

  {
    const linked = by(
      (p) =>
        p.workAreaKey === 'ind_as_review' ||
        p.workAreaKey === 'schedule_iii_work' ||
        /:(rpt|disclosure|presentation)$/.test(p.sourceKey ?? ''),
    );
    const fwFacts: string[] = [];
    const indAs = f.framework.get('ind_as_as')?.conclusion;
    const sch3 = f.framework.get('schedule_iii')?.conclusion;
    if (indAs)
      fwFacts.push(`Section 02: Ind AS ${indAs === 'applicable' ? 'applies' : 'does not apply'}.`);
    if (sch3)
      fwFacts.push(
        `Section 02: Schedule III ${sch3 === 'applicable' ? 'applies' : 'does not apply'}.`,
      );
    const p = progress(linked, 'No disclosure procedure in the audit work yet.');
    const framework = indAs === 'applicable' ? 'Ind AS' : 'the applicable Accounting Standards';
    out.set('disclosure_review', {
      evidence: evidence([...fwFacts, ...p.facts], p.state, p.ready, WORK),
      draftNote:
        `Presentation and disclosures reviewed against ${framework}` +
        (sch3 === 'applicable' ? ' and Schedule III' : '') +
        (linked.length ? ` (${refs(linked)})` : '') +
        `, including related-party disclosures.`,
    });
  }

  // ── Reporting (08) ────────────────────────────────────────────────────────
  const reporting = by(
    (p) =>
      p.workAreaKey === 'auditor_reporting' || /^std:auditor_reporting:/.test(p.sourceKey ?? ''),
  );
  const annexures: string[] = [];
  if (f.framework.get('caro')?.conclusion === 'applicable')
    annexures.push('CARO 2020 (Annexure A)');
  if (f.framework.get('ifc')?.conclusion === 'applicable') annexures.push('IFC (Annexure B)');
  {
    const p = progress(reporting, "No auditor's report procedure in the audit work yet.");
    out.set('auditors_report', {
      evidence: evidence(
        [
          ...p.facts,
          annexures.length
            ? `Annexures from Section 02: ${annexures.join(', ')}.`
            : 'No CARO / IFC annexure required by Section 02.',
        ],
        p.state,
        p.ready,
        WORK,
      ),
      draftNote:
        `Auditor's report prepared under SA 700 with the Section 143(3) matters and Rule 11 clauses` +
        (annexures.length ? `, with ${annexures.join(' and ')}` : '') +
        `, consistent with the work performed and the conclusions in the file.`,
    });
  }

  out.set(
    'caro',
    reportItem(
      f,
      'caro',
      'CARO 2020',
      by((p) => p.workAreaKey === 'caro'),
      'CARO 2020 report prepared clause by clause (3(i)–3(xxi)) from the working papers.',
    ),
  );
  out.set(
    'ifc',
    reportItem(
      f,
      'ifc',
      'IFC reporting',
      by((p) => p.workAreaKey === 'ifc'),
      'IFC report under Section 143(3)(i) prepared from the controls testing and the deficiency evaluation.',
    ),
  );

  {
    const r11 = f.framework.get('rule_11');
    const s143 = f.framework.get('section_143');
    if (r11?.conclusion === 'not_applicable' && s143?.conclusion === 'not_applicable') {
      out.set('rule_11_143', {
        evidence: evidence(
          ['Section 02: Rule 11 and Section 143 reporting not applicable.'],
          'not_applicable',
          true,
          FRAMEWORK,
        ),
        draftNote: 'Not applicable — Section 02 framework.',
      });
    } else {
      const p = progress(reporting, 'No Section 143 / Rule 11 procedure in the audit work yet.');
      out.set('rule_11_143', {
        evidence: evidence(p.facts, p.state, p.ready, WORK),
        draftNote:
          `Section 143(3) matters and Rule 11 clauses (audit trail, pending litigations, foreseeable losses, IEPF, funding and dividend representations) reported` +
          (reporting.length ? ` from ${refs(reporting)}` : '') +
          '.',
      });
    }
  }

  {
    const assessed = OTHER_REPORT_AREAS.map(([key, name]) => ({
      name,
      conclusion: f.framework.get(key)?.conclusion ?? null,
    }));
    const applicable = assessed.filter((a) => a.conclusion === 'applicable');
    const allDecided = assessed.every((a) => a.conclusion != null);
    if (applicable.length) {
      out.set('other_reports', {
        evidence: evidence(
          [`Section 02 applicable: ${applicable.map((a) => a.name).join(', ')}.`],
          'not_started',
          false,
          FRAMEWORK,
        ),
        draftNote: `Other reports / certificates to issue: ${applicable.map((a) => a.name).join(', ')}.`,
      });
    } else if (allDecided) {
      out.set('other_reports', {
        evidence: evidence(
          ['Section 02: no other reports or certificates required.'],
          'not_applicable',
          true,
          FRAMEWORK,
        ),
        draftNote:
          'Not applicable — no other reports or certificates required (Section 02 framework).',
      });
    } else {
      out.set('other_reports', {
        evidence: evidence(
          ['Section 02: other reporting requirements are not yet concluded.'],
          'not_started',
          false,
          FRAMEWORK,
        ),
        draftNote: null,
      });
    }
  }

  // ── Completion memo — drafted last, from everything above ─────────────────
  {
    const others = [
      'subsequent_events',
      'going_concern',
      'misstatements',
      'final_analytics',
      'fs_final_review',
      'disclosure_review',
    ].map((k) => out.get(k)!);
    const sig = f.risks.filter((r) => r.isSignificant).length;
    const responded = f.risks.filter((r) => procs.some((p) => p.riskId === r.id)).length;
    const carried = f.exceptions.filter((e) => e.status === 'carried_forward').length;
    const reportingLine = [
      'CARO',
      f.framework.get('caro')?.conclusion === 'applicable' ? 'applicable' : 'not applicable',
      '· IFC',
      f.framework.get('ifc')?.conclusion === 'applicable' ? 'applicable' : 'not applicable',
    ].join(' ');
    const memo = [
      `Completion memo — financial year ${f.financialYear ?? ''} (period ended ${periodEnd}).`,
      matLine,
      `Risks: ${f.risks.length} identified in Section 04 (${sig} significant); ${responded} with a linked response.`,
      `Work: ${concluded} of ${f.areas.length} audit areas concluded; ${procsDone} of ${procs.length} procedures complete.`,
      `Misstatements: ${carried} carried forward from the procedures.`,
      `Reporting: ${reportingLine}.`,
      'Overall conclusion: sufficient appropriate audit evidence has been obtained to support the opinion.',
    ].join('\n');
    const anyStarted = others.some((o) => o.evidence.suggestedState === 'in_progress');
    out.set('completion_memo', {
      evidence: evidence(
        ['Memo drafted from the file — review and edit before approving completion.'],
        anyStarted ? 'in_progress' : 'not_started',
        others.every((o) => o.evidence.ready),
        null,
      ),
      draftNote: memo,
    });
  }

  return out;
}
