import {
  FRAUD_ROUTE,
  FRAMEWORK_AREA_KEY,
  OTHER_REPORTING_OUTCOME,
  REMUNERATION_OUTCOME,
  RULE_CRITERION,
  formatInrCrore,
  type FraudResult,
  type FrameworkState,
  type OtherReportingBaseFacts,
  type OtherReportingDetail,
  type OtherReportingResult,
  type RemunerationResult,
  type ReportingMatter,
  type Rule11efResult,
  type Rule11gResult,
  type RuleResolver,
} from '@hsdg/contracts';

/**
 * 02.7 Other Companies Act & Statutory Reporting — pure engine (Guide §9.7).
 *
 * Configures the reporting matrix (it is not a second audit): Rule 11(g) audit
 * trail (period-gated, per-system, rule-configured retention), §197(16)
 * managerial remuneration (public-only, Section 198 basis, ceiling from the
 * library, Schedule V routing on inadequate profit), §143(12) fraud (₹1cr route
 * threshold + a Rule 13 deadline engine computing dates from the event date), and
 * the Rule 11(e)/(f) / dividend / 11(a)-(c) items. Every threshold, date offset
 * and ratio resolves from the Audit Rules Library — NO statutory number in code.
 *
 * Mirrors caro.ts so it unit-tests without a database.
 */

const AREA_143 = FRAMEWORK_AREA_KEY.section143;
const AREA_11 = FRAMEWORK_AREA_KEY.rule11;

