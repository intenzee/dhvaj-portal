import {
  FRAUD_CONCLUSION,
  FRAUD_DEADLINE_KEY,
  FRAUD_MATTER_ROUTE,
  FRAUD_REGULATORY_STATUS,
  OTHER_REPORTING_RULE_CODE,
  type DirectorDisqualificationStatus,
  type FraudConclusion,
  type FraudDeadline,
  type FraudFrameworkStatus,
  type FraudMatterRoute,
  type FraudRegulatoryStatus,
  type FraudRules,
  type Tri,
} from '@hsdg/contracts';

/**
 * 02.7 §14 — the pure Section 143(12) / Rule 13 engine (no I/O):
 *
 *   • route: amount (or estimate) ≥ the FRAUD_CG_THRESHOLD in force on the date
 *     knowledge was obtained → Central Government (Rule 13(1)–(2), Form ADT-4);
 *     below it → Audit Committee / Board (Rule 13(3)); no amount yet → pending
 *     (the Central Government steps are shown provisionally);
 *   • deadlines run from the legally relevant event dates — knowledge, report to
 *     the Board / Audit Committee, reply received — never the engagement date:
 *       initial notice   knowledge + FRAUD_INITIAL_NOTICE_DAYS (2)
 *       reply due        report    + FRAUD_BOARD_REPLY_DAYS (45)
 *       forward to CG    reply     + FRAUD_CG_FORWARD_DAYS (15)
 *       no reply         forward with the Rule 13 note once the reply is overdue;
 *   • the regulatory status is derived, never stored.
 *
 * Every number comes from the Rules Library; nothing here is hard-coded.
 */

/** One effective-dated Rules Library value (audit_rule_version by audit_rule.code). */
export interface FraudRuleVersion {
  code: string;
  value: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  ruleVersionId: string;
}

const RULE_LABEL: Record<string, string> = {
  [OTHER_REPORTING_RULE_CODE.fraudThreshold]: 'Central Government reporting threshold (Rule 13)',
  [OTHER_REPORTING_RULE_CODE.fraudInitialNoticeDays]:
    'Report to the Board / Audit Committee within (days of knowledge)',
  [OTHER_REPORTING_RULE_CODE.fraudResponseDays]: 'Reply / observations due within (days)',
  [OTHER_REPORTING_RULE_CODE.fraudForwardDays]:
    'Forward to the Central Government within (days of reply)',
};
const RULE_UNIT: Record<string, string> = {
  [OTHER_REPORTING_RULE_CODE.fraudThreshold]: 'inr',
  [OTHER_REPORTING_RULE_CODE.fraudInitialNoticeDays]: 'days',
  [OTHER_REPORTING_RULE_CODE.fraudResponseDays]: 'days',
  [OTHER_REPORTING_RULE_CODE.fraudForwardDays]: 'days',
};
export const FRAUD_RULE_CODES: string[] = [
  OTHER_REPORTING_RULE_CODE.fraudThreshold,
  OTHER_REPORTING_RULE_CODE.fraudInitialNoticeDays,
  OTHER_REPORTING_RULE_CODE.fraudResponseDays,
  OTHER_REPORTING_RULE_CODE.fraudForwardDays,
];

/** The version of `code` in force on `onDate` (yyyy-mm-dd). */
function versionOn(
  versions: FraudRuleVersion[],
  code: string,
  onDate: string,
): FraudRuleVersion | null {
  let best: FraudRuleVersion | null = null;
  for (const v of versions) {
    if (v.code !== code) continue;
    if (v.effectiveFrom > onDate) continue;
    if (v.effectiveTo !== null && v.effectiveTo < onDate) continue;
    if (!best || v.effectiveFrom > best.effectiveFrom) best = v;
  }
  return best;
}

/** The fraud Rules Library values in force on `onDate`. */
export function fraudRulesOn(versions: FraudRuleVersion[], onDate: string): FraudRules {
  const used = FRAUD_RULE_CODES.map((code) => {
    const v = versionOn(versions, code, onDate);
    return {
      code,
      label: RULE_LABEL[code] ?? code,
      value: v?.value ?? null,
      unit: RULE_UNIT[code] ?? '',
      effectiveFrom: v?.effectiveFrom ?? null,
      ruleVersionId: v?.ruleVersionId ?? null,
    };
  });
  const value = (code: string) => used.find((u) => u.code === code)?.value ?? null;
  return {
    thresholdAmount: value(OTHER_REPORTING_RULE_CODE.fraudThreshold),
    initialNoticeDays: value(OTHER_REPORTING_RULE_CODE.fraudInitialNoticeDays),
    responseDays: value(OTHER_REPORTING_RULE_CODE.fraudResponseDays),
    forwardDays: value(OTHER_REPORTING_RULE_CODE.fraudForwardDays),
    used,
  };
}

/** The Rule 13 framework can run (threshold and the 45 / 15-day periods resolve). */
export function fraudRulesActive(rules: FraudRules): boolean {
  return (
    rules.thresholdAmount !== null && rules.responseDays !== null && rules.forwardDays !== null
  );
}

