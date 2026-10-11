import type {
  FrameworkMemoCard,
  FrameworkSummaryMatter,
  FrameworkSummarySection,
  SubSectionKey,
} from '@hsdg/contracts';
import {
  auditPeriodLabel,
  buildDashboard,
  bumpMinor,
  conclusionLabel,
  evaluateCompletion,
  profileConclusion,
  sectionForRuleArea,
  summaryStatus,
  undocumentedOverrides,
  validateConditions,
  validateReopen,
  validateReturnForFurtherWork,
  validateReturnItems,
  type CompletionInput,
  type OtherAreaFacts,
  type ProfileSummaryFacts,
} from './framework-summary-engine';

const SUBS: Array<[SubSectionKey, string, string]> = [
  ['02.2', 'financial_reporting_framework', 'Financial Reporting Framework'],
  ['02.3', 'schedule_iii', 'Schedule III'],
  ['02.4', 'caro', 'CARO 2020'],
  ['02.5', 'ifc', 'ICFR'],
  ['02.6', 'cfs', 'CFS / Group Audit'],
  ['02.7', 'other_regulatory', 'Other Statutory Reporting'],
];

const section = (
  sub: SubSectionKey,
  over: Partial<FrameworkSummarySection> = {},
): FrameworkSummarySection => {
  const [, area, title] = SUBS.find((s) => s[0] === sub)!;
  return {
    subSectionKey: sub,
    areaKey: area,
    title,
    state: 'applicable',
    systemOutcome: 'applicable',
    conclusion: null,
    ruleVersionId: null,
    authorityProvisionId: null,
    needsReevaluation: false,
    isOverridden: false,
    decided: true,
    ...over,
  };
};
const allSections = (): FrameworkSummarySection[] => SUBS.map(([s]) => section(s));

const profile = (over: Partial<ProfileSummaryFacts> = {}): ProfileSummaryFacts => ({
  state: 'confirmed',
  listingAnswer: 'no',
  smallCompanyOutcome: 'not_small_company',
  smallCompanyOverride: null,
  smallCompanyOverrideReason: null,
  initialAudit: false,
  jointAudit: false,
  specialEntityTypes: [],
  needsReevaluation: false,
  ...over,
});

const area = (over: Partial<OtherAreaFacts> = {}): OtherAreaFacts => ({
  areaKey: 'csr',
  title: 'CSR',
  state: 'not_applicable',
  conclusion: 'not_applicable',
  isOverridden: false,
  basis: null,
  ...over,
});

const matter = (over: Partial<FrameworkSummaryMatter> = {}): FrameworkSummaryMatter => ({
  id: 'm1',
  code: 'M-001',
  source: '02.4',
  category: 'information_pending',
  title: 'Borrowing data missing',
  description: null,
  impact: null,
  ownerEmployeeId: null,
  ownerName: null,
  dueDate: null,
  status: 'open',
  partnerAttention: false,
  resolution: null,
  evidenceDocumentId: null,
  blocking: false,
  open: true,
  ...over,
});

const memo = (status: FrameworkMemoCard['status']): FrameworkMemoCard => ({
  documentId: 'd1',
  fileName: 'AFM.docx',
  workItem: '02.8',
  version: '1',
  status,
  preparedByName: null,
  lastEditorName: null,
  lastSavedAt: null,
  webUrl: null,
  baselineVersion: '1.0',
  submittedAt: null,
});

const dash = (over: Partial<Parameters<typeof buildDashboard>[0]> = {}) =>
  buildDashboard({
    profile: profile(),
    sections: allSections(),
    otherAreas: [area()],
    matters: [],
    returns: [],
    preview: [],
    ...over,
  });

const completion = (over: Partial<CompletionInput> = {}) =>
  evaluateCompletion({
    dashboard: dash(),
    sections: allSections(),
    matters: [],
    undocumentedOverrides: [],
    openReturns: 0,
    baselineStatus: null,
    previewReviewed: false,
    previewItemCount: 3,
    memo: null,
    isRevision: false,
    impactConfirmed: true,
    versionsStored: false,
    viewerIsPartner: false,
    ...over,
  });

