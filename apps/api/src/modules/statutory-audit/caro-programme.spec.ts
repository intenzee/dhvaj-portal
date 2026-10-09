import type { CaroLibraryClause, CaroProgrammeLevel1 } from '@hsdg/contracts';
import {
  approvalBlockers,
  buildAnnexure,
  clausesInForce,
  planClauseProcedures,
  planProgramme,
  scheduleIiiRequirementCodes,
  summarise,
  workClauses,
  type BlockerInput,
} from './caro-programme';

function clause(over: Partial<CaroLibraryClause>): CaroLibraryClause {
  return {
    id: over.clauseCode ?? 'x',
    orderCode: 'CARO_2020',
    clauseCode: 'CARO_2020_3_I',
    parentClauseCode: null,
    clauseRef: '3(i)',
    title: 'Clause',
    requirement: 'Requirement',
    reportContext: 'standalone',
    provisionCode: over.clauseCode ?? 'CARO_2020_3_I',
    guidanceProvisionCode: 'ICAI_GN_CARO_2020',
    guidanceReference: null,
    relevanceHint: null,
    scheduleIiiKeys: [],
    auditAreaCodes: [],
    procedures: [],
    requiresPartnerReview: false,
    sortOrder: 0,
    effectiveFrom: '2021-04-01',
    effectiveTo: null,
    ...over,
  };
}

function level1(over: Partial<CaroProgrammeLevel1> = {}): CaroProgrammeLevel1 {
  return {
    outcome: 'applicable',
    decided: true,
    complete: false,
    standaloneApplies: true,
    consolidatedApplies: null,
    consolidatedStatus: 'not_applicable',
    cfsInScope: false,
    financialYear: '2024-25',
    periodStart: '2024-04-01',
    ...over,
  };
}

describe('CARO clause library', () => {
  const library = [
    clause({ clauseCode: 'CARO_2020_3_I', sortOrder: 100 }),
    clause({
      clauseCode: 'CARO_2020_3_I_B',
      parentClauseCode: 'CARO_2020_3_I',
      clauseRef: '3(i)(b)',
      sortOrder: 103,
    }),
    clause({ clauseCode: 'CARO_2020_3_XVII', clauseRef: '3(xvii)', sortOrder: 1700 }),
    clause({
      clauseCode: 'CARO_2020_3_XXI',
      clauseRef: '3(xxi)',
      reportContext: 'consolidated',
      sortOrder: 2100,
    }),
  ];

  it('resolves nothing before the Order commences — a historical period gets no CARO 2020', () => {
    expect(clausesInForce(library, '2020-04-01')).toEqual([]);
    expect(clausesInForce(library, '2021-04-01')).toHaveLength(4);
  });

  it('keeps the version in force for the period — a future amendment does not rewrite history', () => {
    const amended = clause({
      clauseCode: 'CARO_2020_3_XVII',
      clauseRef: '3(xvii)',
      title: 'Amended',
      effectiveFrom: '2026-04-01',
      sortOrder: 1700,
    });
    const v1 = { ...library[2]!, effectiveTo: '2026-03-31' };
    const lib = [library[0]!, library[1]!, v1, amended];
    expect(clausesInForce(lib, '2024-04-01').find((c) => c.clauseRef === '3(xvii)')?.title).toBe(
      'Clause',
    );
    expect(clausesInForce(lib, '2026-04-01').find((c) => c.clauseRef === '3(xvii)')?.title).toBe(
      'Amended',
    );
  });

  it('makes work items of sub-clauses and leaf clauses only, per report context', () => {
    const all = clausesInForce(library, '2024-04-01');
    const sfs = workClauses(all, 'standalone');
    expect(sfs.map((c) => c.clauseRef)).toEqual(['3(i)(b)', '3(xvii)']);
    expect(sfs[0]!.parentTitle).toBe('Clause');
    // CFS never duplicates the paragraph-3 programme — only 3(xxi).
    expect(workClauses(all, 'consolidated').map((c) => c.clauseRef)).toEqual(['3(xxi)']);
  });

  it('resolves Schedule III keys for the engagement Division', () => {
    expect(scheduleIiiRequirementCodes(['ARI_TITLE_DEEDS'], 'II')).toEqual([
      'SCH3_II_ARI_TITLE_DEEDS',
    ]);
    expect(scheduleIiiRequirementCodes(['ARI_TITLE_DEEDS'], null)).toEqual([]);
  });
});

