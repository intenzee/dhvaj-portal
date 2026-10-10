import type { PoolClient } from 'pg';
import {
  BRANCH_CONCLUSION_LABEL,
  COMPONENT_AUDITOR_TYPE_LABEL,
  COMPONENT_REPORT_TYPE_LABEL,
  CONSOLIDATION_METHOD_LABEL,
  CONSOLIDATION_OUTCOME_LABEL,
  FINDING_CATEGORY_LABEL,
  FRAMEWORK_AREA_KEY,
  GA01_ANSWER_LABEL,
  INVESTEE_RELATIONSHIP_LABEL,
  PACKAGE_DOCUMENT_LABEL,
  REPORTING_FRAMEWORK_LABEL,
  RULE6_RESULT_LABEL,
  SUB_SECTION_KEY,
  type BranchConclusion,
  type ComponentAuditorType,
  type ComponentReportType,
  type ConsolidationMethod,
  type ConsolidationOutcome,
  type GroupAuditStatus,
  type GroupFindingCategory,
  type InvesteeRelationship,
  type PackageDocumentKey,
  type ReportingFrameworkOutcome,
  type Rule6Assessment,
} from '@hsdg/contracts';
import { formatLongDate } from './acceptance-merge-values';
import { groupAuditStatusOn } from './consolidation-group-read';
import { readConsolidationResultOn } from './consolidation-read';
import { findingRef, perimeterFromDetail } from './group-audit';

const t = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);
const outcomeLabel = (o: string | null): string | null =>
  o ? (CONSOLIDATION_OUTCOME_LABEL[o as ConsolidationOutcome] ?? o.replace(/_/g, ' ')) : null;
const period = (from: string | null, to: string | null): string | null =>
  from && to ? `${formatLongDate(from)} to ${formatLongDate(to)}` : null;
const inr = (v: string | null): string | null =>
  v == null ? null : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// ── The 02.6 memo (consolidation_group_audit_memo) ─────────────────────────

/** The 02.6 assessment and the Part B group-audit framework as stored. */
export interface ConsolidationMemoInput {
  systemOutcome: string | null;
  systemBasis: string | null;
  conclusion: string | null;
  basis: string | null;
  isOverridden: boolean;
  technicalBasis: string | null;
  supportingEvidence: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  professionalAction: string | null;
  pendingReason: string | null;
  partnerApprovedByName: string | null;
  partnerApprovedAt: string | null;
  rule6: Rule6Assessment | null;
  perimeter: Array<{
    name: string;
    relationship: InvesteeRelationship;
    method: ConsolidationMethod;
    included: string;
  }>;
  groupFramework: ReportingFrameworkOutcome | null;
  materialityNote: string | null;
  components: Array<{
    name: string;
    auditorType: ComponentAuditorType;
    firmName: string | null;
    reportType: ComponentReportType | null;
  }>;
  ga01: string | null;
  findings: Array<{ ref: string; subject: string; category: GroupFindingCategory; status: string }>;
  br01: string | null;
  branches: Array<{ name: string; firmName: string | null; conclusion: BranchConclusion }>;
  workProgramme: {
    status: string;
    label: string | null;
    applicable: number;
    linked: number;
  } | null;
  status: GroupAuditStatus;
}

