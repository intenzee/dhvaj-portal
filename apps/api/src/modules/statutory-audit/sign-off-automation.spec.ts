import { canSignOff } from '@hsdg/contracts';
import { planSignOff, type SignOffFacts } from './sign-off-automation';

const facts = (o: Partial<SignOffFacts> = {}): SignOffFacts => ({
  financialYear: '2024-25',
  framework: new Map(),
  areas: [
    { key: 'cash', title: 'Cash and bank', concluded: true },
    { key: 'rev', title: 'Revenue', concluded: true },
  ],
  procedures: [
    {
      ref: 'P-01',
      title: 'Revenue cut-off',
      state: 'complete',
      sourceKey: null,
      riskId: 'r1',
      workAreaKey: 'rev',
      workAreaTitle: 'Revenue',
    },
  ],
  risks: [
    {
      id: 'r1',
      ref: 'R-01',
      description: 'Revenue recognition',
      fsArea: 'Revenue',
      sourceKey: null,
      isSignificant: true,
      status: 'addressed',
    },
  ],
  exceptions: [],
  materiality: { om: 1000000, pm: 750000, ctt: 50000 },
  items: [
    { section: 'completion', title: 'Subsequent Events', state: 'complete' },
    { section: 'reporting', title: 'Audit Report', state: 'complete' },
    { section: 'reporting', title: 'IFC Report', state: 'not_applicable' },
  ],
  completionApprovedAt: new Date('2026-05-10T10:00:00Z'),
  completionApprovedByName: 'Partner A',
  blockingNotes: [],
  pbcOutstanding: 0,
  pbcOverdue: 0,
  openReassessments: [],
  engagementPartnerName: 'Partner A',
  ...o,
});

const byKey = (p: ReturnType<typeof planSignOff>, key: string) =>
  p.checks.find((c) => c.key === key)!;

describe('Section 09 sign-off pack', () => {
  it('is ready when every §29 gate holds, with a drafted memo', () => {
    const pack = planSignOff(facts());
    expect(pack.ready).toBe(true);
    expect(pack.attention).toBe(0);
    expect(pack.checks.every((c) => c.ok && c.goTo === null)).toBe(true);
    expect(byKey(pack, 'completion_approved').facts[0]).toBe(
      'Approved by Partner A on 2026-05-10.',
    );
    expect(byKey(pack, 'reporting_resolved').facts).toContain('Reports: Audit Report.');
    expect(pack.draftMemo).toMatch(
      /^Partner sign-off — financial year 2024-25 \(period ended 31 March 2025\)\./,
    );
    expect(pack.draftMemo).toContain('Significant risks: 1 of 1 with a completed response.');
    expect(pack.engagementPartnerName).toBe('Partner A');
    expect(byKey(pack, 'areas_concluded').facts).toEqual(['All 2 audit area(s) concluded.']);
    expect(byKey(planSignOff(facts({ areas: [] })), 'areas_concluded').facts).toEqual([
      'No audit areas in the file yet — nothing to conclude.',
    ]);
  });

  it('says what blocks sign-off and where to fix it — the same rule as the gate', () => {
    const pack = planSignOff(
      facts({
        completionApprovedAt: null,
        areas: [
          { key: 'cash', title: 'Cash and bank', concluded: false },
          { key: 'rev', title: 'Revenue', concluded: true },
        ],
        items: [
          { section: 'completion', title: 'Going Concern', state: 'in_progress' },
          { section: 'reporting', title: 'CARO Report', state: 'not_started' },
        ],
        blockingNotes: [{ body: 'Support the impairment', targetLabel: 'P-07 Impairment' }],
      }),
    );
    expect(pack.ready).toBe(false);
    expect(byKey(pack, 'completion_approved')).toMatchObject({
      ok: false,
      goTo: { phaseKey: 'completion' },
    });
    expect(byKey(pack, 'completion_approved').facts).toContain('• Going Concern');
    expect(byKey(pack, 'reporting_resolved').facts).toContain('• CARO Report');
    expect(byKey(pack, 'areas_concluded').facts).toContain('• Cash and bank');
    expect(byKey(pack, 'blocking_notes').facts).toContain(
      '• P-07 Impairment: Support the impairment',
    );
    expect(
      canSignOff({
        completionApproved: false,
        completionItemsResolved: false,
        reportingItemsResolved: false,
        areasOpen: 1,
        openBlockingNotes: 1,
        signedOff: false,
        archived: false,
      }),
    ).toBe(pack.ready);
  });

  it('flags what the partner should know without blocking sign-off', () => {
    const pack = planSignOff(
      facts({
        procedures: [],
        exceptions: [
          {
            status: 'carried_forward',
            severity: 'high',
            description: 'Unrecorded liability',
            procedureRef: 'P-03',
          },
        ],
        pbcOutstanding: 2,
        pbcOverdue: 1,
        openReassessments: ['materiality changed: Revised turnover'],
      }),
    );
    expect(pack.ready).toBe(true);
    expect(pack.attention).toBe(4);
    expect(byKey(pack, 'misstatements').facts).toEqual([
      '0 exception(s) open, 1 carried forward as uncorrected.',
      '• P-03: Unrecorded liability (high, carried forward)',
      'Measure against overall materiality ₹10,00,000 (clearly trivial ₹50,000).',
    ]);
    expect(byKey(pack, 'significant_risks').facts[1]).toBe('• R-01 Revenue recognition');
    expect(byKey(pack, 'pbc').facts[0]).toBe('2 PBC request(s) outstanding, 1 overdue.');
    expect(byKey(pack, 'reassessments').goTo?.phaseKey).toBe('reassessment');
    expect(pack.draftMemo).toContain(
      'Uncorrected misstatements: 1 carried forward, assessed against overall materiality ₹10,00,000.',
    );
  });
});