describe('planProgramme (Level 1 → Level 2)', () => {
  it('generates nothing before the applicability is confirmed', () => {
    const p = planProgramme(level1({ decided: false }), null, true);
    expect(p).toMatchObject({ state: 'awaiting_conclusion', standalone: 'keep' });
  });

  it('instantiates the standalone programme when CARO applies', () => {
    expect(planProgramme(level1(), null, true)).toMatchObject({
      state: 'active',
      standalone: 'ensure',
      consolidated: 'keep',
      consolidatedState: 'not_required',
    });
  });

  it('configures only 3(xxi) for the CFS, pending until 02.6 concludes', () => {
    const p = planProgramme(
      level1({ cfsInScope: true, consolidatedStatus: 'pending', consolidatedApplies: null }),
      null,
      true,
    );
    expect(p).toMatchObject({ standalone: 'ensure', consolidated: 'ensure', consolidatedState: 'pending' });
    const q = planProgramme(
      level1({ cfsInScope: true, consolidatedStatus: 'applicable', consolidatedApplies: true }),
      null,
      true,
    );
    expect(q.consolidatedState).toBe('configured');
  });

  it('withdraws (never deletes) when CARO is later concluded not applicable', () => {
    const p = planProgramme(
      level1({ outcome: 'not_applicable_exempt', standaloneApplies: false }),
      { status: 'active' },
      true,
    );
    expect(p).toMatchObject({ state: 'withdrawn', standalone: 'withdraw', consolidated: 'withdraw' });
  });

  it('has no programme for an exempt entity that never had one', () => {
    expect(
      planProgramme(level1({ standaloneApplies: false }), null, true),
    ).toMatchObject({ state: 'not_applicable', standalone: 'keep' });
  });

  it('leaves existing items alone while 02.4 is re-evaluated', () => {
    expect(planProgramme(level1({ decided: false }), { status: 'active' }, true)).toMatchObject({
      state: 'active',
      standalone: 'keep',
      consolidated: 'keep',
    });
  });

  it('reports a missing library version instead of guessing', () => {
    expect(planProgramme(level1(), null, false).state).toBe('no_library');
  });
});

describe('approvalBlockers', () => {
  const base: BlockerInput = {
    relevance: 'applicable',
    relevanceReason: null,
    conclusion: 'no_reportable_exception',
    draftReporting: 'The Company has maintained proper records.',
    requiresPartnerReview: false,
    partnerReviewed: false,
    findings: [],
    components: [],
  };

  it('passes a complete clause', () => {
    expect(approvalBlockers(base)).toEqual([]);
  });

  it('needs a relevance decision and a conclusion', () => {
    const b = approvalBlockers({ ...base, relevance: 'assessment_required', conclusion: null });
    expect(b).toHaveLength(2);
  });

  it('keeps Not Applicable to Facts consistent and reasoned', () => {
    expect(
      approvalBlockers({
        ...base,
        relevance: 'not_applicable_to_facts',
        conclusion: 'not_applicable_to_facts',
        draftReporting: null,
      }),
    ).toEqual(['Give the reason the clause is not applicable to the facts.']);
    expect(
      approvalBlockers({ ...base, conclusion: 'not_applicable_to_facts' }).length,
    ).toBeGreaterThan(0);
  });

  it('never approves further work required', () => {
    expect(approvalBlockers({ ...base, conclusion: 'further_work_required' })[0]).toMatch(
      /Further work/,
    );
  });

  it('a reportable matter needs drafted language and its finding', () => {
    const b = approvalBlockers({ ...base, conclusion: 'reportable_matter', draftReporting: ' ' });
    expect(b).toEqual([
      'Draft the proposed reporting language.',
      'Record the finding behind the reportable matter (included in reporting).',
    ]);
  });

  it('flags open reportable findings on a clean conclusion', () => {
    expect(
      approvalBlockers({
        ...base,
        findings: [{ status: 'open', includeInReport: true, withdrawn: false }],
      }),
    ).toHaveLength(1);
  });

  it('3(xxi): every component decided, remarks captured, partner reviewed', () => {
    const b = approvalBlockers({
      ...base,
      requiresPartnerReview: true,
      components: [
        { caroApplicable: 'pending', qualificationIdentified: null, paragraphRefs: null, withdrawn: false },
        { caroApplicable: 'yes', qualificationIdentified: true, paragraphRefs: null, withdrawn: false },
        { caroApplicable: 'pending', qualificationIdentified: null, paragraphRefs: null, withdrawn: true },
      ],
    });
    expect(b).toHaveLength(3);
    expect(b[2]).toMatch(/Partner/);
    // Submission does not wait for the partner.
    expect(approvalBlockers({ ...base, requiresPartnerReview: true }, true)).toEqual([]);
  });
});