describe('02.8 framework summary engine', () => {
  describe('dashboard (§4)', () => {
    it('lists 02.1, the six sub-sections and the other areas, each with its source anchor', () => {
      const rows = dash();
      expect(rows.map((r) => r.section)).toEqual([
        '02.1',
        '02.2',
        '02.3',
        '02.4',
        '02.5',
        '02.6',
        '02.7',
        'other_areas',
      ]);
      expect(rows.every((r) => r.status === 'complete')).toBe(true);
      expect(rows.find((r) => r.section === '02.1')!.anchor).toBe('framework-02-1');
      expect(rows.find((r) => r.section === 'other_areas')!.anchor).toBe('framework-02-areas');
    });

    it('flags an unconfirmed profile, a pending section and undecided areas', () => {
      const rows = dash({
        profile: profile({ state: 'draft' }),
        sections: [
          ...allSections().slice(0, 5),
          section('02.7', { decided: false, state: 'not_assessed' }),
        ],
        otherAreas: [area({ state: 'not_assessed', title: 'Cost records' })],
      });
      expect(rows[0]!.attention).toContain('Profile not confirmed');
      expect(rows[0]!.decided).toBe(false);
      expect(rows.find((r) => r.section === '02.7')!.attention).toContain('Conclusion pending');
      expect(rows.find((r) => r.section === 'other_areas')!.attention[0]).toMatch(/Cost records/);
    });

    it('surfaces open matters and open returns on their source section only', () => {
      const rows = dash({
        matters: [matter({ blocking: true })],
        returns: [
          {
            id: 'r1',
            gate: 'AF-01',
            section: '02.5',
            action: 'Re-test entity-level controls',
            ownerEmployeeId: null,
            ownerName: null,
            status: 'open',
            raisedByName: null,
            raisedAt: '2026-10-01T00:00:00Z',
            resolvedByName: null,
            resolvedAt: null,
            resolution: null,
          },
        ],
      });
      expect(rows.find((r) => r.section === '02.4')!.attention).toEqual(['Blocking matter open']);
      expect(rows.find((r) => r.section === '02.5')!.attention).toEqual([
        'Returned (AF-01): Re-test entity-level controls',
      ]);
      expect(rows.find((r) => r.section === '02.3')!.status).toBe('complete');
    });

    it('shows component / branch auditor work on 02.6 from the preview', () => {
      const rows = dash({
        preview: [
          {
            key: 'component_auditor_work',
            item: 'Component auditor work',
            result: 'Required',
            action: 'activate',
            source: '02.6',
            ruleKey: 'r',
          },
          {
            key: 'branch_auditor_work',
            item: 'Branch auditor work',
            result: 'Not Required',
            action: 'activate',
            source: '02.6',
            ruleKey: 'r',
          },
        ],
      });
      expect(rows.find((r) => r.section === '02.6')!.detail).toBe('Components: Required');
    });
  });

  it('labels conclusions per section and summarises the 02.1 profile', () => {
    expect(conclusionLabel('02.4', 'not_applicable_exempt')).toBe('Exempt');
    expect(conclusionLabel('02.2', null)).toBeNull();
    expect(conclusionLabel('02.4', 'something_new')).toBe('something new');
    expect(
      profileConclusion(
        profile({ initialAudit: true, jointAudit: true, specialEntityTypes: ['nbfc'] }),
      ),
    ).toMatch(/^Unlisted · .* · Initial audit · Joint audit · NBFC$/);
    expect(profileConclusion(profile({ state: null }))).toBeNull();
  });

  it('finds overrides with no documented reason (§18)', () => {
    expect(
      undocumentedOverrides({
        sections: [
          { title: 'CARO 2020', isOverridden: true, basis: ' ' },
          { title: 'ICFR', isOverridden: true, basis: 'Partner consulted' },
        ],
        otherAreas: [area({ isOverridden: true, basis: null })],
        profile: profile({ smallCompanyOverride: 'small_company' }),
      }),
    ).toEqual(['CARO 2020', 'CSR', 'Small company status (02.1)']);
  });

  describe('completion + gates (§9, §12, §18)', () => {
    it('AF-01 opens once every section is decided and nothing blocks', () => {
      const c = completion();
      expect(c.canConfirm).toBe(true);
      expect(c.confirmBlockers).toEqual([]);
      expect(c.canCreateMemo).toBe(false);
      expect(c.canApprove).toBe(false);
      expect(c.checks).toHaveLength(10);
    });

    it('a blocking matter, an open return, an override without reason or an open consultation blocks AF-01', () => {
      expect(completion({ matters: [matter({ blocking: true })] }).canConfirm).toBe(false);
      // A resolved matter that still carries the flag does not block.
      expect(completion({ matters: [matter({ blocking: true, open: false })] }).canConfirm).toBe(
        true,
      );
      expect(completion({ openReturns: 2 }).confirmBlockers.join(' ')).toMatch(/2 returned items/);
      expect(completion({ undocumentedOverrides: ['CSR'] }).canConfirm).toBe(false);
      expect(
        completion({ matters: [matter({ category: 'partner_consultation' })] }).canConfirm,
      ).toBe(false);
    });

    it('an undecided section blocks AF-01 and names it', () => {
      const sections = [...allSections().slice(0, 5), section('02.7', { decided: false })];
      const c = completion({ sections, dashboard: dash({ sections }) });
      expect(c.allSectionsDecided).toBe(false);
      expect(c.confirmBlockers[0]).toMatch(/Other Statutory Reporting/);
    });

    it('a revision needs its impact analysis confirmed first', () => {
      expect(completion({ isRevision: true, impactConfirmed: false }).canConfirm).toBe(false);
      expect(completion({ isRevision: true, impactConfirmed: true }).canConfirm).toBe(true);
    });

    it('AF-02 needs the Manager confirmation, the submitted memorandum and the Engagement Partner', () => {
      const base = { baselineStatus: 'manager_confirmed' as const, viewerIsPartner: true };
      expect(completion({ ...base, memo: null }).canApprove).toBe(false);
      expect(completion({ ...base, memo: memo('draft') }).canApprove).toBe(false);
      expect(completion({ ...base, memo: memo('submitted') }).canApprove).toBe(true);
      expect(
        completion({ ...base, memo: memo('submitted'), viewerIsPartner: false }).approveBlockers,
      ).toContain('Only the Engagement Partner can record AF-02.');
      expect(completion(base).canCreateMemo).toBe(true);
      expect(completion(base).canConfirm).toBe(false);
    });

    it('once approved: reopen allowed, the checklist is met when versions are stored', () => {
      const c = completion({
        baselineStatus: 'approved',
        previewReviewed: true,
        memo: memo('approved'),
        versionsStored: true,
      });
      expect(c.canReopen).toBe(true);
      expect(c.canConfirm).toBe(false);
      expect(c.checks.every((k) => k.met)).toBe(true);
    });
  });

  it('derives the displayed status (§3)', () => {
    expect(summaryStatus({ baselineStatus: null, isRevision: false, canConfirm: false })).toBe(
      'draft',
    );
    expect(summaryStatus({ baselineStatus: 'draft', isRevision: false, canConfirm: true })).toBe(
      'ready_for_manager_review',
    );
    expect(summaryStatus({ baselineStatus: 'draft', isRevision: true, canConfirm: true })).toBe(
      'reopened',
    );
    expect(
      summaryStatus({ baselineStatus: 'manager_confirmed', isRevision: true, canConfirm: false }),
    ).toBe('partner_review');
    expect(
      summaryStatus({ baselineStatus: 'approved', isRevision: false, canConfirm: false }),
    ).toBe('approved');
  });

  it('labels the audit period, bumps versions and maps rule areas to sections', () => {
    expect(auditPeriodLabel('2024-25', 'FY')).toEqual({
      label: 'FY 2024-25 · 01 Apr 2024 – 31 Mar 2025',
      start: '2024-04-01',
      end: '2025-03-31',
    });
    expect(bumpMinor('1.0')).toBe('1.1');
    expect(bumpMinor('1.9')).toBe('1.10');
    expect(sectionForRuleArea('caro')).toBe('02.4');
    expect(sectionForRuleArea('section_143')).toBe('02.7');
    expect(sectionForRuleArea('csr')).toBe('other_areas');
    expect(sectionForRuleArea('materiality')).toBeNull();
  });

  describe('input validation', () => {
    it('AF-01 return items need a known section and an action', () => {
      expect(validateReturnItems([])).toMatch(/requires/);
      expect(validateReturnItems([{ section: '02.9', action: 'x' }])).toMatch(/Unknown/);
      expect(validateReturnItems([{ section: '02.4', action: ' ' }])).toMatch(/action/);
      expect(validateReturnItems([{ section: '02.4', action: 'Fix clause (vii)' }])).toBeNull();
    });

    it('conditions need text, a due date, the impact and the planning flag', () => {
      const ok = {
        condition: 'Obtain the bank sanction letter',
        dueDate: '2026-11-30',
        impact: 'CARO 3(ii)(b) conclusion',
        planningMayCommence: true,
      };
      expect(validateConditions([])).toMatch(/at least one/);
      expect(validateConditions([ok])).toBeNull();
      expect(validateConditions([{ ...ok, dueDate: '30/11/2026' }])).toMatch(/due date/);
      expect(validateConditions([{ ...ok, impact: '' }])).toMatch(/impact/);
    });

    it('return for further work needs a reason and sections', () => {
      expect(validateReturnForFurtherWork('', ['02.4'])).toMatch(/reason/);
      expect(validateReturnForFurtherWork('Why', [])).toMatch(/section/);
      expect(validateReturnForFurtherWork('Why', ['02.4', 'other_areas'])).toBeNull();
    });

    it('a reopen needs reason, sections, a past identification date and the reapproval flag', () => {
      const now = new Date('2026-10-11T10:00:00Z');
      const ok = {
        reason: 'Company listed its debt securities after approval',
        affectedSections: ['02.1', '02.5'],
        identifiedAt: '2026-10-10T00:00:00Z',
        reapprovalRequired: true,
      };
      expect(validateReopen(ok, now)).toBeNull();
      expect(validateReopen({ ...ok, reason: ' ' }, now)).toMatch(/reason/);
      expect(validateReopen({ ...ok, affectedSections: [] }, now)).toMatch(/affected/);
      expect(validateReopen({ ...ok, identifiedAt: '2026-12-01' }, now)).toMatch(/future/);
      expect(validateReopen({ ...ok, identifiedAt: 'soon' }, now)).toMatch(/identified/);
    });
  });
});
