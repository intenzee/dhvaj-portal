import { FRAUD_CONCLUSION, OTHER_REPORTING_RULE_CODE as RC } from '@hsdg/contracts';
import {
  addDays,
  directorStatus,
  evaluateFraudMatter,
  fraudFrameworkStatus,
  fraudMatterRef,
  fraudRoute,
  fraudRulesOn,
  type FraudMatterDates,
  type FraudRuleVersion,
} from './fraud-matters';

const CRORE_1 = 10_000_000;

// The Rules Library as seeded: threshold v1 (all frauds, 0) → v2 ₹1 crore from
// the 2015 amendment; 2 / 45 / 15 days since 2014.
const VERSIONS: FraudRuleVersion[] = [
  {
    code: RC.fraudThreshold,
    value: 0,
    effectiveFrom: '2014-04-01',
    effectiveTo: '2015-12-13',
    ruleVersionId: 't1',
  },
  {
    code: RC.fraudThreshold,
    value: CRORE_1,
    effectiveFrom: '2015-12-14',
    effectiveTo: null,
    ruleVersionId: 't2',
  },
  {
    code: RC.fraudInitialNoticeDays,
    value: 2,
    effectiveFrom: '2014-04-01',
    effectiveTo: null,
    ruleVersionId: 'n1',
  },
  {
    code: RC.fraudResponseDays,
    value: 45,
    effectiveFrom: '2014-04-01',
    effectiveTo: null,
    ruleVersionId: 'r1',
  },
  {
    code: RC.fraudForwardDays,
    value: 15,
    effectiveFrom: '2014-04-01',
    effectiveTo: null,
    ruleVersionId: 'f1',
  },
];
const RULES = fraudRulesOn(VERSIONS, '2024-04-01');

function matter(partial: Partial<FraudMatterDates> = {}): FraudMatterDates {
  return {
    amount: null,
    amountEstimated: false,
    knowledgeDate: null,
    boardReportedOn: null,
    replyReceivedOn: null,
    cgForwardedOn: null,
    conclusion: FRAUD_CONCLUSION.pending,
    withdrawn: false,
    ...partial,
  };
}

describe('fraud rules resolve from the library by date', () => {
  it('reads every value with its version', () => {
    expect(RULES.thresholdAmount).toBe(CRORE_1);
    expect(RULES.initialNoticeDays).toBe(2);
    expect(RULES.responseDays).toBe(45);
    expect(RULES.forwardDays).toBe(15);
    expect(RULES.used.find((u) => u.code === RC.fraudThreshold)?.ruleVersionId).toBe('t2');
  });

  it('uses the version in force on the knowledge date (pre-amendment: every fraud to the CG)', () => {
    const old = fraudRulesOn(VERSIONS, '2015-06-30');
    expect(old.thresholdAmount).toBe(0);
    expect(fraudRoute(50_000, false, old).route).toBe('central_government');
  });

  it('returns nulls when the library holds nothing for the date', () => {
    const none = fraudRulesOn(VERSIONS, '2010-01-01');
    expect(none.thresholdAmount).toBeNull();
    expect(fraudRoute(CRORE_1, false, none).route).toBe('pending');
  });
});

describe('fraudRoute — the >= threshold test', () => {
  it('exactly ₹1 crore goes to the Central Government', () => {
    expect(fraudRoute(CRORE_1, false, RULES).route).toBe('central_government');
  });

  it('₹99.99 lakh is below the threshold → Audit Committee / Board', () => {
    const r = fraudRoute(9_999_000, false, RULES);
    expect(r.route).toBe('audit_committee_board');
    expect(r.basis).toMatch(/below/);
  });

  it('no amount yet → pending (CG steps provisional)', () => {
    expect(fraudRoute(null, false, RULES).route).toBe('pending');
  });

  it('an estimate routes the same way and says so', () => {
    const r = fraudRoute(20_000_000, true, RULES);
    expect(r.route).toBe('central_government');
    expect(r.basis).toMatch(/^Estimated amount/);
  });
});