describe('summary and annexure', () => {
  const items = [
    {
      clauseCode: 'A',
      clauseRef: '3(i)(b)',
      title: 'Physical verification',
      reportContext: 'standalone' as const,
      relevance: 'applicable' as const,
      conclusion: 'reportable_matter' as const,
      draftReporting: 'Verification was not carried out.',
      reviewState: 'approved',
      withdrawn: false,
      sortOrder: 2,
      openFindings: 1,
    },
    {
      clauseCode: 'B',
      clauseRef: '3(xii)',
      title: 'Nidhi company',
      reportContext: 'standalone' as const,
      relevance: 'not_applicable_to_facts' as const,
      conclusion: 'not_applicable_to_facts' as const,
      draftReporting: null,
      reviewState: 'approved',
      withdrawn: false,
      sortOrder: 1,
      openFindings: 0,
    },
    {
      clauseCode: 'C',
      clauseRef: '3(xvii)',
      title: 'Cash losses',
      reportContext: 'standalone' as const,
      relevance: 'assessment_required' as const,
      conclusion: null,
      draftReporting: 'draft',
      reviewState: 'open',
      withdrawn: false,
      sortOrder: 3,
      openFindings: 0,
    },
    {
      clauseCode: 'D',
      clauseRef: '3(xviii)',
      title: 'Withdrawn',
      reportContext: 'standalone' as const,
      relevance: 'applicable' as const,
      conclusion: null,
      draftReporting: null,
      reviewState: 'open',
      withdrawn: true,
      sortOrder: 4,
      openFindings: 5,
    },
  ];

  it('summarises live items only — Level 2 relevance never changes Level 1', () => {
    expect(summarise(items)).toEqual({
      total: 3,
      applicable: 1,
      notApplicableToFacts: 1,
      assessmentRequired: 1,
      approved: 2,
      reportable: 1,
      openFindings: 1,
    });
  });

  it('builds the draft annexure from approved conclusions, in library order', () => {
    const a = buildAnnexure('wf', items, 'standalone', {
      title: "Companies (Auditor's Report) Order, 2020",
      versionLabel: 'v1',
    });
    expect(a.paragraphs.map((p) => p.clauseRef)).toEqual(['3(xii)', '3(i)(b)', '3(xvii)']);
    expect(a.paragraphs[0]!.text).toMatch(/clause 3\(xii\) of the Order are not applicable/);
    expect(a.paragraphs[1]!.text).toBe('Verification was not carried out.');
    expect(a.paragraphs[2]!.text).toBeNull(); // not approved — no text in the report
    expect(a).toMatchObject({ complete: false, approvedCount: 2, totalCount: 3, reportableCount: 1 });
    expect(buildAnnexure('wf', items, 'consolidated', null).totalCount).toBe(0);
  });

  it('plans one Section 06 procedure per live, relevant clause', () => {
    const planned = planClauseProcedures(
      items.map((i) => ({
        ...i,
        requirement: 'req',
        procedures: [{ title: 'Step', objective: 'Do it.', evidence: 'Paper.' }],
      })),
    );
    expect(planned.map((p) => p.sourceKey)).toEqual(['caro:A', 'caro:C']);
    expect(planned[0]).toMatchObject({
      title: 'CARO 3(i)(b) — Physical verification',
      objective: 'Step: Do it.',
      expectedEvidence: 'Paper.',
    });
  });
});