/** Add whole days to an ISO yyyy-mm-dd date, in UTC, returning yyyy-mm-dd. */
function addDaysUtc(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function rule11g(f: OtherReportingBaseFacts, resolve: RuleResolver): Rule11gResult {
  if (!f.auditTrailInForce)
    return {
      applicable: false,
      systems: [],
      retentionYears: null,
      allAdequate: true,
      basis:
        'Rule 11(g) audit-trail reporting applies for financial years commencing on or after 1 Apr 2023 — not applicable to this audit period.',
    };
  const retentionRule = resolve(AREA_11, RULE_CRITERION.retentionYears);
  const retentionYears = retentionRule?.threshold ?? null;
  const systems = f.softwareSystems.map((s) => {
    const adequate = s.hasAuditTrailFeature && s.auditTrailOperatedAllYear;
    return {
      name: s.name,
      adequate,
      basis: adequate
        ? 'Audit-trail feature present and operated throughout the year.'
        : !s.hasAuditTrailFeature
          ? 'No audit-trail (edit-log) feature in the software.'
          : 'Audit trail did not operate throughout the year.',
    };
  });
  const allAdequate = systems.length > 0 && systems.every((s) => s.adequate);
  return {
    applicable: true,
    systems,
    retentionYears,
    allAdequate,
    basis:
      systems.length === 0
        ? 'Rule 11(g) applies — capture each accounting software/module to assess the audit trail.'
        : `Rule 11(g) applies — assessed ${systems.length} system(s); records preserved for ${retentionYears ?? '—'} years (Sec 128(5)).`,
  };
}

function remuneration(f: OtherReportingBaseFacts, resolve: RuleResolver): RemunerationResult {
  if (f.isPublicCompany !== true)
    return {
      applicable: false,
      outcome: REMUNERATION_OUTCOME.notApplicable,
      limitPercent: null,
      section198NetProfit: null,
      permittedAmount: null,
      paidAmount: f.managerialRemunerationPaid,
      scheduleVRoute: false,
      basis:
        'Section 197(16) reporting on managerial remuneration applies to public companies only.',
    };
  const limitRule = resolve(AREA_143, RULE_CRITERION.managerialRemunerationPercent);
  const limitPercent = limitRule?.threshold ?? null;
  if (f.section198NetProfit == null || f.managerialRemunerationPaid == null || limitPercent == null)
    return {
      applicable: true,
      outcome: REMUNERATION_OUTCOME.informationInsufficient,
      limitPercent,
      section198NetProfit: f.section198NetProfit,
      permittedAmount: null,
      paidAmount: f.managerialRemunerationPaid,
      scheduleVRoute: false,
      basis:
        'Section 197(16): capture the managerial remuneration paid and the Section 198 net profit to test the ceiling.',
    };
  // No / inadequate profit → the Schedule V band table governs, not the ratio.
  if (f.section198NetProfit <= 0)
    return {
      applicable: true,
      outcome: REMUNERATION_OUTCOME.scheduleVRoute,
      limitPercent,
      section198NetProfit: f.section198NetProfit,
      permittedAmount: null,
      paidAmount: f.managerialRemunerationPaid,
      scheduleVRoute: true,
      basis:
        'No or inadequate Section 198 net profit — remuneration is governed by the Schedule V band table (effective-capital slabs), not the percentage ceiling.',
    };
  const permittedAmount = (f.section198NetProfit * limitPercent) / 100;
  const within = f.managerialRemunerationPaid <= permittedAmount;
  return {
    applicable: true,
    outcome: within ? REMUNERATION_OUTCOME.withinLimit : REMUNERATION_OUTCOME.exceedsLimit,
    limitPercent,
    section198NetProfit: f.section198NetProfit,
    permittedAmount,
    paidAmount: f.managerialRemunerationPaid,
    scheduleVRoute: false,
    basis: `Managerial remuneration ${formatInrCrore(f.managerialRemunerationPaid)} vs the ${limitPercent}% ceiling on Section 198 net profit (${formatInrCrore(permittedAmount)}) — ${within ? 'within limit' : 'exceeds the limit; special approval / disclosure required'}.`,
  };
}

function fraud(f: OtherReportingBaseFacts, resolve: RuleResolver): FraudResult {
  if (!f.fraudIdentified)
    return {
      identified: false,
      route: FRAUD_ROUTE.none,
      thresholdAmount: null,
      amount: null,
      boardReplyByDate: null,
      cgForwardByDate: null,
      formReference: null,
      basis: 'No reportable fraud identified under Section 143(12).',
    };
  const thresholdRule = resolve(AREA_143, RULE_CRITERION.fraudReportingThreshold);
  const thresholdAmount = thresholdRule?.threshold ?? null;
  const replyRule = resolve(AREA_143, RULE_CRITERION.boardReplyDays);
  const cgRule = resolve(AREA_143, RULE_CRITERION.cgForwardDays);

  // Route by amount: at or above the threshold → Central Government (Form ADT-4).
  const route =
    f.fraudAmount != null && thresholdAmount != null && f.fraudAmount >= thresholdAmount
      ? FRAUD_ROUTE.centralGovernment
      : FRAUD_ROUTE.auditCommitteeBoard;

  let boardReplyByDate: string | null = null;
  let cgForwardByDate: string | null = null;
  if (f.fraudEventDate && replyRule?.threshold != null) {
    boardReplyByDate = addDaysUtc(f.fraudEventDate, replyRule.threshold);
    if (route === FRAUD_ROUTE.centralGovernment && cgRule?.threshold != null) {
      cgForwardByDate = addDaysUtc(boardReplyByDate, cgRule.threshold);
    }
  }
  const amountText =
    f.fraudAmount != null && thresholdAmount != null
      ? `${formatInrCrore(f.fraudAmount)} vs the ${formatInrCrore(thresholdAmount)} threshold`
      : 'amount not captured';
  return {
    identified: true,
    route,
    thresholdAmount,
    amount: f.fraudAmount,
    boardReplyByDate,
    cgForwardByDate,
    formReference: route === FRAUD_ROUTE.centralGovernment ? 'ADT-4' : null,
    basis:
      route === FRAUD_ROUTE.centralGovernment
        ? `Fraud ${amountText} — report to the Central Government (Form ADT-4): seek the Board/Audit-Committee reply by ${boardReplyByDate ?? '—'}, forward to the CG by ${cgForwardByDate ?? '—'}.`
        : `Fraud ${amountText} — below the CG threshold: report to the Audit Committee / Board (reply sought by ${boardReplyByDate ?? '—'}).`,
  };
}

function rule11ef(f: OtherReportingBaseFacts): Rule11efResult {
  const moved = f.intermediaryFundsAdvanced || f.ultimateBeneficiaryFundsReceived;
  const satisfied = !moved || f.fundingRepresentationsObtained;
  return {
    intermediaryFundsAdvanced: f.intermediaryFundsAdvanced,
    ultimateBeneficiaryFundsReceived: f.ultimateBeneficiaryFundsReceived,
    representationsObtained: f.fundingRepresentationsObtained,
    satisfied,
    basis: !moved
      ? 'No intermediary / ultimate-beneficiary funding movements reported (Rule 11(e)/(f)).'
      : satisfied
        ? 'Funding movements reported with the required management representations obtained (Rule 11(e)/(f)).'
        : 'Funding movements reported but the Rule 11(e)/(f) representations have not been obtained.',
  };
}

/** Aggregate the reporting matrix and derive the top-level outcome + matters. */
export function assessOtherReporting(
  f: OtherReportingBaseFacts,
  resolve: RuleResolver,
): OtherReportingResult {
  const g = rule11g(f, resolve);
  const rem = remuneration(f, resolve);
  const fr = fraud(f, resolve);
  const ef = rule11ef(f);

  const matters: ReportingMatter[] = [];
  if (g.applicable && g.systems.length > 0 && !g.allAdequate)
    matters.push({
      code: 'rule_11g_audit_trail',
      severity: 'medium',
      message: 'One or more accounting systems lack an operative audit trail (Rule 11(g)).',
    });
  if (rem.outcome === REMUNERATION_OUTCOME.exceedsLimit)
    matters.push({
      code: 'section_197_remuneration',
      severity: 'high',
      message: 'Managerial remuneration exceeds the Section 197 ceiling on Section 198 net profit.',
    });
  if (rem.outcome === REMUNERATION_OUTCOME.scheduleVRoute)
    matters.push({
      code: 'schedule_v_route',
      severity: 'medium',
      message: 'No/inadequate profit — remuneration must comply with the Schedule V band table.',
    });
  if (fr.identified)
    matters.push({
      code: 'section_143_12_fraud',
      severity: fr.route === FRAUD_ROUTE.centralGovernment ? 'high' : 'medium',
      message:
        fr.route === FRAUD_ROUTE.centralGovernment
          ? 'Reportable fraud at/above the threshold — Central Government route (ADT-4).'
          : 'Reportable fraud below the threshold — Audit Committee / Board route.',
    });
  if (!ef.satisfied)
    matters.push({
      code: 'rule_11ef_representations',
      severity: 'medium',
      message:
        'Rule 11(e)/(f) representations not obtained though funding movements were reported.',
    });
  if (f.dividendCompliesSec123 === false)
    matters.push({
      code: 'dividend_section_123',
      severity: 'medium',
      message: 'Dividend declared/paid not in compliance with Section 123.',
    });

  const detail: OtherReportingDetail = {
    rule11g: g,
    remuneration: rem,
    fraud: fr,
    rule11ef: ef,
    dividendCompliesSec123: f.dividendCompliesSec123,
    pendingLitigationDisclosed: f.pendingLitigationDisclosed,
    foreseeableLossesProvided: f.foreseeableLossesProvided,
    iepfTransferDelay: f.iepfTransferDelay,
    matters,
  };

  const state: FrameworkState = 'system_suggested_applicable';
  const outcome =
    matters.length > 0
      ? OTHER_REPORTING_OUTCOME.attentionRequired
      : OTHER_REPORTING_OUTCOME.configured;
  const basis =
    matters.length > 0
      ? `Reporting matrix configured — ${matters.length} matter(s) require attention.`
      : 'Reporting matrix configured — no outstanding statutory-reporting matters.';
  return { outcome, state, basis, ruleVersionId: null, authorityProvisionId: null, detail };
}