/** Read 02.6 and its group-audit framework (null when 02.6 is not open). */
export async function readConsolidationMemoInput(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<ConsolidationMemoInput | null> {
  const { rows } = await client.query<{
    system_outcome: string | null;
    system_basis: string | null;
    conclusion: string | null;
    basis: string | null;
    is_overridden: boolean;
    decided_by_name: string | null;
    decided_at: Date | null;
    professional_action: string | null;
    pending_reason: string | null;
    partner_name: string | null;
    partner_approved_at: Date | null;
    system_detail: { rule6?: Rule6Assessment | null; materialityNote?: string } | null;
    facts: { technicalBasis?: string | null; supportingEvidence?: string | null } | null;
  }>(
    `SELECT s.system_outcome, s.system_basis, s.conclusion, s.basis, s.is_overridden,
            d.full_name AS decided_by_name, s.decided_at, s.professional_action, s.pending_reason,
            p.full_name AS partner_name, s.partner_approved_at, s.system_detail, s.facts
       FROM hsdg.audit_framework_subassessment s
       LEFT JOIN hsdg.employees d ON d.id = s.decided_by_employee_id
       LEFT JOIN hsdg.employees p ON p.id = s.partner_approved_by_employee_id
      WHERE s.workflow_instance_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3`,
    [workflowInstanceId, SUB_SECTION_KEY.consolidation, FRAMEWORK_AREA_KEY.cfs],
  );
  const r = rows[0];
  if (!r) return null;
  const result = await readConsolidationResultOn(client, workflowInstanceId);
  const [status, { rows: comps }, { rows: group }, { rows: findings }, { rows: branches }] =
    await Promise.all([
      groupAuditStatusOn(client, workflowInstanceId),
      client.query<{
        component_name: string;
        auditor_type: ComponentAuditorType;
        firm_name: string | null;
        report_type: ComponentReportType | null;
        component_id: string;
      }>(
        `SELECT component_id, component_name, auditor_type, firm_name, report_type
           FROM hsdg.audit_group_component
          WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL
          ORDER BY sort_order, component_name`,
        [workflowInstanceId],
      ),
      client.query<{
        ga01: string | null;
        br01: string;
        work_status: string;
        work_framework_label: string | null;
        applicable: number;
        linked: number;
      }>(
        `SELECT g.ga01, g.br01, g.work_status, g.work_framework_label,
                (SELECT count(*)::int FROM hsdg.audit_group_work_item w
                  WHERE w.group_audit_id = g.id AND w.status = 'active' AND w.applicable) AS applicable,
                (SELECT count(*)::int FROM hsdg.audit_group_work_item w
                  WHERE w.group_audit_id = g.id AND w.status = 'active' AND w.applicable
                    AND w.procedure_id IS NOT NULL) AS linked
           FROM hsdg.audit_group_audit g WHERE g.workflow_instance_id = $1`,
        [workflowInstanceId],
      ),
      client.query<{
        seq: number;
        subject: string | null;
        category: GroupFindingCategory;
        status: string;
      }>(
        `SELECT f.seq, COALESCE(c.component_name, b.branch_name) AS subject, f.category, f.status
           FROM hsdg.audit_group_finding f
           LEFT JOIN hsdg.audit_group_component c ON c.id = f.component_row_id
           LEFT JOIN hsdg.audit_group_branch b ON b.id = f.branch_id
          WHERE f.workflow_instance_id = $1 AND f.withdrawn_at IS NULL
          ORDER BY f.seq`,
        [workflowInstanceId],
      ),
      client.query<{ branch_name: string; firm_name: string | null; conclusion: BranchConclusion }>(
        `SELECT branch_name, firm_name, conclusion FROM hsdg.audit_group_branch
          WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL
          ORDER BY sort_order, branch_name`,
        [workflowInstanceId],
      ),
    ]);
  const g = group[0];
  return {
    systemOutcome: r.system_outcome,
    systemBasis: r.system_basis,
    conclusion: r.conclusion,
    basis: r.basis,
    isOverridden: r.is_overridden,
    technicalBasis: r.facts?.technicalBasis ?? null,
    supportingEvidence: r.facts?.supportingEvidence ?? null,
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
    professionalAction: r.professional_action,
    pendingReason: r.pending_reason,
    partnerApprovedByName: r.partner_name,
    partnerApprovedAt: r.partner_approved_at ? r.partner_approved_at.toISOString() : null,
    rule6: r.system_detail?.rule6 ?? null,
    perimeter: perimeterFromDetail(r.system_detail).map((p) => ({
      name: p.name,
      relationship: p.relationship,
      method: p.method,
      included: p.included,
    })),
    groupFramework: result?.groupFramework ?? null,
    materialityNote: r.system_detail?.materialityNote ?? null,
    components: comps
      .filter((c) => c.component_id in status.byComponent)
      .map((c) => ({
        name: c.component_name,
        auditorType: c.auditor_type,
        firmName: c.firm_name,
        reportType: c.report_type,
      })),
    ga01: g?.ga01 ?? null,
    findings: findings.map((f) => ({
      ref: findingRef(f.seq),
      subject: f.subject ?? 'Component',
      category: f.category,
      status: f.status,
    })),
    br01: status.branchAuditPresent,
    branches:
      status.branchAuditPresent === 'yes'
        ? branches.map((b) => ({
            name: b.branch_name,
            firmName: b.firm_name,
            conclusion: b.conclusion,
          }))
        : [],
    workProgramme: g
      ? {
          status: g.work_status,
          label: g.work_framework_label,
          applicable: g.applicable,
          linked: g.linked,
        }
      : null,
    status,
  };
}

/**
 * The `cfs.*` merge values of the Consolidation & Group Audit Memo (02.6 spec
 * §12–§22). Pure; an absent fact leaves the field blank so the memo shows its
 * `[label]` gap rather than a guess.
 */
export function consolidationMergeValues(
  m: ConsolidationMemoInput | null,
): Record<string, string | null> {
  if (!m) return {};
  const decided = m.conclusion !== null;
  const cfsRequired = (decided ? m.conclusion : m.systemOutcome) === 'cfs_required';
  const s = m.status;
  const r6 = m.rule6;
  const included = m.perimeter.filter((p) => p.included === 'yes');
  return {
    'cfs.requirement': outcomeLabel(decided ? m.conclusion : m.systemOutcome),
    'cfs.systemConclusion': outcomeLabel(m.systemOutcome),
    'cfs.systemBasis': t(m.systemBasis),
    'cfs.rule6': r6
      ? [
          r6.result ? RULE6_RESULT_LABEL[r6.result] : null,
          ...(r6.conditions ?? []).map((c) => `${c.label}: ${c.result.replace(/_/g, ' ')}`),
          t(r6.basis),
        ]
          .filter(Boolean)
          .join('. ')
      : 'Not reached — Rule 6 was not assessed',
    'cfs.perimeter': included.length
      ? included
          .map(
            (p) =>
              `${p.name} — ${INVESTEE_RELATIONSHIP_LABEL[p.relationship] ?? p.relationship} (${CONSOLIDATION_METHOD_LABEL[p.method] ?? p.method})`,
          )
          .join('; ')
      : 'No component included in the perimeter',
    'cfs.groupFramework': m.groupFramework
      ? REPORTING_FRAMEWORK_LABEL[m.groupFramework]
      : 'Not yet concluded in 02.2',
    'cfs.componentAuditors': !cfsRequired
      ? 'Not applicable — consolidated financial statements are not required'
      : m.components.length
        ? m.components
            .map(
              (c) =>
                `${c.name}: ${COMPONENT_AUDITOR_TYPE_LABEL[c.auditorType]}${c.firmName && c.auditorType === 'other_auditor' ? ` (${c.firmName})` : ''}${c.reportType ? ` — ${COMPONENT_REPORT_TYPE_LABEL[c.reportType]}` : ''}`,
            )
            .join('; ')
        : null,
    'cfs.sa600': !s.sa600Required
      ? 'Not applicable — no other auditor is used (SA 600)'
      : `SA 600 applies — ${s.otherAuditorComponents} component${s.otherAuditorComponents === 1 ? '' : 's'} audited by another auditor${s.branchAuditors ? ` and ${s.branchAuditors} branch auditor${s.branchAuditors === 1 ? '' : 's'}` : ''}. GA-01: ${m.ga01 ? GA01_ANSWER_LABEL[m.ga01 as 'yes'] : 'system suggestion'}. ${s.sa600Pending ? `${s.sa600Pending} answer${s.sa600Pending === 1 ? '' : 's'} still pending` : 'All GA answers recorded'}${s.instructionsPending ? `; instructions pending for ${s.instructionsPending}` : ''}.`,
    'cfs.reportingPackages': !s.otherAuditorComponents
      ? 'Not applicable'
      : s.pendingReports
        ? `${s.pendingReports} reporting-package document${s.pendingReports === 1 ? '' : 's'} pending`
        : 'All required reporting-package documents received',
    'cfs.otherAuditorFindings': m.findings.length
      ? m.findings
          .map(
            (f) =>
              `${f.ref} ${f.subject} — ${FINDING_CATEGORY_LABEL[f.category]} (${f.status === 'resolved' ? 'resolved' : 'open'})`,
          )
          .join('; ')
      : 'None recorded',
    'cfs.branchAuditors':
      m.br01 === 'yes'
        ? m.branches.length
          ? m.branches
              .map(
                (b) =>
                  `${b.name}${b.firmName ? ` (${b.firmName})` : ''} — ${BRANCH_CONCLUSION_LABEL[b.conclusion]}`,
              )
              .join('; ')
          : 'BR-01 Yes — branch auditor records to be added'
        : m.br01 === 'no'
          ? 'BR-01 No — no branch audited by another auditor'
          : 'BR-01 pending',
    'cfs.workProgramme':
      !m.workProgramme || m.workProgramme.status === 'none'
        ? cfsRequired
          ? null
          : 'Not required'
        : m.workProgramme.status === 'withdrawn'
          ? 'Withdrawn — consolidated financial statements no longer required; the record is kept'
          : `${m.workProgramme.label ?? 'Consolidation work programme'} — ${m.workProgramme.applicable} applicable item${m.workProgramme.applicable === 1 ? '' : 's'}, ${m.workProgramme.linked} in Section 06`,
    'cfs.materialityNote':
      t(m.materialityNote) ??
      'No materiality percentage is set in 02.6 — group, component and clearly trivial amounts come from Section 03.3.',
    'cfs.professionalConclusion': decided
      ? outcomeLabel(m.conclusion)
      : m.professionalAction === 'information_pending'
        ? 'Information Pending'
        : 'Not yet concluded',
    'cfs.overridden': m.isOverridden ? 'Yes' : 'No',
    'cfs.overrideReason': m.isOverridden ? t(m.basis) : 'Not applicable',
    'cfs.technicalBasis': m.isOverridden ? t(m.technicalBasis) : 'Not applicable',
    'cfs.supportingEvidence': m.isOverridden ? t(m.supportingEvidence) : 'Not applicable',
    'cfs.partnerApproval': m.partnerApprovedAt
      ? `Approved by ${m.partnerApprovedByName ?? 'the Engagement Partner'} on ${formatLongDate(m.partnerApprovedAt.slice(0, 10))}`
      : m.isOverridden
        ? 'Pending'
        : 'Not required',
    'cfs.pendingReason':
      m.professionalAction === 'information_pending' ? t(m.pendingReason) : 'Not applicable',
    'cfs.decidedBy': m.decidedByName,
    'cfs.decidedAt': m.decidedAt ? formatLongDate(m.decidedAt.slice(0, 10)) : null,
  };
}

// ── Component Auditor Instructions (§14) ───────────────────────────────────

export interface InstructionsInput {
  componentName: string;
  relationship: InvesteeRelationship;
  componentCountry: string | null;
  isIndianCompany: boolean | null;
  firmName: string | null;
  frn: string | null;
  professionalBody: string | null;
  partnerContact: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  reportingDeadline: string | null;
  groupFramework: ReportingFrameworkOutcome | null;
  /** The approved (complete) Section 03.3 determination, else null. */
  materiality: {
    versionNo: number;
    overall: string | null;
    performance: string | null;
    clearlyTrivial: string | null;
  } | null;
  significantRisks: Array<{ ref: string; description: string }>;
  otherComponents: string[];
  packageDocuments: PackageDocumentKey[];
}

const LATER = 'To be supplied from Section 03.3 once materiality is approved';

/** The `ga.*` merge values of the Component Auditor Instructions. Pure. */
export function componentInstructionValues(i: InstructionsInput): Record<string, string | null> {
  const mat = i.materiality;
  const foreign = i.isIndianCompany === false;
  return {
    'ga.componentName': i.componentName,
    'ga.relationship': INVESTEE_RELATIONSHIP_LABEL[i.relationship] ?? i.relationship,
    'ga.componentCountry': t(i.componentCountry),
    'ga.auditorFirm': t(i.firmName),
    'ga.auditorFrn': [t(i.frn), t(i.professionalBody)].filter(Boolean).join(' — ') || null,
    'ga.auditorPartner': t(i.partnerContact),
    'ga.auditPeriod': period(i.periodFrom, i.periodTo),
    'ga.reportingFramework': i.groupFramework
      ? `${REPORTING_FRAMEWORK_LABEL[i.groupFramework]} — report in the group reporting package format`
      : null,
    'ga.materiality': mat?.overall
      ? `Group overall materiality ${inr(mat.overall)}${mat.performance ? `; performance materiality ${inr(mat.performance)}` : ''} (Section 03.3, version ${mat.versionNo}). Component materiality, where set, is communicated separately by the group engagement team.`
      : LATER,
    'ga.clearlyTrivial': mat?.clearlyTrivial ? inr(mat.clearlyTrivial) : LATER,
    'ga.significantRisks': i.significantRisks.length
      ? i.significantRisks.map((r) => `${r.ref} — ${r.description}`).join('; ')
      : 'No group-identified significant risk recorded for the component yet (Section 04)',
    'ga.groupComponents': i.otherComponents.length
      ? i.otherComponents.join('; ')
      : 'No other group component',
    'ga.reportingPackage': i.packageDocuments.map((k) => PACKAGE_DOCUMENT_LABEL[k]).join('; '),
    'ga.icfrReporting': foreign
      ? 'Not required — the component is not a company incorporated in India'
      : 'Report on the component’s internal financial controls with reference to financial statements (section 143(3)(i)) where it applies, with any modification',
    'ga.caroReporting': foreign
      ? 'Not required — the component is not a company incorporated in India'
      : 'Provide the component’s CARO 2020 report, with any qualification or adverse remark, where CARO applies to it',
    'ga.deadline': i.reportingDeadline ? formatLongDate(i.reportingDeadline) : null,
  };
}
