import type { IcfrReportingSummary } from '@hsdg/contracts';
import {
  periodEndLabel,
  planCompletionItems,
  type CompletionFacts,
  type CompletionProcedure,
} from './completion-automation';

const proc = (o: Partial<CompletionProcedure> & { ref: string }): CompletionProcedure => ({
  title: 'Procedure',
  state: 'not_started',
  sourceKey: null,
  riskId: null,
  workAreaKey: 'overall_responses',
  workAreaTitle: 'Overall responses',
  ...o,
});

const facts = (o: Partial<CompletionFacts> = {}): CompletionFacts => ({
  financialYear: '2024-25',
  framework: new Map([
    ['caro', { conclusion: 'applicable', basis: null }],
    ['ifc', { conclusion: 'not_applicable', basis: 'Private company below thresholds.' }],
    ['rule_11', { conclusion: 'applicable', basis: null }],
    ['section_143', { conclusion: 'applicable', basis: null }],
    ['cost_records', { conclusion: 'not_applicable', basis: null }],
    ['secretarial_audit', { conclusion: 'not_applicable', basis: null }],
    ['csr', { conclusion: 'not_applicable', basis: null }],
    ['other_regulatory', { conclusion: 'not_applicable', basis: null }],
  ]),
  areas: [
    { key: 'caro', title: 'CARO', concluded: false },
    { key: 'fs_rev', title: 'Revenue', concluded: true },
  ],
  procedures: [],
  risks: [],
  exceptions: [],
  materiality: { om: 100000, pm: 75000, ctt: 5000 },
  ...o,
});

