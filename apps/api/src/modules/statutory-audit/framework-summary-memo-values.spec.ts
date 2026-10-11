import type { FraudMatter } from '@hsdg/contracts';
import {
  fraudTests,
  influenceTests,
  numericLine,
  type InfluenceInvestee,
} from './framework-summary-memo-values';
import { frameworkOverridesOf, outcomeInWords } from './framework-summary-overrides';

const investee = (over: Partial<InfluenceInvestee> = {}): InfluenceInvestee => ({
  name: 'Beta Pvt Ltd',
  relationship: 'associate',
  ownershipPercent: 26,
  votingDirect: 18,
  votingIndirect: 8,
  factors: [
    'Ownership interest 26%',
    'Voting power 26%',
    'Contractual rights: board seat under the SHA',
  ],
  basis: 'Associate — significant influence (AS 23); equity method.',
  significantInfluence: 'yes',
  jointControl: null,
  ...over,
});
const SI_RULE = { threshold: 20, operator: '>=' };

describe('influenceTests (02.6 §10)', () => {
  it('shows voting power direct + indirect against the significant-influence presumption', () => {
    const { tests, basis } = influenceTests([investee()], SI_RULE);
    expect(tests).toHaveLength(1);
    expect(numericLine(tests[0]!)).toBe(
      'Significant influence — Beta Pvt Ltd (02.6) | Actual Voting power 26% (direct 18% + indirect 8%) | Limit 20% | Operator ≥ | Result: Associate — presumption met',
    );
    expect(basis[0]!).toBe(
      'Beta Pvt Ltd (Associate) basis: Contractual rights: board seat under the SHA; Significant influence concluded: Yes; Associate — significant influence (AS 23); equity method.',
    );
  });

  it('says when influence rests on the non-percentage basis (below the presumption)', () => {
    const { tests } = influenceTests([investee({ votingDirect: 12, votingIndirect: 3 })], SI_RULE);
    expect(tests[0]!.actual).toBe('Voting power 15% (direct 12% + indirect 3%)');
    expect(tests[0]!.result).toBe('Associate — below the presumption; rests on the basis below');
  });

  it('falls back to ownership when no voting % is captured, and covers joint ventures', () => {
    const { tests, basis } = influenceTests(
      [
        investee({
          name: 'Gamma JV',
          relationship: 'joint_venture',
          votingDirect: null,
          votingIndirect: null,
          ownershipPercent: 50,
          significantInfluence: null,
          jointControl: 'yes',
          factors: [],
          basis: null,
        }),
      ],
      SI_RULE,
    );
    expect(tests[0]!.actual).toBe('Ownership 50% (no voting % captured)');
    expect(basis[0]!).toBe('Gamma JV (Joint venture) basis: Joint control concluded: Yes');
  });

  it('leaves subsidiaries and outside-perimeter investees out; no rule = not tested', () => {
    const r = influenceTests(
      [investee({ relationship: 'subsidiary' }), investee({ relationship: 'none' })],
      SI_RULE,
    );
    expect(r.tests).toEqual([]);
    expect(influenceTests([investee()], null).tests[0]!).toMatchObject({
      limit: null,
      operator: null,
      result: 'Associate — not tested against a percentage',
    });
  });
});

const matter = (over: Partial<FraudMatter> = {}): FraudMatter =>
  ({
    id: 'm1',
    ref: 'FM-001',
    nature: 'Misappropriation of cash',
    amount: 15_000_000,
    amountEstimated: true,
    route: 'central_government',
    withdrawn: false,
    deadlines: [
      {
        key: 'initial_notice',
        label: 'Report to the Board / Audit Committee',
        fromEvent: 'date knowledge obtained',
        fromDate: '2026-05-04',
        days: 2,
        dueDate: '2026-05-06',
        metOn: '2026-05-05',
        status: 'met',
        provisional: false,
        ruleCode: 'FRAUD_INITIAL_NOTICE_DAYS',
      },
      {
        key: 'reply_due',
        label: 'Board / Audit Committee reply',
        fromEvent: 'date reported to the Board',
        fromDate: '2026-05-05',
        days: 45,
        dueDate: '2026-06-19',
        metOn: null,
        status: 'overdue',
        provisional: false,
        ruleCode: 'FRAUD_BOARD_REPLY_DAYS',
      },
    ],
    ...over,
  }) as FraudMatter;

describe('fraudTests (02.7 §10)', () => {
  it('prints the route against the ₹1 crore threshold and each Rule 13 step against its period', () => {
    const t = fraudTests([matter()], 10_000_000).map(numericLine);
    expect(t).toHaveLength(3);
    expect(t[0]).toMatch(
      /^FM-001 Misappropriation of cash — reporting route, Section 143\(12\) \(02\.7\) \| Actual .+ \(estimated\) \| Limit .+ \| Operator ≥ \| Result: Central Government/,
    );
    expect(t[1]).toMatch(
      /FM-001 — Report to the Board \/ Audit Committee \(02\.7\) \| Actual Done .+ \| Limit 2 days from date knowledge obtained .+ due .+ \| Operator ≤ \| Result: Met$/,
    );
    expect(t[2]).toMatch(/Actual Not yet done \| Limit 45 days from .+ \| Result: Overdue$/);
  });

  it('skips withdrawn matters and marks a pending amount and a provisional route', () => {
    expect(fraudTests([matter({ withdrawn: true })], 10_000_000)).toEqual([]);
    const [route, step] = fraudTests(
      [
        matter({
          amount: null,
          route: 'pending',
          deadlines: [{ ...matter().deadlines[0]!, provisional: true }],
        }),
      ],
      10_000_000,
    );
    expect(route!.actual).toBe('Not yet determined');
    expect(route!.result).toMatch(/^Pending/);
    expect(step!.result).toBe('Met (route provisional)');
  });
});

describe('frameworkOverridesOf (§12)', () => {
  it('puts outcomes in words, orders by source with other areas last', () => {
    const out = frameworkOverridesOf([
      {
        source: 'other_areas',
        title: 'CSR',
        system_result: 'applicable',
        conclusion: 'not_applicable',
        reason: '  Net profit below the threshold  ',
        overridden_by_name: 'EM',
        overridden_at: new Date('2026-06-01T10:00:00Z'),
      },
      {
        source: '02.1',
        title: 'Small Company classification',
        system_result: 'pending',
        conclusion: 'small',
        reason: 'Turnover confirmed from the signed accounts',
        overridden_by_name: null,
        overridden_at: null,
      },
    ]);
    expect(out.map((o) => o.source)).toEqual(['02.1', 'other_areas']);
    expect(out[0]).toMatchObject({
      systemResult: 'Information Insufficient',
      conclusion: 'Small Company',
    });
    expect(out[1]).toMatchObject({
      systemResult: 'Applicable',
      conclusion: 'Not applicable',
      reason: 'Net profit below the threshold',
      overriddenAt: '2026-06-01T10:00:00.000Z',
    });
  });

  it('falls back to the key in words for sections without a label map', () => {
    expect(outcomeInWords('02.4', 'not_applicable_exempt')).toBe('Not applicable exempt');
    expect(outcomeInWords('02.2', null)).toBeNull();
  });
});
