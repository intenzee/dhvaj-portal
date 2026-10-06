import type { AuditPbcItem } from '@hsdg/contracts';
import {
  dueFor,
  linkArea,
  planChase,
  planPbcSuggestions,
  roleFor,
  type PbcSuggestionFacts,
} from './pbc-automation';

const facts = (o: Partial<PbcSuggestionFacts> = {}): PbcSuggestionFacts => ({
  standard: {
    isCompany: true,
    activityFlags: {
      manufacturing: false,
      trading: false,
      services: true,
      ecommerce: false,
      import: false,
      export: false,
    } as PbcSuggestionFacts['standard']['activityFlags'],
    borrowings: 0,
    hasGroupRelationships: false,
    hasSubsidiaries: false,
    initialAudit: false,
    activeWorkAreas: new Set(['caro', 'auditor_reporting', 'overall_responses']),
  },
  areas: [
    { key: 'caro', title: 'CARO 2020 Workstream' },
    { key: 'auditor_reporting', title: "Auditor's Reporting" },
    { key: 'overall_responses', title: 'Overall responses' },
    { key: 'fs_cash', title: 'Cash & Bank' },
    { key: 'fs_rev', title: 'Revenue' },
    { key: 'fs_ppe', title: 'Property, Plant & Equipment' },
    { key: 'fs_emp', title: 'Employee Benefits' },
  ],
  risks: [],
  prior: null,
  ...o,
});

const item = (o: Partial<AuditPbcItem> & { id: string; pbcRef: string }): AuditPbcItem => ({
  requirement: 'Bank statements',
  clientOwner: 'Asha Rao (CFO)',
  workAreaId: null,
  workAreaTitle: null,
  status: 'requested',
  rejectionReason: null,
  requestedDate: '2025-09-01',
  dueDate: '2025-09-10',
  receivedDate: null,
  documentId: null,
  documentTitle: null,
  note: null,
  requestedByName: null,
  isOverdue: false,
  sourceKey: null,
  sourceNote: null,
  lastChasedOn: null,
  version: 1,
  createdAt: '',
  updatedAt: '',
  ...o,
});

describe('pbc automation — suggestions', () => {
  it('links requests to the 03.5 area they support, else the workstream', () => {
    const areas = facts().areas;
    expect(linkArea('Bank statements and reconciliations', areas)).toBe('fs_cash');
    expect(linkArea('Fixed asset register with additions', areas, 'caro')).toBe('fs_ppe');
    expect(linkArea('Loan sanction letters', areas, 'caro')).toBe('caro');
    expect(linkArea('Loan sanction letters', areas, 'cfs')).toBeNull();
  });

  it('reads the client role from the wording', () => {
    expect(roleFor('GST returns (GSTR-1, GSTR-3B)')).toBe('gst');
    expect(roleFor('TDS returns and Form 26AS')).toBe('tax');
    expect(roleFor('Board minutes for the year')).toBe('secretarial');
    expect(roleFor('Debtor confirmations')).toBe('finance');
  });

  it('adds standard, 03.5-area, risk and completion requests with stable keys', () => {
    const plan = planPbcSuggestions(
      facts({
        risks: [
          {
            id: 'r1',
            ref: 'R2',
            description: 'Management override of controls',
            fsArea: 'Journal entries',
            status: 'identified',
          },
          { id: 'r2', ref: 'R5', description: 'Going concern', fsArea: null, status: 'concluded' },
        ],
      }),
    );
    const byKey = new Map(plan.map((p) => [p.sourceKey, p]));
    const bank = plan.find((p) => /^Bank statements/.test(p.requirement))!;
    expect(bank).toMatchObject({ stage: 'planning', workAreaKey: 'fs_cash' });
    expect(bank.sourceKey).toMatch(/^std:bank_statements/);
    expect(byKey.get('area:fs_rev:cutoff')).toMatchObject({
      workAreaKey: 'fs_rev',
      stage: 'fieldwork',
      sourceNote: '03.5 audit area — Revenue',
    });
    expect(byKey.has('area:fs_emp:actuarial')).toBe(true);
    expect(byKey.get('risk:journal_entries')).toMatchObject({
      workAreaKey: 'overall_responses',
      sourceNote: 'Section 04 risk R2',
    });
    expect(byKey.has('risk:going_concern')).toBe(false); // concluded risk
    expect(byKey.get('stage:rep_letter')).toMatchObject({
      stage: 'completion',
      ownerRole: 'secretarial',
      workAreaKey: 'auditor_reporting',
    });
    expect(new Set(plan.map((p) => p.sourceKey)).size).toBe(plan.length);
  });

  it("rolls last year's custom requests forward, never duplicating a standard one", () => {
    const plan = planPbcSuggestions(
      facts({
        prior: {
          financialYear: '2023-24',
          items: [
            { id: 'p1', ref: 'PBC-014', requirement: 'Royalty agreement with the licensor' },
            {
              id: 'p2',
              ref: 'PBC-001',
              requirement:
                'Trial balance and general ledger for the year, with prior-year comparatives',
            },
          ],
        },
      }),
    );
    expect(plan.find((p) => p.sourceKey === 'py:p1')).toMatchObject({
      requirement: 'Royalty agreement with the licensor',
      sourceNote: 'Rolled forward from FY 2023-24 (PBC-014)',
      stage: 'planning',
    });
    expect(plan.some((p) => p.sourceKey === 'py:p2')).toBe(false);
  });
});

