import {
  deriveDownstreamPreview,
  deriveTriggeredRequirements,
  diffSnapshotFacts,
  impactFingerprint,
  impactItemsFor,
  matterSourceOf,
  reportingImpactsOf,
  snapshotFactsOf,
  type DownstreamWorkItem,
  type FrameworkRecordInputs,
} from './framework-summary-records';
import { applyFrameworkRevision, type PlannedCompletionItem } from './completion-automation';
import { numericLine } from './framework-summary-memo-values';

function inputs(over: Partial<FrameworkRecordInputs> = {}): FrameworkRecordInputs {
  return {
    initialAudit: false,
    sa510: false,
    sa402: false,
    jointAudit: false,
    serviceOrgProvider: null,
    jointAuditors: [],
    accountingEnvironment: null,
    accountingSoftware: [],
    recordsElectronic: null,
    specialists: [],
    entityClass: 'Private Limited Company',
    listingAnswer: 'no',
    smallCompanyOutcome: 'not_small',
    outcomes: {
      frf: 'accounting_standards',
      smc: null,
      scheduleIii: 'division_i',
      caro: 'applicable',
      icfr: 'applicable',
      cfs: 'not_applicable',
      otherReporting: null,
    },
    groupFramework: null,
    perimeter: [],
    components: [],
    branches: [],
    cards: [],
    ruleVersions: [],
    methodologyVersion: 'DHVAJ Statutory Audit Methodology v1.0',
    ...over,
  };
}

describe('02.8 Track B — triggered requirements (§5)', () => {
  it('1. a plain standalone audit triggers nothing', () => {
    expect(deriveTriggeredRequirements(inputs())).toEqual([]);
  });

  it('2. circumstances trigger their SA, each citing a Provision Library code', () => {
    const t = deriveTriggeredRequirements(
      inputs({
        initialAudit: true,
        sa402: true,
        serviceOrgProvider: 'Payroll Co',
        jointAudit: true,
        jointAuditors: ['ABC & Co'],
        specialists: ['Valuation'],
        accountingSoftware: ['sap'],
        components: [{ name: 'Sub A', auditorType: 'other_auditor', firmName: 'XYZ LLP' }],
        outcomes: { ...inputs().outcomes, cfs: 'cfs_required', frf: 'ind_as' },
      }),
    );
    const byKey = Object.fromEntries(t.map((r) => [r.key, r]));
    expect(Object.keys(byKey).sort()).toEqual(
      ['cfs', 'it_environment', 'joint_audit', 'sa_402', 'sa_510', 'sa_600', 'sa_620'].sort(),
    );
    expect(byKey.sa_402!.trigger).toContain('Payroll Co');
    expect(byKey.joint_audit!.provisionCode).toBe('SA_299');
    expect(byKey.cfs!.provisionCode).toBe('INDAS_110');
    expect(byKey.sa_600!.source).toBe('02.6');
    expect(t.every((r) => r.authorityProvisionId === null)).toBe(true);
  });

  it('3. a DHVAJ-audited component does not trigger SA 600; a branch auditor does', () => {
    const own = inputs({ components: [{ name: 'Sub', auditorType: 'dhvaj', firmName: null }] });
    expect(deriveTriggeredRequirements(own).some((r) => r.key === 'sa_600')).toBe(false);
    const br = inputs({ branches: [{ name: 'Pune', firmName: 'Branch & Co' }] });
    expect(deriveTriggeredRequirements(br).find((r) => r.key === 'sa_600')?.trigger).toContain(
      '1 branch',
    );
  });

  it('4. an AS group cites AS 21; audit trail alone sources IT environment to 02.7', () => {
    const t = deriveTriggeredRequirements(
      inputs({
        outcomes: { ...inputs().outcomes, cfs: 'cfs_required' },
        cards: [{ key: 'rule_11_g_audit_trail', applicability: 'applicable', requirement: 'x' }],
      }),
    );
    expect(t.find((r) => r.key === 'cfs')?.provisionCode).toBe('AS_21');
    expect(t.find((r) => r.key === 'it_environment')?.source).toBe('02.7');
  });
});

