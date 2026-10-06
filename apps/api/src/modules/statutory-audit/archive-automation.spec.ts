import { addDays, addYears, planArchive, type ArchiveFacts } from './archive-automation';

const facts = (o: Partial<ArchiveFacts> = {}): ArchiveFacts => ({
  financialYear: '2024-25',
  framework: new Map(),
  areas: [
    { key: 'caro', title: 'CARO', concluded: true },
    { key: 'fs_rev', title: 'Revenue', concluded: true },
  ],
  procedures: [
    {
      ref: 'P-01',
      title: 'Revenue cut-off',
      state: 'complete',
      sourceKey: null,
      riskId: null,
      workAreaKey: 'fs_rev',
      workAreaTitle: 'Revenue',
    },
  ],
  risks: [],
  exceptions: [],
  materiality: null,
  signedOffAt: new Date('2025-08-20T10:00:00Z'),
  signedOffByName: 'Partner P',
  archivedAt: null,
  archivedByName: null,
  reportDate: null,
  udin: null,
  today: new Date('2025-09-01T09:00:00Z'),
  openReviewNotes: 0,
  pbcOutstanding: 0,
  openReassessments: 0,
  evidenceCount: 3,
  completeWithoutEvidence: [],
  carryForward: [],
  nextYear: null,
  ...o,
});

const byKey = (p: ReturnType<typeof planArchive>, key: string) =>
  p.checks.find((c) => c.key === key)!;

describe('archive automation', () => {
  it('adds days and years on calendar dates', () => {
    expect(addDays(new Date('2025-08-20T23:30:00Z'), 60).toISOString().slice(0, 10)).toBe(
      '2025-10-19',
    );
    expect(addYears(new Date('2024-02-29'), 7).toISOString().slice(0, 10)).toBe('2031-02-28');
  });

  it('derives the assembly deadline and retention from the sign-off date', () => {
    const p = planArchive(facts());
    expect(p).toMatchObject({
      ready: true,
      attention: 0,
      reportDate: '2025-08-20',
      assemblyDueBy: '2025-10-19',
      daysToAssemble: 48,
      retainUntil: '2032-08-20',
    });
    expect(byKey(p, 'assembly').facts).toEqual([
      'Report dated 2025-08-20 — assemble by 2025-10-19 (SA 230, SQC 1).',
      '48 day(s) left.',
      'Keep the file until 2032-08-20 (7 years, SQC 1).',
    ]);
    expect(p.draftNote).toContain(
      "archived on 2025-09-01, 12 day(s) after the auditor's report dated 2025-08-20",
    );
    expect(p.draftNote).toContain('Retained until 2032-08-20 (SQC 1).');
  });

  it('uses the recorded report date and flags an overdue assembly', () => {
    const p = planArchive(
      facts({ reportDate: new Date('2025-06-01'), udin: '25123456ABCDEFGHIJ' }),
    );
    expect(p.daysToAssemble).toBe(-32);
    expect(byKey(p, 'assembly')).toMatchObject({ ok: false, blocking: false });
    expect(byKey(p, 'assembly').facts[1]).toBe('Overdue by 32 day(s) — archive now.');
    expect(byKey(p, 'udin').ok).toBe(true);
    expect(p.draftNote).toContain('UDIN 25123456ABCDEFGHIJ');
    expect(p.attention).toBe(1);
  });

  it('cannot archive before sign-off; deadlines wait for it', () => {
    const p = planArchive(facts({ signedOffAt: null, signedOffByName: null }));
    expect(p.ready).toBe(false);
    expect(byKey(p, 'signed_off')).toMatchObject({ ok: false, blocking: true });
    expect(byKey(p, 'signed_off').goTo?.phaseKey).toBe('sign_off');
    expect(p.assemblyDueBy).toBeNull();
    expect(p.retainUntil).toBeNull();
  });

  it('lists what archiving would freeze and evidence gaps, never blocking', () => {
    const p = planArchive(
      facts({
        openReviewNotes: 2,
        pbcOutstanding: 1,
        completeWithoutEvidence: ['P-01 Revenue cut-off'],
      }),
    );
    expect(p.ready).toBe(true);
    const loose = byKey(p, 'loose_ends');
    expect(loose.facts).toEqual([
      'Archiving freezes these as they are — close them first:',
      '• 2 review note(s) not cleared.',
      '• 1 PBC request(s) outstanding.',
    ]);
    expect(loose.goTo?.phaseKey).toBe('review');
    expect(byKey(p, 'evidence').facts).toContain('• P-01 Revenue cut-off');
    expect(p.attention).toBe(2);
    expect(p.checks.filter((c) => c.blocking).map((c) => c.key)).toEqual(['signed_off']);
  });

  it("says what next year's file will bring forward", () => {
    const p = planArchive(
      facts({
        carryForward: ['Significant risk — Revenue: Cut-off', 'Inventory valuation'],
        nextYear: { financialYear: '2025-26' },
      }),
    );
    const cf = byKey(p, 'carry_forward');
    expect(cf.ok).toBe(true);
    expect(cf.facts[0]).toBe(
      "2 matter(s) will be brought forward to next year's planning (03.1.6):",
    );
    expect(cf.facts).toContain(
      'FY 2025-26 engagement exists — its planning picks these up when opened.',
    );
    expect(p.carryForward).toHaveLength(2);
  });

  it('once archived, the clock stops at the archive date', () => {
    const p = planArchive(
      facts({ archivedAt: new Date('2025-09-10T12:00:00Z'), archivedByName: 'Partner P' }),
    );
    expect(p.ready).toBe(false);
    expect(p.daysToAssemble).toBe(39);
    expect(byKey(p, 'assembly').facts[1]).toBe('Archived on 2025-09-10, within the 60-day window.');
  });
});
