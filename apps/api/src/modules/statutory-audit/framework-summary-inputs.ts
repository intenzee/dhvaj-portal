import type { PoolClient } from 'pg';
import {
  DEFAULT_METHODOLOGY_VERSION,
  FRAMEWORK_AREA_KEY,
  SUB_SECTION_KEY,
  specialistLabels,
  type AcceptanceDetails,
  type FrameworkState,
  type JointAuditor,
  type ReportingApplicability,
} from '@hsdg/contracts';
import { componentsFromDetail } from './consolidation-read';
import { periodEndFromFinancialYear } from './master-facts';
import { readOtherReportingResultOn } from './other-reporting-read';
import type { FrameworkRecordInputs } from './framework-summary-records';

/**
 * DI-free reader of everything the 02.8 Track B rules read (spec §5–§8, §16):
 * the 02.1 profile, each 02.x outcome (conclusion when decided, else the stored
 * system suggestion), the 02.6 perimeter / group-audit auditors, the 02.7
 * cards, ACC-04 specialists and the cited rule versions. Runs inside the
 * caller's RLS transaction and never imports a service (Nest DI cycle).
 */

const DECIDED = new Set<FrameworkState>(['applicable', 'not_applicable', 'overridden', 'approved']);

const SUBS: Array<{ key: keyof FrameworkRecordInputs['outcomes']; sub: string; area: string }> = [
  {
    key: 'frf',
    sub: SUB_SECTION_KEY.financialReporting,
    area: FRAMEWORK_AREA_KEY.financialReportingFramework,
  },
  { key: 'scheduleIii', sub: SUB_SECTION_KEY.scheduleIii, area: FRAMEWORK_AREA_KEY.scheduleIii },
  { key: 'caro', sub: SUB_SECTION_KEY.caro, area: FRAMEWORK_AREA_KEY.caro },
  { key: 'icfr', sub: SUB_SECTION_KEY.icfr, area: FRAMEWORK_AREA_KEY.ifc },
  { key: 'cfs', sub: SUB_SECTION_KEY.consolidation, area: FRAMEWORK_AREA_KEY.cfs },
  {
    key: 'otherReporting',
    sub: SUB_SECTION_KEY.otherReporting,
    area: FRAMEWORK_AREA_KEY.otherRegulatory,
  },
];

export interface FrameworkEngagementFacts {
  engagementId: string;
  financialYear: string;
  periodLabel: string | null;
  periodEnd: string;
  predecessorEngagementId: string | null;
  managerId: string | null;
  partnerId: string | null;
  managerName: string | null;
  partnerName: string | null;
}

