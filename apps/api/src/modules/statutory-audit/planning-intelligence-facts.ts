import type { PoolClient } from 'pg';
import {
  ACCOUNTING_ENVIRONMENT_LABEL,
  CONSOLIDATION_OUTCOME_LABEL,
  CONTINUANCE_CHANGED_AREA,
  ICFR_OUTCOME_LABEL,
  REGULATOR_LABEL,
  REPORTING_FRAMEWORK_LABEL,
  SCHEDULE_III_OUTCOME_LABEL,
  SCOPE_LIMITATION_EFFECT,
  SPECIAL_ENTITY_LABEL,
  type AccountingEnvironment,
  type ConsolidationOutcome,
  type IcfrOutcome,
  type PlanningFactGroup,
  type PlanningFactItem,
  type Regulator,
  type ReportingFrameworkOutcome,
  type ScheduleIiiOutcome,
  type SpecialEntityType,
} from '@hsdg/contracts';
import { readFinancialReportingResult } from './financial-reporting-result';
import { readFrameworkApprovalOn } from './framework-approval-read';
import { readFrameworkOverridesOn } from './framework-summary-overrides';
import { readPriorYearChangesOn } from './framework-summary-prior-year';
import {
  readFrameworkEngagementOn,
  readFrameworkRecordInputsOn,
  withFrameworkInputsCacheOn,
} from './framework-summary-inputs';
import {
  auditTrailApplies,
  branchAuditorBranches,
  otherAuditorComponents,
  rule11Cards,
  s197Applies,
} from './framework-summary-records';
import { factsFingerprint, type PlanningFacts } from './planning-signal-library';

/**
 * 03.1.1 Engagement Intelligence — the confirmed Section 01/02 facts the
 * Planning Signal Library evaluates (DHVAJ 03.1 §5). DI-free: reads inside the
 * caller's RLS transaction. The source sections stay authoritative — 03.1 only
 * points at them; a wrong fact is corrected in Section 01/02.
 *
 * Returns the flat facts map the rules read, the grouped read-only panel the
 * Manager reviews, a fingerprint (stale detection) and the date the rules are
 * resolved on (the period end — period-correct rule versions).
 */
export interface PlanningIntelligenceFacts {
  facts: PlanningFacts;
  groups: PlanningFactGroup[];
  fingerprint: string;
  periodEnd: string;
}

const CARO_LABEL: Record<string, string> = {
  applicable: 'Applicable',
  not_applicable_exempt: 'Not applicable / exempt',
  further_assessment: 'Further assessment required',
  information_insufficient: 'Information pending',
};
const ACCEPTANCE_CONCLUSION_LABEL: Record<string, string> = {
  clear: 'Clear to proceed',
  subject_to_resolution: 'subject to resolution of open matters',
  partner_attention: 'with matters requiring Partner attention',
  do_not_accept: 'Do not accept',
};
const ERP = new Set(['sap', 'oracle', 'dynamics']);
const SOFTWARE_LABEL: Record<string, string> = {
  tally: 'Tally',
  sap: 'SAP',
  oracle: 'Oracle',
  dynamics: 'Microsoft Dynamics',
  zoho: 'Zoho Books',
};

/**
 * "v1.0 approved by A. Partner on 2026-10-01" — plus the conditional route and
 * any controlled revision in progress. Null before the first approval.
 */
export function baselineLine(
  approval: {
    everApproved: boolean;
    approvedVersion: string | null;
    currentVersion: string | null;
    reopened: boolean;
    planning: { route: string };
  },
  baseline: { ep_approved_at: Date | string | null; approved_by: string | null } | undefined,
): string | null {
  if (!approval.everApproved) return null;
  if (!approval.approvedVersion) return 'Approved (before the 02.8 summary existed)';
  const at = baseline?.ep_approved_at;
  const on = at ? (typeof at === 'string' ? at : at.toISOString()).slice(0, 10) : null;
  return [
    `v${approval.approvedVersion} approved`,
    baseline?.approved_by ? ` by ${baseline.approved_by}` : '',
    on ? ` on ${on}` : '',
    approval.planning.route === 'conditional' ? ', subject to conditions' : '',
    approval.reopened && approval.currentVersion
      ? `; controlled revision v${approval.currentVersion} in progress`
      : '',
  ].join('');
}

/** Keep an acceptance narrative short enough for a one-line observation. */
function brief(v: unknown, max = 240): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const choiceLabel = (list: readonly { value: string; label: string }[], v: unknown) =>
  typeof v === 'string' ? (list.find((o) => o.value === v)?.label ?? v) : null;