describe('evaluateFraudMatter — Rule 13 deadlines from the event dates', () => {
  it('initial notice = knowledge + 2 days, overdue when not reported', () => {
    const e = evaluateFraudMatter(
      matter({ amount: CRORE_1, knowledgeDate: '2024-05-10' }),
      RULES,
      '2024-05-13',
    );
    const notice = e.deadlines.find((d) => d.key === 'initial_notice');
    expect(notice?.dueDate).toBe('2024-05-12');
    expect(notice?.status).toBe('overdue');
    expect(e.overdue).toBe(true);
    expect(e.regulatoryStatus).toBe('identified');
    expect(e.nextDeadline).toBe('2024-05-12');
  });

  it('a report on day 2 meets the initial notice; reply due = report + 45 days', () => {
    const e = evaluateFraudMatter(
      matter({ amount: CRORE_1, knowledgeDate: '2024-05-10', boardReportedOn: '2024-05-12' }),
      RULES,
      '2024-05-20',
    );
    expect(e.deadlines.find((d) => d.key === 'initial_notice')?.status).toBe('met');
    const reply = e.deadlines.find((d) => d.key === 'reply_due');
    expect(reply?.dueDate).toBe(addDays('2024-05-12', 45));
    expect(reply?.dueDate).toBe('2024-06-26');
    expect(e.regulatoryStatus).toBe('awaiting_reply');
    expect(e.overdue).toBe(false);
  });

  it('reply received → forward within 15 days of the reply', () => {
    const e = evaluateFraudMatter(
      matter({
        amount: CRORE_1,
        knowledgeDate: '2024-05-10',
        boardReportedOn: '2024-05-12',
        replyReceivedOn: '2024-06-20',
      }),
      RULES,
      '2024-07-10',
    );
    const fwd = e.deadlines.find((d) => d.key === 'cg_forward');
    expect(fwd?.dueDate).toBe('2024-07-05');
    expect(fwd?.status).toBe('overdue');
    expect(e.regulatoryStatus).toBe('reply_received');
    expect(e.overdue).toBe(true);
  });

  it('no reply within 45 days → forward with the Rule 13 note, due at once', () => {
    const e = evaluateFraudMatter(
      matter({ amount: CRORE_1, knowledgeDate: '2024-05-10', boardReportedOn: '2024-05-12' }),
      RULES,
      '2024-06-27',
    );
    const reply = e.deadlines.find((d) => d.key === 'reply_due');
    expect(reply?.status).toBe('overdue');
    const noReply = e.deadlines.find((d) => d.key === 'cg_forward_no_reply');
    expect(noReply?.dueDate).toBe('2024-06-26');
    expect(noReply?.days).toBe(0);
    expect(e.regulatoryStatus).toBe('no_reply');
    expect(e.overdue).toBe(true);
  });

  it('the company missing its reply is not the auditor overdue on its own', () => {
    const e = evaluateFraudMatter(
      matter({ amount: CRORE_1, boardReportedOn: '2024-05-12' }),
      RULES,
      '2024-06-26',
    );
    expect(e.deadlines.find((d) => d.key === 'reply_due')?.status).toBe('due');
    expect(e.overdue).toBe(false);
  });

  it('forwarded after a missed reply → met_late / forwarded_to_cg', () => {
    const e = evaluateFraudMatter(
      matter({
        amount: CRORE_1,
        knowledgeDate: '2024-05-10',
        boardReportedOn: '2024-05-12',
        cgForwardedOn: '2024-07-01',
      }),
      RULES,
      '2024-07-02',
    );
    expect(e.deadlines.find((d) => d.key === 'cg_forward_no_reply')?.status).toBe('met_late');
    expect(e.regulatoryStatus).toBe('forwarded_to_cg');
  });

  it('below the threshold: only the 2-day report to the AC / Board', () => {
    const e = evaluateFraudMatter(
      matter({ amount: 9_999_000, knowledgeDate: '2024-05-10', boardReportedOn: '2024-05-11' }),
      RULES,
      '2024-08-01',
    );
    expect(e.deadlines.map((d) => d.key)).toEqual(['initial_notice']);
    expect(e.regulatoryStatus).toBe('reported_to_board');
    expect(e.overdue).toBe(false);
  });

  it('pending route shows the CG steps provisionally', () => {
    const e = evaluateFraudMatter(
      matter({ knowledgeDate: '2024-05-10', boardReportedOn: '2024-05-12' }),
      RULES,
      '2024-05-13',
    );
    expect(e.route).toBe('pending');
    expect(e.deadlines.find((d) => d.key === 'reply_due')?.provisional).toBe(true);
  });

  it('a concluded or withdrawn matter is closed and never overdue', () => {
    const concluded = evaluateFraudMatter(
      matter({ amount: CRORE_1, knowledgeDate: '2024-05-10', conclusion: 'not_reportable' }),
      RULES,
      '2024-09-01',
    );
    expect(concluded.open).toBe(false);
    expect(concluded.overdue).toBe(false);
    expect(concluded.regulatoryStatus).toBe('closed');
    expect(concluded.nextDeadline).toBeNull();
  });
});

describe('fraudFrameworkStatus', () => {
  it('aggregates routes, open, overdue and the next deadline over live matters', () => {
    const cg = evaluateFraudMatter(
      matter({ amount: CRORE_1, knowledgeDate: '2024-05-10' }),
      RULES,
      '2024-05-11',
    );
    const below = evaluateFraudMatter(
      matter({ amount: 100, knowledgeDate: '2024-05-01' }),
      RULES,
      '2024-05-11',
    );
    const status = fraudFrameworkStatus(RULES, [
      { withdrawn: false, evaluation: cg },
      { withdrawn: false, evaluation: below },
      { withdrawn: true, evaluation: cg },
    ]);
    expect(status).toMatchObject({
      active: true,
      matters: 2,
      open: 2,
      centralGovernmentRoute: 1,
      belowThreshold: 1,
      overdue: 1,
      nextDeadline: '2024-05-03',
      thresholdAmount: CRORE_1,
      initialNoticeDays: 2,
      responseDays: 45,
      forwardDays: 15,
    });
  });

  it('is inactive when the Rule 13 rules are missing', () => {
    expect(fraudFrameworkStatus(fraudRulesOn([], '2024-04-01'), []).active).toBe(false);
  });
});

describe('directorStatus', () => {
  it('not_started / pending / identified / none_found', () => {
    expect(directorStatus([]).conclusion).toBe('not_started');
    expect(
      directorStatus([
        { disqualified: 'no', withdrawn: false },
        { disqualified: 'pending', withdrawn: false },
      ]).conclusion,
    ).toBe('pending');
    expect(
      directorStatus([
        { disqualified: 'yes', withdrawn: false },
        { disqualified: 'pending', withdrawn: false },
      ]),
    ).toEqual({ total: 2, pending: 1, disqualified: 1, cleared: 0, conclusion: 'identified' });
    expect(
      directorStatus([
        { disqualified: 'no', withdrawn: false },
        { disqualified: 'yes', withdrawn: true },
      ]).conclusion,
    ).toBe('none_found');
  });
});

it('fraudMatterRef pads to three digits', () => {
  expect(fraudMatterRef(1)).toBe('FM-001');
  expect(fraudMatterRef(42)).toBe('FM-042');
});