// ── dates (ISO yyyy-mm-dd, UTC calendar days) ──────────────────────────────

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// ── route ─────────────────────────────────────────────────────────────────

export interface FraudRouteResult {
  route: FraudMatterRoute;
  basis: string;
}

/** Route one matter. The test is `>=` (Rule 13: "rupees one crore or above"). */
export function fraudRoute(
  amount: number | null,
  amountEstimated: boolean,
  rules: FraudRules,
): FraudRouteResult {
  const threshold = rules.thresholdAmount;
  if (threshold === null) {
    return {
      route: FRAUD_MATTER_ROUTE.pending,
      basis: 'The Rules Library holds no Central Government threshold for this date.',
    };
  }
  if (amount === null) {
    return {
      route: FRAUD_MATTER_ROUTE.pending,
      basis:
        'No amount or estimate recorded yet — the Central Government steps are shown ' +
        'provisionally until the amount involved (or expected to be involved) is known.',
    };
  }
  const what = amountEstimated ? 'Estimated amount' : 'Amount';
  if (amount >= threshold) {
    return {
      route: FRAUD_MATTER_ROUTE.centralGovernment,
      basis:
        threshold === 0
          ? `${what} ${inr(amount)} — every fraud is reported to the Central Government under the Rule 13 version in force on the knowledge date.`
          : `${what} ${inr(amount)} is at or above the ${inr(threshold)} threshold in force on the knowledge date.`,
    };
  }
  return {
    route: FRAUD_MATTER_ROUTE.auditCommitteeBoard,
    basis: `${what} ${inr(amount)} is below the ${inr(threshold)} threshold in force on the knowledge date — report to the Audit Committee / Board; the Board's report discloses it.`,
  };
}

// ── deadlines ─────────────────────────────────────────────────────────────

export interface FraudMatterDates {
  amount: number | null;
  amountEstimated: boolean;
  knowledgeDate: string | null;
  boardReportedOn: string | null;
  replyReceivedOn: string | null;
  cgForwardedOn: string | null;
  conclusion: FraudConclusion;
  withdrawn: boolean;
}

export interface FraudMatterEvaluation {
  route: FraudMatterRoute;
  routeBasis: string;
  regulatoryStatus: FraudRegulatoryStatus;
  deadlines: FraudDeadline[];
  overdue: boolean;
  nextDeadline: string | null;
  open: boolean;
}

function deadline(
  key: FraudDeadline['key'],
  label: string,
  fromEvent: string,
  fromDate: string,
  days: number,
  metOn: string | null,
  today: string,
  provisional: boolean,
  ruleCode: string,
): FraudDeadline {
  const dueDate = addDays(fromDate, days);
  const status: FraudDeadline['status'] = metOn
    ? metOn <= dueDate
      ? 'met'
      : 'met_late'
    : today > dueDate
      ? 'overdue'
      : 'due';
  return { key, label, fromEvent, fromDate, days, dueDate, metOn, status, provisional, ruleCode };
}

/**
 * Evaluate one matter. `rules` are those in force on its knowledge date (the
 * caller resolves them — the period start only when no knowledge date exists).
 */
export function evaluateFraudMatter(
  m: FraudMatterDates,
  rules: FraudRules,
  today: string,
): FraudMatterEvaluation {
  const { route, basis } = fraudRoute(m.amount, m.amountEstimated, rules);
  const open = !m.withdrawn && m.conclusion === FRAUD_CONCLUSION.pending;
  const cgSteps = route !== FRAUD_MATTER_ROUTE.auditCommitteeBoard;
  const provisional = route === FRAUD_MATTER_ROUTE.pending;
  const deadlines: FraudDeadline[] = [];

  if (m.knowledgeDate && rules.initialNoticeDays !== null) {
    deadlines.push(
      deadline(
        FRAUD_DEADLINE_KEY.initialNotice,
        route === FRAUD_MATTER_ROUTE.auditCommitteeBoard
          ? 'Report to the Audit Committee / Board (nature, approximate amount, parties)'
          : 'Report to the Board / Audit Committee seeking reply or observations',
        'Date knowledge obtained',
        m.knowledgeDate,
        rules.initialNoticeDays,
        m.boardReportedOn,
        today,
        false,
        OTHER_REPORTING_RULE_CODE.fraudInitialNoticeDays,
      ),
    );
  }

  if (cgSteps && m.boardReportedOn && rules.responseDays !== null) {
    const reply = deadline(
      FRAUD_DEADLINE_KEY.replyDue,
      'Reply / observations of the Board / Audit Committee due',
      'Reported to the Board / Audit Committee',
      m.boardReportedOn,
      rules.responseDays,
      m.replyReceivedOn,
      today,
      provisional,
      OTHER_REPORTING_RULE_CODE.fraudResponseDays,
    );
    // The reply is the company's obligation: "overdue" here is not the
    // auditor's breach — it opens the no-reply forward.
    deadlines.push(reply);

    if (m.replyReceivedOn && rules.forwardDays !== null) {
      deadlines.push(
        deadline(
          FRAUD_DEADLINE_KEY.cgForward,
          'Forward the report, reply and comments to the Central Government (Form ADT-4)',
          'Reply / observations received',
          m.replyReceivedOn,
          rules.forwardDays,
          m.cgForwardedOn,
          today,
          provisional,
          OTHER_REPORTING_RULE_CODE.fraudForwardDays,
        ),
      );
    } else if (!m.replyReceivedOn && (today > reply.dueDate || m.cgForwardedOn)) {
      // No reply within the response period: forward with the Rule 13 note.
      // Rule 13 sets no further period — the forward is due at once.
      deadlines.push(
        deadline(
          FRAUD_DEADLINE_KEY.cgForwardNoReply,
          'No reply received — forward to the Central Government with the Rule 13 note (Form ADT-4)',
          'Response period ended without a reply',
          reply.dueDate,
          0,
          m.cgForwardedOn,
          today,
          provisional,
          OTHER_REPORTING_RULE_CODE.fraudResponseDays,
        ),
      );
    }
  }

  // The auditor's own steps — the reply is the company's — count as overdue.
  const auditorSteps = deadlines.filter((d) => d.key !== FRAUD_DEADLINE_KEY.replyDue);
  const overdue = open && auditorSteps.some((d) => d.status === 'overdue');
  const pendingDue = open
    ? deadlines
        .filter((d) => d.metOn === null)
        .map((d) => d.dueDate)
        .sort()
    : [];

  return {
    route,
    routeBasis: basis,
    regulatoryStatus: regulatoryStatusOf(m, route, deadlines),
    deadlines,
    overdue,
    nextDeadline: pendingDue[0] ?? null,
    open,
  };
}