const yesNo = (v: boolean | null | undefined) =>
  v === null || v === undefined ? '—' : v ? 'Yes' : 'No';

interface AnswerRow {
  question_key: string;
  answer: string | null;
  details: Record<string, unknown> | null;
}

export function readPlanningIntelligenceFactsOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<PlanningIntelligenceFacts> {
  // The 02.x inputs are read once — the prior-year diff reads them again.
  return withFrameworkInputsCacheOn(client, () => readFactsOn(client, workflowInstanceId));
}

async function readFactsOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<PlanningIntelligenceFacts> {
  const inputs = await readFrameworkRecordInputsOn(client, workflowInstanceId);
  const engagement = await readFrameworkEngagementOn(client, workflowInstanceId);
  const fr = await readFinancialReportingResult(client, workflowInstanceId);
  const pyChanges = await readPriorYearChangesOn(client, workflowInstanceId);
  const approval = await readFrameworkApprovalOn(client, workflowInstanceId);
  const overrides = await readFrameworkOverridesOn(client, workflowInstanceId);

  // 02.8 — the approved baseline and its AF-02 conditions (§5 "conditions and
  // approved framework baseline"). Conditions belong to the latest approved
  // baseline; a resolved one no longer directs the plan.
  const { rows: baselineRows } = await client.query<{
    ep_approved_at: Date | null;
    approved_by: string | null;
  }>(
    `SELECT b.ep_approved_at, e.full_name AS approved_by
       FROM hsdg.audit_framework_baseline b
       LEFT JOIN hsdg.employees e ON e.id = b.ep_approved_by_employee_id
      WHERE b.id = $1`,
    [approval.approvedBaselineId],
  );
  const { rows: conditionRows } = await client.query<{ condition: string; status: string }>(
    `SELECT condition, status FROM hsdg.audit_framework_condition
      WHERE baseline_id = $1 ORDER BY created_at, id`,
    [approval.approvedBaselineId],
  );
  const openConditions = conditionRows.filter((c) => c.status === 'open');

  const { rows: profileRows } = await client.query<{
    special_entity_types: string[] | null;
    regulator: Regulator | null;
    regulator_name: string | null;
    nbfc_category: string | null;
    service_org_provider: string | null;
  }>(
    `SELECT special_entity_types, regulator, regulator_name, nbfc_category, service_org_provider
       FROM hsdg.audit_entity_profile WHERE workflow_instance_id = $1`,
    [workflowInstanceId],
  );
  const profile = profileRows[0];

  // Approved / decided Section 02 area conclusions — the fallback when a 02.x
  // sub-assessment has no outcome yet, and the only source for internal audit.
  const { rows: areas } = await client.query<{ area_key: string; conclusion: string }>(
    `SELECT area_key, conclusion FROM hsdg.audit_framework_assessments
      WHERE workflow_instance_id = $1 AND conclusion IS NOT NULL`,
    [workflowInstanceId],
  );
  const area = (k: string) => areas.find((a) => a.area_key === k)?.conclusion ?? null;

  // Latest answer per Section 01 question (a question can sit in more than one segment).
  const { rows: answerRows } = await client.query<AnswerRow>(
    `SELECT DISTINCT ON (a.question_key) a.question_key, a.answer, a.details
       FROM hsdg.audit_acceptance_answers a
       JOIN hsdg.audit_acceptance_segments s ON s.id = a.segment_id
      WHERE s.workflow_instance_id = $1
        AND a.question_key IN ('pa_05','acc_01','acc_02','acc_03','acc_06','con_01','acc_conclusion')
      ORDER BY a.question_key, a.updated_at DESC`,
    [workflowInstanceId],
  );
  const ans = (k: string) => answerRows.find((r) => r.question_key === k);
  const flagged = (k: string, values = ['yes']) => {
    const a = ans(k);
    return !!a?.answer && values.includes(a.answer);
  };
  const detail = (k: string, field: string) => brief(ans(k)?.details?.[field]);

  // ── Section 02 ──────────────────────────────────────────────────────────
  const caro = inputs.outcomes.caro ?? (area('caro') === 'applicable' ? 'applicable' : null);
  const icfr = inputs.outcomes.icfr ?? (area('ifc') === 'applicable' ? 'applicable' : null);
  const cfs = inputs.outcomes.cfs ?? (area('cfs') === 'applicable' ? 'cfs_required' : null);
  const internalAudit = area('internal_audit') === 'applicable';
  const others = otherAuditorComponents(inputs);
  const branches = branchAuditorBranches(inputs);
  const r11 = rule11Cards(inputs);
  const auditTrail = auditTrailApplies(inputs);
  const s197 = s197Applies(inputs);
  const software = inputs.accountingSoftware.map((s) => SOFTWARE_LABEL[s] ?? s);
  const special = (profile?.special_entity_types ?? [])
    .filter((t) => t !== 'dormant')
    .map((t) => SPECIAL_ENTITY_LABEL[t as SpecialEntityType] ?? t);
  if (fr?.isNbfc && !special.includes(SPECIAL_ENTITY_LABEL.nbfc))
    special.push(SPECIAL_ENTITY_LABEL.nbfc);
  const regulator = profile?.regulator
    ? profile.regulator === 'other'
      ? (profile.regulator_name?.trim() ?? REGULATOR_LABEL.other)
      : REGULATOR_LABEL[profile.regulator]
    : null;
  const scheduleIiiLabel = inputs.outcomes.scheduleIii
    ? (SCHEDULE_III_OUTCOME_LABEL[inputs.outcomes.scheduleIii as ScheduleIiiOutcome] ??
      inputs.outcomes.scheduleIii)
    : null;
  const frameworkChanges = pyChanges.available ? pyChanges.changes : [];
  const frf = fr?.framework ?? fr?.systemOutcome ?? inputs.outcomes.frf;

  // ── Section 01 ──────────────────────────────────────────────────────────
  const continuance = flagged('con_01')
    ? ((ans('con_01')?.details?.changedAreas as unknown[] | undefined) ?? [])
        .map((v) => choiceLabel(CONTINUANCE_CHANGED_AREA, v))
        .filter((v): v is string => !!v)
    : [];
  const conclusion = ans('acc_conclusion')?.answer ?? null;

  const facts: PlanningFacts = {
    initial_audit: inputs.initialAudit,
    sa510: inputs.sa510,
    sa402: inputs.sa402,
    sa299: inputs.jointAudit,
    joint_audit: inputs.jointAudit,
    joint_auditors: inputs.jointAuditors,
    service_org_provider: inputs.serviceOrgProvider ?? profile?.service_org_provider ?? null,
    accounting_environment: inputs.accountingEnvironment,
    accounting_software: software,
    records_electronic: inputs.recordsElectronic === 'yes',
    erp_system: inputs.accountingSoftware.some((s) => ERP.has(s)),
    specialists: inputs.specialists,
    entity_class: inputs.entityClass,
    listed: inputs.listingAnswer === 'yes',
    reporting_framework: frf,
    reporting_framework_label: frf
      ? (REPORTING_FRAMEWORK_LABEL[frf as ReportingFrameworkOutcome] ?? frf)
      : null,
    first_time_ind_as: fr?.firstTimeAdoption ?? false,
    schedule_iii: inputs.outcomes.scheduleIii,
    schedule_iii_label: scheduleIiiLabel,
    caro,
    icfr,
    cfs,
    internal_audit: internalAudit,
    other_auditor_components: others.length,
    other_auditor_component_names: others.map((c) =>
      c.firmName?.trim() ? `${c.name} (${c.firmName.trim()})` : c.name,
    ),
    branch_auditors: branches.length,
    branch_auditor_names: branches.map((b) => `${b.name} (${b.firmName!.trim()})`),
    rule_11_items: r11.length,
    rule_11_labels: r11.map((c) => c.requirement),
    audit_trail: auditTrail === true,
    s197: s197 === true,
    special_entity_types: special,
    regulator,
    nbfc: fr?.isNbfc ?? false,
    predecessor_matters: flagged('pa_05'),
    predecessor_detail: detail('pa_05', 'matterCommunicated'),
    integrity_concern: flagged('acc_01', ['yes', 'pending']),
    integrity_detail: detail('acc_01', 'matter'),
    legal_regulatory_concern: flagged('acc_02', ['yes', 'pending']),
    legal_detail: detail('acc_02', 'description'),
    scope_limitation: flagged('acc_03'),
    scope_limitation_detail: detail('acc_03', 'description'),
    scope_limitation_effect: choiceLabel(SCOPE_LIMITATION_EFFECT, ans('acc_03')?.details?.effect),
    other_acceptance_matter: flagged('acc_06'),
    other_acceptance_detail: detail('acc_06', 'explanation'),
    continuance_changes: continuance,
    acceptance_conclusion: conclusion,
    acceptance_conclusion_label: conclusion
      ? (ACCEPTANCE_CONCLUSION_LABEL[conclusion] ?? conclusion)
      : null,
    framework_changes: frameworkChanges.length,
    framework_change_labels: frameworkChanges.map((c) =>
      c.previous || c.current ? `${c.label} (${c.previous ?? '—'} → ${c.current ?? '—'})` : c.label,
    ),
    framework_overrides: overrides.length,
    framework_override_labels: overrides.map(
      (o) => `${o.title} (${o.systemResult ?? '—'} → ${o.conclusion ?? '—'})`,
    ),
    framework_open_conditions: openConditions.length,
    framework_open_condition_labels: openConditions.map((c) => brief(c.condition, 160) ?? ''),
  };

  // ── Read-only panel (grouped by owning section) ─────────────────────────
  const item = (
    key: string,
    label: string,
    value: string | null | undefined,
    sourceLink: string | null,
  ): PlanningFactItem | null =>
    value === null || value === undefined || value === ''
      ? null
      : { key, label, value, sourceLink };
  const group = (
    key: string,
    title: string,
    section: string,
    items: Array<PlanningFactItem | null>,
  ): PlanningFactGroup | null => {
    const kept = items.filter((i): i is PlanningFactItem => i !== null);
    return kept.length ? { key, title, section, items: kept } : null;
  };
  const acceptanceValue = (k: string, text: string | null) =>
    ans(k)?.answer ? (flagged(k, ['yes', 'pending']) ? (text ?? 'Yes') : 'No') : null;

  const groups = [
    group('acceptance', 'Acceptance & continuance', '01', [
      item(
        'predecessor',
        'Predecessor auditor matters',
        acceptanceValue('pa_05', facts.predecessor_detail as string | null),
        'acceptance:question-pa_05',
      ),
      item(
        'continuance',
        'Changes since last year',
        ans('con_01')?.answer
          ? continuance.length
            ? continuance.join(', ')
            : 'None reported'
          : null,
        'acceptance:question-con_01',
      ),
      item(
        'integrity',
        'Integrity of management / TCWG',
        acceptanceValue('acc_01', facts.integrity_detail as string | null),
        'acceptance:question-acc_01',
      ),
      item(
        'legal',
        'Legal / regulatory / fraud / reputation',
        acceptanceValue('acc_02', facts.legal_detail as string | null),
        'acceptance:question-acc_02',
      ),
      item(
        'scope',
        'Scope limitation',
        acceptanceValue('acc_03', facts.scope_limitation_detail as string | null),
        'acceptance:question-acc_03',
      ),
      item(
        'specialists',
        'Specialists required',
        inputs.specialists.length ? inputs.specialists.join(', ') : null,
        'acceptance:question-acc_04',
      ),
      item(
        'other',
        'Other acceptance matter',
        acceptanceValue('acc_06', facts.other_acceptance_detail as string | null),
        'acceptance:question-acc_06',
      ),
      item(
        'conclusion',
        'Acceptance conclusion',
        conclusion
          ? (ACCEPTANCE_CONCLUSION_LABEL[conclusion] ?? conclusion).replace(/^./, (c) =>
              c.toUpperCase(),
            )
          : null,
        'acceptance:question-acc_conclusion',
      ),
    ]),
    group('entity', 'Entity & regulatory profile', '02.1', [
      item('entity_class', 'Entity class', inputs.entityClass, 'framework:02.1'),
      item(
        'listed',
        'Listed',
        inputs.listingAnswer
          ? inputs.listingAnswer === 'yes'
            ? 'Yes'
            : inputs.listingAnswer === 'no'
              ? 'No'
              : 'Pending'
          : null,
        'framework:02.1',
      ),
      item('initial_audit', 'Initial audit', yesNo(inputs.initialAudit), 'framework:02.1'),
      item(
        'joint_audit',
        'Joint audit',
        inputs.jointAudit
          ? inputs.jointAuditors.length
            ? `Yes — ${inputs.jointAuditors.join(', ')}`
            : 'Yes'
          : 'No',
        'framework:02.1',
      ),
      item(
        'accounting_environment',
        'Accounting environment',
        inputs.accountingEnvironment
          ? (ACCOUNTING_ENVIRONMENT_LABEL[inputs.accountingEnvironment as AccountingEnvironment] ??
              inputs.accountingEnvironment)
          : null,
        'framework:02.1',
      ),
      item(
        'service_org',
        'Service organisation',
        inputs.sa402 ? ((facts.service_org_provider as string | null) ?? 'Yes') : null,
        'framework:02.1',
      ),
      item(
        'software',
        'Accounting software',
        software.length ? software.join(', ') : null,
        'framework:02.1',
      ),
      item(
        'special',
        'Special / regulated entity',
        special.length
          ? `${special.join(', ')}${regulator ? ` (regulator: ${regulator})` : ''}`
          : regulator,
        'framework:02.1',
      ),
      item(
        'internal_audit',
        'Internal audit function',
        area('internal_audit') ? yesNo(internalAudit) : null,
        'framework:02.1',
      ),
    ]),
    group('framework', 'Reporting framework & applicability', '02.2', [
      item(
        'frf',
        'Financial reporting framework',
        facts.reporting_framework_label as string | null,
        'framework:02.2',
      ),
      item(
        'first_time',
        'First-time Ind AS adoption',
        fr ? yesNo(fr.firstTimeAdoption) : null,
        'framework:02.2',
      ),
      item('schedule_iii', 'Schedule III', scheduleIiiLabel, 'framework:02.3'),
      item('caro', 'CARO 2020', caro ? (CARO_LABEL[caro] ?? caro) : null, 'framework:02.4'),
      item(
        'icfr',
        'ICFR reporting',
        icfr ? (ICFR_OUTCOME_LABEL[icfr as IcfrOutcome] ?? icfr) : null,
        'framework:02.5',
      ),
    ]),
    group('group', 'Consolidation & group audit', '02.6', [
      item(
        'cfs',
        'Consolidated financial statements',
        cfs ? (CONSOLIDATION_OUTCOME_LABEL[cfs as ConsolidationOutcome] ?? cfs) : null,
        'framework:02.6',
      ),
      item(
        'perimeter',
        'Group perimeter',
        inputs.perimeter.length ? `${inputs.perimeter.length} investee(s)` : null,
        'framework:02.6',
      ),
      item(
        'other_auditors',
        'Components audited by other auditors',
        others.length ? (facts.other_auditor_component_names as string[]).join('; ') : null,
        'framework:02.6',
      ),
      item(
        'branch_auditors',
        'Branch auditors',
        branches.length ? (facts.branch_auditor_names as string[]).join('; ') : null,
        'framework:02.6',
      ),
    ]),
    group('reporting', 'Other statutory reporting', '02.7', [
      item(
        'rule_11',
        'Rule 11 matters',
        r11.length ? r11.map((c) => c.requirement).join('; ') : null,
        'framework:02.7',
      ),
      item(
        'audit_trail',
        'Audit trail (Rule 11(g))',
        auditTrail === null ? null : yesNo(auditTrail),
        'framework:02.7',
      ),
      item('s197', 'Section 197(16)', s197 === null ? null : yesNo(s197), 'framework:02.7'),
    ]),
    group('changes', 'Audit Framework approval & changes', '02.8', [
      item(
        'baseline',
        'Approved baseline',
        baselineLine(approval, baselineRows[0]),
        'framework:02.8',
      ),
      item(
        'py',
        pyChanges.available ? (pyChanges.priorPeriodLabel ?? 'Prior year') : 'Prior year',
        pyChanges.available
          ? frameworkChanges.length
            ? (facts.framework_change_labels as string[]).join('; ')
            : 'No change'
          : pyChanges.reason,
        'framework:02.8',
      ),
      approval.everApproved
        ? item(
            'overrides',
            'System overrides',
            overrides.length
              ? overrides
                  .map(
                    (o) =>
                      `${o.title}: ${o.systemResult ?? '—'} → ${o.conclusion ?? '—'}${o.reason ? ` (${brief(o.reason, 120)})` : ''}`,
                  )
                  .join('; ')
              : 'None',
            'framework:02.8',
          )
        : null,
      conditionRows.length
        ? item(
            'conditions',
            'Approval conditions',
            openConditions.length
              ? `${openConditions.length} of ${conditionRows.length} open — ${(facts.framework_open_condition_labels as string[]).join('; ')}`
              : `All ${conditionRows.length} resolved`,
            'framework:02.8',
          )
        : null,
    ]),
  ].filter((g): g is PlanningFactGroup => g !== null);

  return {
    facts,
    groups,
    fingerprint: factsFingerprint(facts),
    periodEnd: engagement?.periodEnd ?? new Date().toISOString().slice(0, 10),
  };
}