describe('02.8 Track B — downstream preview (§6)', () => {
  it('5. produces the 12 configuration items with the 02.6 dashboard keys', () => {
    const p = deriveDownstreamPreview(inputs());
    expect(p.map((x) => x.key)).toEqual([
      'fs_review',
      'caro_programme',
      'icfr_programme',
      'internal_controls',
      'consolidation_programme',
      'component_auditor_work',
      'branch_auditor_work',
      'audit_trail_workpaper',
      's197_workpaper',
      'rule_11_workpapers',
      'initial_audit_procedures',
      'specialist_planning',
    ]);
    const by = Object.fromEntries(p.map((x) => [x.key, x]));
    expect(by.fs_review!.result).toBe('AS + Schedule III Division I');
    expect(by.caro_programme!.result).toBe('Required');
    expect(by.consolidation_programme!.result).toBe('Not Required');
    expect(by.internal_controls!.action).toBe('activate');
  });

  it('6. undecided sources stay pending — never a guessed result', () => {
    const p = deriveDownstreamPreview(
      inputs({ outcomes: { ...inputs().outcomes, caro: 'further_assessment', scheduleIii: null } }),
    );
    const by = Object.fromEntries(p.map((x) => [x.key, x]));
    expect(by.caro_programme!.result).toMatch(/^Pending/);
    expect(by.caro_programme!.action).toBe('none');
    expect(by.fs_review!.result).toMatch(/^Pending — conclude 02.3/);
    expect(by.rule_11_workpapers!.result).toMatch(/^Pending/);
  });

  it('7. counts Rule 11 clauses excluding the audit trail card', () => {
    const p = deriveDownstreamPreview(
      inputs({
        cards: [
          { key: 'rule_11_a_pending_litigation', applicability: 'applicable', requirement: 'a' },
          { key: 'rule_11_e_funds', applicability: 'conditional', requirement: 'e' },
          { key: 'rule_11_g_audit_trail', applicability: 'applicable', requirement: 'g' },
          { key: 'rule_11_f_dividend', applicability: 'not_applicable', requirement: 'f' },
        ],
      }),
    );
    const r11 = p.find((x) => x.key === 'rule_11_workpapers')!;
    expect(r11.result).toBe('Required as configured in 02.7 (2 clauses)');
    expect(p.find((x) => x.key === 'audit_trail_workpaper')!.result).toBe('Required');
  });
});

describe('02.8 Track B — snapshot facts and diff (§8, §16)', () => {
  it('8. identical facts produce no change; no prior snapshot produces no change', () => {
    const f = snapshotFactsOf(inputs());
    expect(diffSnapshotFacts(f, f)).toEqual([]);
    expect(diffSnapshotFacts(null, f)).toEqual([]);
  });

  it('9. a decided change is reported with previous and current wording', () => {
    const prev = snapshotFactsOf(
      inputs({ outcomes: { ...inputs().outcomes, caro: 'not_applicable_exempt' } }),
    );
    const cur = snapshotFactsOf(inputs());
    const changes = diffSnapshotFacts(prev, cur);
    const caro = changes.find((c) => c.changeType === 'caro');
    expect(caro).toMatchObject({ previous: 'Exempt', current: 'Applicable', source: '02.4' });
    expect(reportingImpactsOf(changes)).toContain(`${caro!.label}: Exempt → Applicable`);
  });

  it('10. an undecided side is not a change', () => {
    const prev = snapshotFactsOf(
      inputs({ outcomes: { ...inputs().outcomes, caro: 'further_assessment' } }),
    );
    expect(
      diffSnapshotFacts(prev, snapshotFactsOf(inputs())).some((c) => c.changeType === 'caro'),
    ).toBe(false);
  });

  it('11. a new other-auditor component is a group change', () => {
    const cur = snapshotFactsOf(
      inputs({ components: [{ name: 'Sub A', auditorType: 'other_auditor', firmName: 'XYZ' }] }),
    );
    const changes = diffSnapshotFacts(snapshotFactsOf(inputs()), cur);
    expect(changes.some((c) => c.changeType === 'other_auditor')).toBe(true);
  });
});