function regulatoryStatusOf(
  m: FraudMatterDates,
  route: FraudMatterRoute,
  deadlines: FraudDeadline[],
): FraudRegulatoryStatus {
  if (m.withdrawn || m.conclusion !== FRAUD_CONCLUSION.pending) {
    return m.cgForwardedOn ? FRAUD_REGULATORY_STATUS.forwardedToCg : FRAUD_REGULATORY_STATUS.closed;
  }
  if (m.cgForwardedOn) return FRAUD_REGULATORY_STATUS.forwardedToCg;
  if (!m.boardReportedOn) return FRAUD_REGULATORY_STATUS.identified;
  if (route === FRAUD_MATTER_ROUTE.auditCommitteeBoard) {
    return FRAUD_REGULATORY_STATUS.reportedToBoard;
  }
  if (m.replyReceivedOn) return FRAUD_REGULATORY_STATUS.replyReceived;
  if (deadlines.some((d) => d.key === FRAUD_DEADLINE_KEY.cgForwardNoReply)) {
    return FRAUD_REGULATORY_STATUS.noReply;
  }
  return FRAUD_REGULATORY_STATUS.awaitingReply;
}

/** Aggregate the evaluated matters into Track A's FraudFrameworkStatus. */
export function fraudFrameworkStatus(
  periodRules: FraudRules,
  matters: Array<{ withdrawn: boolean; evaluation: FraudMatterEvaluation }>,
): FraudFrameworkStatus {
  const live = matters.filter((m) => !m.withdrawn);
  const next = live
    .map((m) => m.evaluation.nextDeadline)
    .filter((d): d is string => d !== null)
    .sort();
  return {
    active: fraudRulesActive(periodRules),
    matters: live.length,
    open: live.filter((m) => m.evaluation.open).length,
    centralGovernmentRoute: live.filter(
      (m) => m.evaluation.route === FRAUD_MATTER_ROUTE.centralGovernment,
    ).length,
    belowThreshold: live.filter(
      (m) => m.evaluation.route === FRAUD_MATTER_ROUTE.auditCommitteeBoard,
    ).length,
    overdue: live.filter((m) => m.evaluation.overdue).length,
    nextDeadline: next[0] ?? null,
    thresholdAmount: periodRules.thresholdAmount,
    initialNoticeDays: periodRules.initialNoticeDays,
    responseDays: periodRules.responseDays,
    forwardDays: periodRules.forwardDays,
  };
}

// ── §12 director workpaper ────────────────────────────────────────────────

export function directorStatus(
  rows: Array<{ disqualified: Tri; withdrawn: boolean }>,
): DirectorDisqualificationStatus {
  const live = rows.filter((r) => !r.withdrawn);
  const pending = live.filter((r) => r.disqualified === 'pending').length;
  const disqualified = live.filter((r) => r.disqualified === 'yes').length;
  const cleared = live.filter((r) => r.disqualified === 'no').length;
  const conclusion: DirectorDisqualificationStatus['conclusion'] =
    live.length === 0
      ? 'not_started'
      : disqualified > 0
        ? 'identified'
        : pending > 0
          ? 'pending'
          : 'none_found';
  return { total: live.length, pending, disqualified, cleared, conclusion };
}

/** FM-001 */
export const fraudMatterRef = (seq: number) => `FM-${String(seq).padStart(3, '0')}`;