export async function readFrameworkEngagementOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<FrameworkEngagementFacts | null> {
  const { rows } = await client.query<{
    engagement_id: string;
    financial_year: string;
    period_label: string | null;
    predecessor_engagement_id: string | null;
    engagement_manager_id: string | null;
    engagement_partner_id: string | null;
    manager_name: string | null;
    partner_name: string | null;
  }>(
    `SELECT e.id AS engagement_id, e.financial_year, e.period_label, e.predecessor_engagement_id,
            e.engagement_manager_id, e.engagement_partner_id,
            em.full_name AS manager_name, ep.full_name AS partner_name
       FROM hsdg.service_workflow_instances wi
       JOIN hsdg.engagements e ON e.id = wi.engagement_id
       LEFT JOIN hsdg.employees em ON em.id = e.engagement_manager_id
       LEFT JOIN hsdg.employees ep ON ep.id = e.engagement_partner_id
      WHERE wi.id = $1`,
    [workflowInstanceId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    engagementId: r.engagement_id,
    financialYear: r.financial_year,
    periodLabel: r.period_label,
    periodEnd:
      periodEndFromFinancialYear(r.financial_year) ?? new Date().toISOString().slice(0, 10),
    predecessorEngagementId: r.predecessor_engagement_id,
    managerId: r.engagement_manager_id,
    partnerId: r.engagement_partner_id,
    managerName: r.manager_name,
    partnerName: r.partner_name,
  };
}

export async function readFrameworkRecordInputsOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<FrameworkRecordInputs> {
  const { rows: profileRows } = await client.query<{
    initial_audit: boolean | null;
    joint_audit: boolean | null;
    sa510_flag: boolean | null;
    sa402_flag: boolean | null;
    sa299_flag: boolean | null;
    service_org_provider: string | null;
    joint_auditors: JointAuditor[] | null;
    accounting_environment: string | null;
    accounting_software: string | null;
    accounting_software_other: string | null;
    records_electronic: string | null;
    listing_answer: string | null;
    small_company_outcome: string | null;
    small_company_override: string | null;
    methodology_version: string | null;
    small_company_rule_version_id: string | null;
    entity_class: string | null;
  }>(
    `SELECT p.initial_audit, p.joint_audit, p.sa510_flag, p.sa402_flag, p.sa299_flag,
            p.service_org_provider, p.joint_auditors, p.accounting_environment,
            p.accounting_software, p.accounting_software_other, p.records_electronic,
            p.listing_answer, p.small_company_outcome, p.small_company_override,
            p.methodology_version, p.small_company_rule_version_id, et.name AS entity_class
       FROM hsdg.service_workflow_instances wi
       JOIN hsdg.engagements e ON e.id = wi.engagement_id
       JOIN hsdg.entities en ON en.id = e.entity_id
       JOIN hsdg.entity_types et ON et.id = en.entity_type_id
       LEFT JOIN hsdg.audit_entity_profile p ON p.workflow_instance_id = wi.id
      WHERE wi.id = $1`,
    [workflowInstanceId],
  );
  const p = profileRows[0];

  const { rows: subs } = await client.query<{
    sub_section_key: string;
    area_key: string;
    state: FrameworkState;
    conclusion: string | null;
    system_outcome: string | null;
    system_detail: Record<string, unknown> | null;
    rule_version_id: string | null;
  }>(
    `SELECT sub_section_key, area_key, state, conclusion, system_outcome, system_detail,
            rule_version_id
       FROM hsdg.audit_framework_subassessment
      WHERE workflow_instance_id = $1`,
    [workflowInstanceId],
  );
  const subOf = (sub: string, area: string) =>
    subs.find((s) => s.sub_section_key === sub && s.area_key === area);
  const outcomes = {
    frf: null,
    smc: null,
    scheduleIii: null,
    caro: null,
    icfr: null,
    cfs: null,
    otherReporting: null,
  } as FrameworkRecordInputs['outcomes'];
  for (const s of SUBS) {
    const r = subOf(s.sub, s.area);
    if (!r) continue;
    outcomes[s.key] = DECIDED.has(r.state) && r.conclusion ? r.conclusion : r.system_outcome;
  }
  const frf = subOf(
    SUB_SECTION_KEY.financialReporting,
    FRAMEWORK_AREA_KEY.financialReportingFramework,
  );
  const frfDetail = frf?.system_detail as { smcStatus?: string; smc?: { status?: string } } | null;
  outcomes.smc = frfDetail?.smc?.status ?? frfDetail?.smcStatus ?? null;
  const cfs = subOf(SUB_SECTION_KEY.consolidation, FRAMEWORK_AREA_KEY.cfs);
  const groupFramework =
    frf && DECIDED.has(frf.state) && frf.conclusion
      ? frf.conclusion
      : (frf?.system_outcome ?? null);

  const { rows: components } = await client.query<{
    component_name: string;
    auditor_type: string | null;
    firm_name: string | null;
  }>(
    `SELECT component_name, auditor_type, firm_name FROM hsdg.audit_group_component
      WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL ORDER BY sort_order, component_name`,
    [workflowInstanceId],
  );
  const { rows: branches } = await client.query<{ branch_name: string; firm_name: string | null }>(
    `SELECT branch_name, firm_name FROM hsdg.audit_group_branch
      WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL ORDER BY sort_order, branch_name`,
    [workflowInstanceId],
  );
  const other = await readOtherReportingResultOn(client, workflowInstanceId);

  const { rows: specialistRows } = await client.query<{ details: AcceptanceDetails | null }>(
    `SELECT a.details FROM hsdg.audit_acceptance_answers a
       JOIN hsdg.audit_acceptance_segments s ON s.id = a.segment_id
      WHERE s.workflow_instance_id = $1 AND a.question_key = 'acc_04' AND a.answer = 'specialist'`,
    [workflowInstanceId],
  );
  const specialists = [
    ...new Set(specialistRows.flatMap((r) => specialistLabels(r.details ?? undefined))),
  ];

  const cited = [
    ...subs.map((s) => s.rule_version_id),
    p?.small_company_rule_version_id ?? null,
  ].filter((x): x is string => !!x);
  const { rows: rules } = cited.length
    ? await client.query<{ code: string; version: number }>(
        `SELECT DISTINCT r.code, rv.version
           FROM hsdg.audit_rule_version rv JOIN hsdg.audit_rule r ON r.id = rv.audit_rule_id
          WHERE rv.id = ANY($1::uuid[])`,
        [cited],
      )
    : { rows: [] };

  const software = p?.accounting_software
    ? [
        p.accounting_software === 'other' && p.accounting_software_other?.trim()
          ? p.accounting_software_other.trim()
          : p.accounting_software,
      ]
    : [];

  return {
    initialAudit: p?.initial_audit === true,
    sa510: p?.sa510_flag === true,
    sa402: p?.sa402_flag === true,
    jointAudit: p?.joint_audit === true || p?.sa299_flag === true,
    serviceOrgProvider: p?.service_org_provider ?? null,
    jointAuditors: (p?.joint_auditors ?? []).map((j) => j.firmName).filter((n) => n?.trim()),
    accountingEnvironment: p?.accounting_environment ?? null,
    accountingSoftware: software,
    recordsElectronic: p?.records_electronic ?? null,
    specialists,
    entityClass: p?.entity_class ?? null,
    listingAnswer: p?.listing_answer ?? null,
    smallCompanyOutcome: p?.small_company_override ?? p?.small_company_outcome ?? null,
    outcomes,
    groupFramework,
    perimeter: componentsFromDetail(cfs?.system_detail ?? null).map((c) => ({
      name: c.name,
      relationship: c.relationship,
      included: c.included,
    })),
    components: components.map((c) => ({
      name: c.component_name,
      auditorType: c.auditor_type,
      firmName: c.firm_name,
    })),
    branches: branches.map((b) => ({ name: b.branch_name, firmName: b.firm_name })),
    cards: (other?.cards ?? []).map((c) => ({
      key: c.key,
      applicability: c.applicability as ReportingApplicability,
      requirement: c.requirement,
    })),
    ruleVersions: rules.map((r) => ({ ruleCode: r.code, versionLabel: `v${r.version}` })),
    methodologyVersion: p?.methodology_version ?? DEFAULT_METHODOLOGY_VERSION,
  };
}

/** Resolve Provision Library codes to the version applicable on `on` (§5 View Standard). */
export async function resolveProvisionIdsOn(
  client: PoolClient,
  codes: string[],
  on: string,
): Promise<Map<string, string>> {
  if (!codes.length) return new Map();
  const { rows } = await client.query<{ code: string; id: string }>(
    `SELECT DISTINCT ON (code) code, id FROM hsdg.authority_provision
      WHERE code = ANY($1::text[]) AND effective_from <= $2::date
        AND (effective_to IS NULL OR effective_to >= $2::date)
      ORDER BY code, effective_from DESC`,
    [codes, on],
  );
  return new Map(rows.map((r) => [r.code, r.id]));
}
