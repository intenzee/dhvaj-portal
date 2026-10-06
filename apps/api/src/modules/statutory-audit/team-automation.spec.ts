import {
  estimateHours,
  memberFlags,
  planBalance,
  procedureHours,
  type TeamPerson,
  type TeamProcedure,
} from './team-automation';

const proc = (o: Partial<TeamProcedure> & { id: string; ref: string }): TeamProcedure => ({
  title: `Procedure ${o.ref}`,
  state: 'not_started',
  ownerId: 'mgr',
  reviewerId: 'ep',
  dueDate: null,
  areaRisk: 'low',
  significant: false,
  ...o,
});

const leads = { epId: 'ep', managerId: 'mgr' };

const people: TeamPerson[] = [
  { employeeId: 'ep', name: 'Partner P', gradeRank: 100, role: null },
  { employeeId: 'mgr', name: 'Manager M', gradeRank: 80, role: null },
  { employeeId: 'sr', name: 'Senior S', gradeRank: 60, role: 'member' },
  { employeeId: 'art', name: 'Article A', gradeRank: 40, role: 'member' },
];

describe('team automation — hours', () => {
  it('weights a procedure by its area risk and significant risk', () => {
    expect(procedureHours({ areaRisk: 'low', significant: false })).toBe(2);
    expect(procedureHours({ areaRisk: 'significant', significant: true })).toBe(10);
    expect(procedureHours({ areaRisk: null, significant: false })).toBe(3);
  });

  it('estimates prepare + areas + review share + file time, with its basis', () => {
    const procs = [
      proc({ id: 'p1', ref: 'P-001', ownerId: 'sr', areaRisk: 'high' }),
      proc({ id: 'p2', ref: 'P-002', ownerId: 'sr', areaRisk: 'low' }),
    ];
    const areas = [{ id: 'a1', ownerId: 'mgr' }];
    expect(estimateHours('sr', procs, areas, leads)).toEqual({
      hours: 8,
      basis: 'Estimated from 2 procedure(s) (8h)',
    });
    // Manager: 1 area + 6h file time; EP reviews 8h of work at 15% + 4h sign-off.
    expect(estimateHours('mgr', procs, areas, leads).hours).toBe(7);
    expect(estimateHours('ep', procs, areas, leads)).toEqual({
      hours: 5.2,
      basis: 'Estimated from reviewing 2 (1.2h), planning & sign-off (4h)',
    });
    expect(estimateHours('nobody', procs, areas, leads)).toEqual({ hours: 0, basis: null });
  });
});

describe('team automation — balance the work', () => {
  it('hands not-started work to the team: hard work to a senior, the rest by load', () => {
    const procs = [
      proc({ id: 'p1', ref: 'P-001', areaRisk: 'significant', significant: true }),
      proc({ id: 'p2', ref: 'P-002', areaRisk: 'low' }),
      proc({ id: 'p3', ref: 'P-003', areaRisk: 'low' }),
      proc({ id: 'p4', ref: 'P-004', state: 'in_progress' }), // started — stays
    ];
    const moves = planBalance(people, procs, leads);
    const owner = (id: string) => moves.find((m) => m.procedureId === id && m.field === 'owner');
    expect(owner('p1')).toMatchObject({
      toEmployeeId: 'sr',
      fromName: 'Manager M',
      reason: 'Significant-risk work — to a senior with the lightest load',
    });
    // Senior carries 10h, so the low-risk work goes to the article first.
    expect(owner('p2')?.toEmployeeId).toBe('art');
    expect(owner('p3')?.toEmployeeId).toBe('art');
    expect(owner('p4')).toBeUndefined();
    // Review: manager takes the non-significant work; the EP keeps significant risk.
    const reviewer = (id: string) =>
      moves.find((m) => m.procedureId === id && m.field === 'reviewer');
    expect(reviewer('p2')).toMatchObject({ fromEmployeeId: 'ep', toEmployeeId: 'mgr' });
    expect(reviewer('p1')).toBeUndefined();
  });

  it('keeps hard work with the manager when no senior is on the team', () => {
    const moves = planBalance(
      people.filter((p) => p.employeeId !== 'sr'),
      [proc({ id: 'p1', ref: 'P-001', areaRisk: 'high' })],
      leads,
    );
    expect(moves.some((m) => m.field === 'owner')).toBe(false);
  });

  it('never touches work a person assigned, and proposes nothing with no team', () => {
    const procs = [proc({ id: 'p1', ref: 'P-001', ownerId: 'art', reviewerId: 'sr' })];
    expect(planBalance(people, procs, leads)).toEqual([]);
    expect(
      planBalance(people.slice(0, 2), [proc({ id: 'p1', ref: 'P-001' })], leads).filter(
        (m) => m.field === 'owner',
      ),
    ).toEqual([]);
  });
});

describe('team automation — flags', () => {
  it('lists what needs attention, most urgent first', () => {
    expect(
      memberFlags({
        plannedHours: 10,
        actualHours: 12.5,
        ownedProcedures: 3,
        ownedAreas: 0,
        isLead: false,
        overdue: 1,
        returned: 2,
        notesToAnswer: 1,
        waitingForTheirReview: 0,
      }).map((f) => f.label),
    ).toEqual(['1 overdue', 'Over plan by 2.5h', '2 returned from review', '1 note(s) to answer']);
    expect(
      memberFlags({
        plannedHours: 0,
        actualHours: 0,
        ownedProcedures: 0,
        ownedAreas: 0,
        isLead: false,
        overdue: 0,
        returned: 0,
        notesToAnswer: 0,
        waitingForTheirReview: 3,
      }).map((f) => f.key),
    ).toEqual(['to_review', 'no_work']);
  });
});
