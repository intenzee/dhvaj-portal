import type { ReportingCrossRefs } from '@hsdg/contracts';
import {
  completionSummaryOf,
  crossRefLinksOf,
  mrlRepresentationsOf,
  planReportingProcedures,
  reportingProcedureSourceKey,
} from './reporting-records';

type PlanCard = Parameters<typeof planReportingProcedures>[0][number];
const card = (o: Partial<PlanCard> & { key: string }): PlanCard =>
  ({
    requirement: 'Requirement',
    clause: 'Clause',
    applicability: 'applicable',
    workConfigured: 'yes',
    ...o,
  }) as PlanCard;

const fraud = {
  active: true,
  matters: 0,
  open: 0,
  centralGovernmentRoute: 0,
  belowThreshold: 0,
  overdue: 0,
  nextDeadline: null,
  thresholdAmount: 10000000,
  initialNoticeDays: 2,
  responseDays: 45,
  forwardDays: 15,
};
const directors = {
  total: 0,
  pending: 0,
  disqualified: 0,
  cleared: 0,
  conclusion: 'not_started' as const,
};

const refs = (o: Partial<ReportingCrossRefs> = {}): ReportingCrossRefs => ({
  caro: { applicable: true, conclusion: 'applicable', complete: true, reportableClauses: 0 },
  icfr: { reportingRequired: true, conclusion: 'effective', complete: true, deficiencies: 0 },
  group: {
    cfsConclusion: 'not_applicable',
    branchesExist: false,
    branchAuditors: 0,
    branchReportsDealt: 0,
    branchReportsPending: 0,
    branchReturnsReceived: null,
  },
  ...o,
});

describe('02.7 reporting records', () => {
  describe('Section 06 procedures (one per applicable card)', () => {
    it('plans applicable and conditional cards, skipping cross-references and unconfigured work', () => {
      const plan = planReportingProcedures([
        card({
          key: 'rule_11_a_litigation',
          clause: 'Rule 11(a)',
          requirement: 'Pending litigations',
        }),
        card({ key: 'rule_11_g_audit_trail', applicability: 'conditional' }),
        card({ key: 's143_3_i_icfr', workConfigured: 'cross_reference' }),
        card({ key: 's143_3_b_books', workConfigured: 'no' }),
        card({ key: 'rule_11_f_dividend', applicability: 'not_applicable' }),
        card({ key: 'rule_11_c_iepf', applicability: 'pending' }),
      ]);
      expect(plan.map((p) => p.sourceKey)).toEqual([
        reportingProcedureSourceKey('rule_11_a_litigation'),
        reportingProcedureSourceKey('rule_11_g_audit_trail'),
      ]);
      expect(plan[0]!.title).toBe('Rule 11(a) — Pending litigations');
      expect(plan[0]!.sourceKey).toBe('r027:rule_11_a_litigation');
      expect(plan[1]!.sourceNote).toMatch(/conditional/);
    });

    it('keeps long titles within the procedure title limit', () => {
      const [p] = planReportingProcedures([
        card({ key: 'rule_11_a_litigation', requirement: 'x'.repeat(300) }),
      ]);
      expect(p!.title.length).toBeLessThanOrEqual(160);
      expect(p!.objective).toBeTruthy();
    });
  });

  describe('cross-references (no second register)', () => {
    it('reads clean when 02.4, 02.5 and 02.6 are concluded', () => {
      const links = crossRefLinksOf(refs());
      expect(links.map((l) => l.key)).toEqual(['caro', 'icfr', 'group']);
      expect(links.every((l) => !l.attention)).toBe(true);
      expect(links[0]!.lines).toContain('No clause with a reportable matter recorded');
    });

    it('flags undecided applicability, open deficiencies and pending branch reports', () => {
      const links = crossRefLinksOf(
        refs({
          caro: { applicable: null, conclusion: null, complete: false, reportableClauses: 0 },
          icfr: { reportingRequired: true, conclusion: null, complete: true, deficiencies: 2 },
          group: {
            cfsConclusion: null,
            branchesExist: true,
            branchAuditors: 2,
            branchReportsDealt: 1,
            branchReportsPending: 1,
            branchReturnsReceived: false,
          },
        }),
      );
      expect(links.map((l) => l.attention)).toEqual([true, true, true]);
      expect(links[1]!.lines).toContain('2 open deficiency(ies) in the ICFR workstream');
      expect(links[2]!.lines).toContain('1 branch report(s) dealt with, 1 pending');
      expect(links[2]!.lines).toContain('Proper returns still missing from a branch not visited');
    });
  });

  describe('completion summary', () => {
    it('defaults missing Rule 11(e) representations to pending', () => {
      const reps = mrlRepresentationsOf(null, { representationObtained: 'yes' });
      expect(reps.map((r) => [r.key, r.obtained])).toEqual([
        ['rule_11_e_i', 'pending'],
        ['rule_11_e_ii', 'yes'],
      ]);
    });

    it('keeps only cards with an obligation and prefers the team reporting status', () => {
      const s = completionSummaryOf({
        decided: true,
        cards: [
          {
            key: 'rule_11_a_litigation',
            requirement: 'Pending litigations',
            clause: 'Rule 11(a)',
            applicability: 'applicable',
            systemReportingStatus: 'clean',
            state: {
              workStatus: 'complete',
              reportingStatus: 'modified_wording_expected',
            },
          },
          {
            key: 'rule_11_c_iepf',
            requirement: 'IEPF',
            clause: 'Rule 11(c)',
            applicability: 'conditional',
            systemReportingStatus: 'clean',
            state: null,
          },
          {
            key: 'rule_11_f_dividend',
            requirement: 'Dividend',
            clause: 'Rule 11(f)',
            applicability: 'not_applicable',
            systemReportingStatus: 'not_applicable',
            state: null,
          },
        ] as unknown as Parameters<typeof completionSummaryOf>[0]['cards'],
        fraud,
        directors,
        rule11eAdvanced: { representationObtained: 'no' },
        rule11eReceived: undefined,
      });
      expect(s.cards.map((c) => [c.key, c.workStatus, c.reportingStatus])).toEqual([
        ['rule_11_a_litigation', 'complete', 'modified_wording_expected'],
        ['rule_11_c_iepf', 'not_started', 'clean'],
      ]);
      expect(s.mrlRepresentations.map((r) => r.obtained)).toEqual(['no', 'pending']);
    });
  });
});