describe('completion automation', () => {
  it('derives the period end from the financial year', () => {
    expect(periodEndLabel('2024-25')).toBe('31 March 2025');
    expect(periodEndLabel('2099-2100')).toBe('31 March 2100');
    expect(periodEndLabel(null)).toBe('the period end');
  });

  it('marks reports the framework rules out as not applicable, with the basis', () => {
    const plan = planCompletionItems(facts());
    expect(plan.get('ifc')?.evidence.suggestedState).toBe('not_applicable');
    expect(plan.get('ifc')?.draftNote).toBe(
      'Not applicable — Section 02 framework: Private company below thresholds.',
    );
    expect(plan.get('other_reports')?.evidence.suggestedState).toBe('not_applicable');
    expect(plan.get('caro')?.evidence.suggestedState).toBe('not_started');
    expect(plan.get('caro')?.evidence.goTo?.phaseKey).toBe('audit_areas');
  });

  it('follows the linked procedures and never suggests complete', () => {
    const plan = planCompletionItems(
      facts({
        procedures: [
          proc({
            ref: 'P-01',
            title: 'Subsequent events review (SA 560)',
            sourceKey: 'std:overall_responses:subsequent_events',
            state: 'complete',
          }),
          proc({ ref: 'P-02', workAreaKey: 'caro', state: 'in_progress' }),
        ],
      }),
    );
    const se = plan.get('subsequent_events')!;
    expect(se.evidence).toMatchObject({ suggestedState: 'in_progress', ready: true });
    expect(se.evidence.facts[0]).toBe('1 of 1 linked procedure(s) complete.');
    expect(se.draftNote).toMatch(/after 31 March 2025 .*\(P-01\)/);
    expect(plan.get('caro')?.evidence).toMatchObject({
      suggestedState: 'in_progress',
      ready: false,
    });
    for (const p of plan.values()) expect(p.evidence.suggestedState).not.toBe('complete');
  });

  it('the CARO item waits for every 02.4 clause conclusion (draft annexure)', () => {
    const done = proc({ ref: 'P-02', workAreaKey: 'caro', state: 'complete' });
    const partial = planCompletionItems(
      facts({ procedures: [done], caroClauses: { total: 21, approved: 20, reportable: 1 } }),
    ).get('caro')!;
    expect(partial.evidence.ready).toBe(false);
    expect(partial.evidence.facts.at(-1)).toBe(
      '02.4 clause programme: 20 of 21 clause conclusion(s) approved, 1 reportable — draft CARO annexure in progress.',
    );
    const full = planCompletionItems(
      facts({ procedures: [done], caroClauses: { total: 21, approved: 21, reportable: 0 } }),
    ).get('caro')!;
    expect(full.evidence.ready).toBe(true);
    expect(full.draftNote).toMatch(
      /Draft CARO annexure from 21 approved clause conclusion\(s\)\.$/,
    );
  });

  it('the IFC item waits for the 02.5 ICFR conclusion and names material weaknesses', () => {
    const fw = new Map(facts().framework);
    fw.set('ifc', { conclusion: 'applicable', basis: null });
    const done = proc({ ref: 'P-09', workAreaKey: 'ifc', state: 'complete' });
    const icfr = {
      workstreamActive: true,
      conclusion: null as IcfrReportingSummary['conclusion'],
      concluded: false,
      deficiencies: {
        total: 2,
        open: 2,
        controlDeficiencies: 0,
        significantDeficiencies: 1,
        materialWeaknesses: 1,
        awaitingReview: 0,
        awaitingPartner: 1,
      },
      materialWeaknesses: [{ ref: 'ICD-001', description: 'No review of journals' }],
      significantDeficiencies: [{ ref: 'ICD-002', description: 'Late reconciliations' }],
      consolidated: { active: false, parentConclusion: null, componentMaterialWeaknesses: 0 },
    } satisfies IcfrReportingSummary;
    const open = planCompletionItems(
      facts({ framework: fw, procedures: [done], icfr: { ...icfr } }),
    ).get('ifc')!;
    expect(open.evidence.ready).toBe(false);
    expect(open.evidence.facts).toContain('The Engagement Partner has not yet concluded on ICFR.');
    const concluded = planCompletionItems(
      facts({
        framework: fw,
        procedures: [done],
        icfr: {
          ...icfr,
          conclusion: 'modified_material_weakness',
          concluded: true,
          deficiencies: { ...icfr.deficiencies, awaitingPartner: 0 },
        },
      }),
    );
    expect(concluded.get('ifc')!.evidence.ready).toBe(true);
    expect(concluded.get('ifc')!.draftNote).toMatch(
      /Modified ICFR opinion — material weakness\(es\): ICD-001 No review of journals\..*SA 265\): ICD-002/,
    );
    expect(concluded.get('auditors_report')!.evidence.facts.at(-1)).toMatch(
      /IFC \(Annexure B, modified — material weakness\)/,
    );
  });

  it('summarises exceptions for the misstatements item', () => {
    const plan = planCompletionItems(
      facts({
        procedures: [proc({ ref: 'P-03', state: 'complete' })],
        exceptions: [
          {
            status: 'carried_forward',
            severity: 'high',
            description: 'Cut-off error',
            procedureRef: 'P-03',
          },
          { status: 'open', severity: 'low', description: 'Rounding', procedureRef: 'P-03' },
        ],
      }),
    );
    const m = plan.get('misstatements')!;
    expect(m.evidence.facts[0]).toBe(
      '2 exception(s) raised on procedures — 1 open, 1 carried forward, 0 resolved.',
    );
    expect(m.evidence.ready).toBe(false);
    expect(m.draftNote).toContain('• P-03: Cut-off error (high)');
    expect(m.draftNote).toContain('OM ₹1,00,000');
  });

  it('links going-concern risks and drafts the completion memo', () => {
    const plan = planCompletionItems(
      facts({
        risks: [
          {
            id: 'r1',
            ref: 'R4',
            description: 'Going concern — continued losses',
            fsArea: null,
            sourceKey: null,
            isSignificant: true,
            status: 'identified',
          },
        ],
        procedures: [proc({ ref: 'P-04', riskId: 'r1' })],
      }),
    );
    expect(plan.get('going_concern')?.evidence.facts[0]).toBe(
      'Section 04: R4 Going concern — continued losses (significant)',
    );
    expect(plan.get('going_concern')?.evidence.goTo?.phaseKey).toBe('risk');
    const memo = plan.get('completion_memo')!.draftNote!;
    expect(memo).toContain(
      'Risks: 1 identified in Section 04 (1 significant); 1 with a linked response.',
    );
    expect(memo).toContain('Work: 1 of 2 audit areas concluded');
    expect(memo).toContain('Reporting: CARO applicable · IFC not applicable.');
    expect(plan.get('fs_final_review')?.evidence.facts).toContain('Not yet concluded: CARO.');
  });
});