describe('pbc automation — due dates', () => {
  it('staggers by stage from the planned dates', () => {
    const dates = { today: '2025-09-01', plannedStart: '2025-09-15', plannedEnd: '2025-11-30' };
    expect(dueFor('planning', dates)).toBe('2025-09-15');
    expect(dueFor('fieldwork', dates)).toBe('2025-09-22');
    expect(dueFor('completion', dates)).toBe('2025-11-23');
  });

  it('falls back to a week from today and never puts completion before fieldwork', () => {
    const dates = { today: '2025-09-01', plannedStart: '2025-08-01', plannedEnd: '2025-09-05' };
    expect(dueFor('planning', dates)).toBe('2025-09-08');
    expect(dueFor('fieldwork', dates)).toBe('2025-09-15');
    expect(dueFor('completion', dates)).toBe('2025-09-22');
    expect(
      dueFor('completion', { today: '2025-09-01', plannedStart: null, plannedEnd: null }),
    ).toBe('2025-10-08');
  });
});

describe('pbc automation — chase list', () => {
  const contacts = [
    {
      fullName: 'Asha Rao',
      designation: 'CFO',
      contactType: 'cfo',
      isPrimary: true,
      email: 'asha@client.in',
    },
  ];
  const ctx = {
    entityName: 'Acme Pvt Ltd',
    financialYear: '2024-25',
    senderName: 'Manager M',
    today: '2025-09-12',
  };

  it('drafts one reminder per contact for overdue and due-soon requests', () => {
    const groups = planChase(
      [
        item({ id: 'a', pbcRef: 'PBC-001', dueDate: '2025-09-10' }),
        item({
          id: 'b',
          pbcRef: 'PBC-002',
          requirement: 'Debtor confirmations',
          status: 'rejected',
          rejectionReason: 'Unsigned',
          dueDate: '2025-09-14',
        }),
        item({ id: 'c', pbcRef: 'PBC-003', dueDate: '2025-09-30' }), // not yet due
        item({ id: 'd', pbcRef: 'PBC-004', status: 'received', dueDate: '2025-09-01' }),
        item({ id: 'e', pbcRef: 'PBC-005', clientOwner: null, dueDate: '2025-09-11' }),
      ],
      contacts,
      ctx,
    );
    expect(groups.map((g) => g.owner)).toEqual(['Asha Rao (CFO)', 'Client (no owner set)']);
    const asha = groups[0]!;
    expect(asha).toMatchObject({
      email: 'asha@client.in',
      pbcIds: ['a', 'b'],
      overdue: 1,
      subject: 'Acme Pvt Ltd — statutory audit for FY 2024-25: 2 item(s) pending',
    });
    expect(asha.lines).toEqual([
      'PBC-001 — Bank statements (due 2025-09-10, 2 day(s) overdue)',
      'PBC-002 — Debtor confirmations (due 2025-09-14) — please send a revised copy: Unsigned',
    ]);
    expect(asha.body).toMatch(/^Dear Asha,/);
    expect(asha.body).toContain('by 2025-09-15?');
    expect(asha.body.endsWith('Manager M')).toBe(true);
    expect(groups[1]!.email).toBeNull();
    expect(groups[1]!.body).toMatch(/^Dear Sir \/ Madam,/);
  });

  it('keeps the latest reminder date', () => {
    const [g] = planChase(
      [
        item({ id: 'a', pbcRef: 'PBC-001', lastChasedOn: '2025-09-05' }),
        item({ id: 'b', pbcRef: 'PBC-002', lastChasedOn: '2025-09-09' }),
      ],
      contacts,
      ctx,
    );
    expect(g!.lastChasedOn).toBe('2025-09-09');
  });
});