describe('02.8 Track B — change impact (§16)', () => {
  const work: DownstreamWorkItem[] = [
    {
      kind: 'caro_programme',
      ref: 'caro',
      label: 'CARO work programme',
      section: '02.4',
      changeTypes: ['caro'],
      ownerEmployeeId: 'e1',
      ownerName: 'Asha',
      completed: true,
      state: 'complete',
    },
    {
      kind: 'work_area',
      ref: 'wa-ifc',
      label: 'IFC work area',
      section: '02.5',
      changeTypes: ['icfr'],
      ownerEmployeeId: null,
      ownerName: null,
      completed: false,
      state: 'in_progress',
    },
  ];
  const caroChange = {
    changeType: 'caro' as const,
    label: 'CARO',
    previous: 'Applicable',
    current: 'Exempt',
    source: '02.4' as const,
  };

  it('12. completed work is flagged to reassess, never discarded; owner from the work', () => {
    const [item] = impactItemsFor([caroChange], work, 'EM');
    expect(item!.completedWorkToReassess).toEqual(['CARO work programme']);
    expect(item!.existingWorkAffected).toEqual([]);
    expect(item!.ownerName).toBe('Asha');
    expect(item!.approvalRequired).toBe(true);
    expect(item!.newWorkRequired.length).toBeGreaterThan(0);
  });

  it('13. the fingerprint is order-independent and changes with the facts', () => {
    const icfr = { ...caroChange, changeType: 'icfr' as const, label: 'ICFR' };
    const a = impactItemsFor([caroChange, icfr], work, null);
    const b = impactItemsFor([icfr, caroChange], work, null);
    expect(impactFingerprint(a)).toBe(impactFingerprint(b));
    const c = impactItemsFor([{ ...caroChange, current: 'Applicable' }, icfr], work, null);
    expect(impactFingerprint(c)).not.toBe(impactFingerprint(a));
  });

  it('14. matter sources map area keys to their 02.x section', () => {
    expect(matterSourceOf('area:caro')).toBe('02.4');
    expect(matterSourceOf(null)).toBe('other_areas');
  });
});

describe('02.8 Track B — memo numeric lines and Section 07/08 surfacing (§10, §17)', () => {
  it('15. numeric tests read "actual | limit | operator | result"', () => {
    const line = numericLine({
      label: 'Turnover',
      actual: '₹120 crore',
      limit: '₹100 crore',
      operator: '≤',
      result: 'Fail',
    });
    expect(line).toBe(
      'Turnover | Actual ₹120 crore | Limit ₹100 crore | Operator ≤ | Result: Fail',
    );
  });

  it('16. a live revision holds the reporting items not-ready and tells the memo', () => {
    const plan = new Map<string, PlannedCompletionItem>([
      [
        'auditors_report',
        {
          evidence: { facts: ['x'], suggestedState: 'in_progress', ready: true, goTo: null },
          draftNote: null,
        },
      ],
      [
        'completion_memo',
        {
          evidence: { facts: ['m'], suggestedState: 'in_progress', ready: true, goTo: null },
          draftNote: 'Memo',
        },
      ],
      [
        'going_concern',
        {
          evidence: { facts: ['g'], suggestedState: 'in_progress', ready: true, goTo: null },
          draftNote: null,
        },
      ],
    ]);
    applyFrameworkRevision(plan, {
      baselineVersion: '1.1',
      comparedToVersion: '1.0',
      reason: 'New subsidiary',
      reopenedAt: null,
      affectedSections: ['02.6'],
      reportingImpacts: ['CFS: CFS not required → CFS required'],
      impactConfirmed: false,
      reapproved: false,
    });
    expect(plan.get('auditors_report')!.evidence.ready).toBe(false);
    expect(plan.get('auditors_report')!.evidence.facts[0]).toContain('revision v1.1');
    expect(plan.get('auditors_report')!.evidence.facts[1]).toContain('CFS required');
    expect(plan.get('completion_memo')!.draftNote).toContain('Framework revision: v1.1');
    expect(plan.get('going_concern')!.evidence.ready).toBe(true);
  });

  it('17. a re-approved revision changes nothing', () => {
    const item: PlannedCompletionItem = {
      evidence: { facts: ['x'], suggestedState: 'in_progress', ready: true, goTo: null },
      draftNote: null,
    };
    const plan = new Map([['auditors_report', item]]);
    applyFrameworkRevision(plan, {
      baselineVersion: '1.1',
      comparedToVersion: '1.0',
      reason: null,
      reopenedAt: null,
      affectedSections: [],
      reportingImpacts: [],
      impactConfirmed: true,
      reapproved: true,
    });
    expect(plan.get('auditors_report')).toBe(item);
  });
});
