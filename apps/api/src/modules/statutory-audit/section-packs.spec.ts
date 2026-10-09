import type { SectionPack, SignOffCheck } from '@hsdg/contracts';
import {
  acceptanceMemoFor,
  planAcceptance,
  planFramework,
  planPlanning,
  planRisk,
  type AcceptancePackFacts,
  type RiskPackFacts,
} from './section-packs';

const byKey = (p: SectionPack, key: string): SignOffCheck => p.checks.find((c) => c.key === key)!;

describe('planAcceptance', () => {
  const clean: AcceptancePackFacts = {
    financialYear: '2024-25',
    segments: [
      {
        segmentKey: 'appointment_eligibility',
        title: '01.2 Appointment & Eligibility',
        state: 'complete',
        required: 3,
        answered: 3,
        answers: [
          { questionKey: 'el_firm', answer: 'clear', details: {}, narrative: null },
          { questionKey: 'el_disqualification', answer: 'clear', details: {}, narrative: null },
          { questionKey: 'el_ceiling', answer: 'clear', details: {}, narrative: null },
        ],
      },
      {
        segmentKey: 'previous_auditor',
        title: '01.3 Previous Auditor',
        state: 'not_applicable',
        required: 0,
        answered: 0,
        answers: [],
      },
      {
        segmentKey: 'engagement_letter',
        title: '01.7 Engagement Letter',
        state: 'complete',
        required: 1,
        answered: 1,
        answers: [],
      },
      {
        segmentKey: 'final_acceptance',
        title: '01.8 Final',
        state: 'not_started',
        required: 0,
        answered: 0,
        answers: [],
      },
    ],
    openMatters: [],
    missingMasterFacts: [],
    fileStatuses: { engagement_letter: 'accepted' },
  };

  it('is ready and suggests accept when every segment is clean', () => {
    const p = planAcceptance(clean);
    expect(p.ready).toBe(true);
    expect(p.attention).toBe(0);
    expect(p.suggestedConclusion).toBe('accept');
    expect(p.draftMemo).toContain(
      'Engagement acceptance — financial year 2024-25 (period ended 31 March 2025).',
    );
    expect(p.draftMemo).toContain('01.2 Appointment & Eligibility: no concerns.');
    expect(p.draftMemo).toContain('01.3 Previous Auditor: not applicable.');
    expect(p.draftMemo!.split('\n').at(-1)).toMatch(/^Conclusion: accept —/);
  });

  it('names open segments and matters, links to them, and suggests decline on a critical concern', () => {
    const p = planAcceptance({
      ...clean,
      segments: [
        {
          ...clean.segments[0]!,
          state: 'in_progress',
          answered: 2,
          answers: [
            { questionKey: 'el_firm', answer: 'clear', details: {}, narrative: null },
            {
              questionKey: 'el_disqualification',
              answer: 'issue',
              details: {
                description: 'Partner relative holds shares.',
                conclusion: 'cannot_accept',
              },
              narrative: null,
            },
          ],
        },
        ...clean.segments.slice(1),
      ],
      openMatters: [{ title: 'Sec 141 disqualification', isBlocking: true, severity: 'critical' }],
      missingMasterFacts: ['CIN'],
    });
    expect(p.ready).toBe(false);
    const seg = byKey(p, 'segments_resolved');
    expect(seg.facts).toContain('• 01.2 Appointment & Eligibility — 2 of 3 answered');
    expect(seg.goTo).toMatchObject({
      phaseKey: 'acceptance',
      anchor: 'segment-appointment_eligibility',
    });
    expect(byKey(p, 'blocking_matters').facts).toContain('• Sec 141 disqualification');
    expect(byKey(p, 'adverse_answers').ok).toBe(false);
    expect(byKey(p, 'master_facts').facts).toContain('• CIN');
    expect(p.suggestedConclusion).toBe('decline');
    expect(p.draftMemo).toContain('Partner relative holds shares.');
    expect(p.draftMemo!.split('\n').at(-1)).toBe(
      'Conclusion: not yet reached — 1 segment(s) still open.',
    );
  });

  it('rewrites the conclusion line to what the partner chose', () => {
    const memo = planAcceptance(clean).draftMemo!;
    const out = acceptanceMemoFor(memo, 'accept_with_conditions');
    expect(out.split('\n').at(-1)).toMatch(/^Conclusion: accept with conditions/);
    expect(out.split('\n')[0]).toBe(memo.split('\n')[0]);
  });
});

describe('planFramework', () => {
  it('blocks on undecided areas, counts the one-step suggestions and drafts the memo', () => {
    const p = planFramework({
      financialYear: '2024-25',
      areas: [
        {
          title: 'CARO 2020',
          kind: 'applicability',
          state: 'applicable',
          conclusion: 'applicable',
          isOverridden: false,
          basis: null,
        },
        {
          title: 'IFC reporting',
          kind: 'applicability',
          state: 'system_suggested_not_applicable',
          conclusion: null,
          isOverridden: false,
          basis: null,
        },
        {
          title: 'Ind AS',
          kind: 'applicability',
          state: 'overridden',
          conclusion: 'not_applicable',
          isOverridden: true,
          basis: '',
        },
      ],
      openMatters: [],
    });
    expect(p.ready).toBe(false);
    const decided = byKey(p, 'areas_decided');
    expect(decided.facts).toContain(
      '• IFC reporting — suggested not applicable — accept or override',
    );
    expect(decided.facts.at(-1)).toMatch(/1 only need the suggestion accepted/);
    expect(byKey(p, 'override_basis').ok).toBe(false);
    expect(p.draftMemo).toContain('Applicable: CARO 2020.');
    expect(p.draftMemo).toContain('Not applicable: Ind AS.');
    expect(p.draftMemo).toContain('Still to conclude: IFC reporting.');
  });
});

describe('planPlanning', () => {
  const items = [
    {
      itemKey: 'audit_strategy',
      title: 'Audit Strategy',
      state: 'complete',
      narrative: 'Substantive.',
    },
    { itemKey: 'materiality', title: 'Materiality', state: 'complete', narrative: null },
  ];

  it('is ready when the framework is approved and every sub-area complete', () => {
    const p = planPlanning({
      financialYear: '2024-25',
      frameworkApproved: true,
      items,
      materiality: { overall: 500000, performance: 375000, trivial: 25000, benchmark: '5% of PBT' },
    });
    expect(p.ready).toBe(true);
    expect(p.attention).toBe(0);
    expect(p.draftMemo).toContain(
      'Materiality: overall ₹5,00,000 (5% of PBT), performance ₹3,75,000, clearly trivial ₹25,000.',
    );
  });

  it('points to the framework and the open sub-area, and flags inconsistent materiality', () => {
    const p = planPlanning({
      financialYear: '2024-25',
      frameworkApproved: false,
      items: [
        items[0]!,
        { ...items[1]!, state: 'in_progress' },
        { itemKey: 'pbc_strategy', title: 'PBC Strategy', state: 'complete', narrative: ' ' },
      ],
      materiality: { overall: 100, performance: 200, trivial: null, benchmark: null },
    });
    expect(p.ready).toBe(false);
    expect(byKey(p, 'framework_approved').goTo?.phaseKey).toBe('framework');
    expect(byKey(p, 'items_complete').goTo).toMatchObject({
      phaseKey: 'planning',
      anchor: 'planning-materiality',
    });
    expect(byKey(p, 'materiality').facts).toEqual(
      expect.arrayContaining([
        'The clearly-trivial threshold is not set.',
        'Performance materiality is above overall materiality.',
        'No benchmark recorded.',
      ]),
    );
    expect(byKey(p, 'narratives').facts).toContain('• PBC Strategy');
  });
});

describe('planRisk', () => {
  const risk = (over: Partial<RiskPackFacts['risks'][number]>): RiskPackFacts['risks'][number] => ({
    id: 'r1',
    riskRef: 'R1',
    description: 'Revenue cut-off',
    fsArea: 'Revenue',
    assertion: 'cut_off',
    rating: 'high',
    isSignificant: false,
    isFraudRisk: false,
    response: null,
    ownerName: 'A',
    sourceKey: null,
    ...over,
  });

  it('blocks on a significant risk without a response and flags missing SA 240 risks', () => {
    const p = planRisk({
      planningApproved: true,
      risks: [
        risk({ isSignificant: true }),
        risk({ id: 'r2', riskRef: 'R2', ownerName: null, fsArea: null }),
      ],
      procedures: [],
    });
    expect(p.ready).toBe(false);
    expect(p.draftMemo).toBeNull();
    expect(byKey(p, 'significant_responses').goTo).toMatchObject({
      phaseKey: 'risk',
      anchor: 'risk-r1',
    });
    expect(byKey(p, 'significant_procedures').goTo?.phaseKey).toBe('audit_areas');
    expect(byKey(p, 'presumed_risks').facts[0]).toMatch(
      /Management override of controls, Fraud in revenue recognition/,
    );
    expect(byKey(p, 'risk_details').facts).toContain('• R2 — no area, owner');
  });

  it('is ready once each significant risk has a response and a procedure', () => {
    const p = planRisk({
      planningApproved: true,
      risks: [
        risk({
          isSignificant: true,
          response: 'Cut-off testing',
          sourceKey: 'sa240:revenue_recognition',
        }),
        risk({ id: 'r2', riskRef: 'R2', sourceKey: 'sa240:management_override' }),
      ],
      procedures: [{ riskId: 'r1' }],
    });
    expect(p.ready).toBe(true);
    expect(p.attention).toBe(0);
  });
});
