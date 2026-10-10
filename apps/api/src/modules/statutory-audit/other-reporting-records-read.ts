import type { PoolClient } from 'pg';
import {
  CARO_OUTCOME,
  FRAMEWORK_AREA_KEY,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  type DirectorCheck,
  type DirectorDisqualificationStatus,
  type FraudConclusion,
  type FraudFrameworkStatus,
  type FraudMatter,
  type FraudPerpetrator,
  type FraudRules,
  type FraudSource,
  type OtherReportingCompletionSummary,
  type ReportingCardKey,
  type ReportingCrossRefs,
  type ReportingEvidenceCounts,
  type ReportingEvidenceKind,
  type ReportingEvidenceLink,
  type Rule11eAssessment,
  type Tri,
} from '@hsdg/contracts';
import { readCaroClauseStatus } from './caro-programme-read';
import { groupAuditStatusOn } from './consolidation-group-read';
import { readConsolidationResultOn } from './consolidation-read';
import { readIcfrReportingOn } from './icfr-controls-read';
import { readIcfrResultOn } from './icfr-read';
import { readOtherReportingResultOn } from './other-reporting-read';
import {
  FRAUD_RULE_CODES,
  directorStatus,
  evaluateFraudMatter,
  fraudFrameworkStatus,
  fraudMatterRef,
  fraudRulesOn,
  type FraudRuleVersion,
} from './fraud-matters';
import {
  completionSummaryOf,
  planReportingProcedures,
  type PlannedReportingProcedure,
} from './reporting-records';

/**
 * DI-free reads of the 02.7 Track B records (Fraud Matters, the §164(2)
 * director workpaper, the 02.4 / 02.5 / 02.6 cross-references and the per-card
 * evidence links) for Track A's engine, matrix and completion, and for Track
 * B's own service. Each runs in the caller's RLS transaction. Never import a
 * service file here (ESM cycle breaks Nest DI).
 */

const today = () => new Date().toISOString().slice(0, 10);
const iso = (d: Date | string | null): string | null =>
  d === null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
const DECIDED = new Set<string>(['applicable', 'not_applicable', 'overridden', 'approved']);

/** The audit period start of a workflow (rule / provision resolution date). */
export async function workflowPeriodStartOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<string> {
  const { rows } = await client.query<{ financial_year: string | null }>(
    `SELECT e.financial_year
       FROM hsdg.service_workflow_instances wi
       JOIN hsdg.engagements e ON e.id = wi.engagement_id
      WHERE wi.id = $1`,
    [workflowInstanceId],
  );
  const fy = rows[0]?.financial_year;
  return fy ? auditPeriodStartFromFinancialYear(fy) : today();
}

// ── §14 Fraud Matters ──────────────────────────────────────────────────────

/** Every effective-dated version of the fraud rules (resolved per matter by knowledge date). */
export async function fraudRuleVersionsOn(client: PoolClient): Promise<FraudRuleVersion[]> {
  const { rows } = await client.query<{
    code: string;
    threshold: string | null;
    effective_from: Date | string;
    effective_to: Date | string | null;
    id: string;
  }>(
    `SELECT r.code, v.threshold::text AS threshold, v.effective_from, v.effective_to, v.id
       FROM hsdg.audit_rule r
       JOIN hsdg.audit_rule_version v ON v.audit_rule_id = r.id
      WHERE r.code = ANY($1::text[]) AND r.is_active`,
    [FRAUD_RULE_CODES],
  );
  return rows.map((r) => ({
    code: r.code,
    value: r.threshold === null ? null : Number(r.threshold),
    effectiveFrom: iso(r.effective_from)!,
    effectiveTo: iso(r.effective_to),
    ruleVersionId: r.id,
  }));
}

interface FraudMatterRow {
  id: string;
  seq: number;
  nature: string;
  description: string | null;
  amount: string | null;
  amount_estimated: boolean;
  perpetrator: FraudPerpetrator | null;
  parties_involved: string | null;
  knowledge_date: Date | string | null;
  source: FraudSource;
  source_ref: string | null;
  procedure_id: string | null;
  procedure_ref: string | null;
  audit_procedures: string | null;
  tcwg_communication: string | null;
  board_reported_on: Date | string | null;
  reply_received_on: Date | string | null;
  cg_forwarded_on: Date | string | null;
  adt4_reference: string | null;
  regulatory_note: string | null;
  partner_name: string | null;
  partner_consulted_at: Date | null;
  partner_note: string | null;
  conclusion: FraudConclusion;
  conclusion_note: string | null;
  from_legacy: boolean;
  evidence_count: number;
  withdrawn_at: Date | null;
  created_by_name: string | null;
  created_at: Date;
  version: number;
}

export interface FraudMattersRead {
  periodRules: FraudRules;
  matters: FraudMatter[];
  status: FraudFrameworkStatus;
}

/**
 * Every Fraud Matter (withdrawn ones included, flagged) with its route,
 * deadlines and status evaluated against the rules in force on its knowledge
 * date — the audit period start only while no knowledge date is recorded.
 */
export async function readFraudMattersOn(
  client: PoolClient,
  workflowInstanceId: string,
  auditPeriodStart: string,
  onDate: string = today(),
): Promise<FraudMattersRead> {
  const [versions, { rows }] = await Promise.all([
    fraudRuleVersionsOn(client),
    client.query<FraudMatterRow>(
      `SELECT m.id, m.seq, m.nature, m.description, m.amount::text AS amount, m.amount_estimated,
              m.perpetrator, m.parties_involved, m.knowledge_date, m.source, m.source_ref,
              m.procedure_id, p.procedure_ref, m.audit_procedures, m.tcwg_communication,
              m.board_reported_on, m.reply_received_on, m.cg_forwarded_on, m.adt4_reference,
              m.regulatory_note, pe.full_name AS partner_name, m.partner_consulted_at,
              m.partner_note, m.conclusion, m.conclusion_note, m.from_legacy,
              (SELECT count(*)::int FROM hsdg.audit_reporting_evidence l
                WHERE l.fraud_matter_id = m.id AND l.removed_at IS NULL) AS evidence_count,
              m.withdrawn_at, cb.full_name AS created_by_name, m.created_at, m.version
         FROM hsdg.audit_fraud_matter m
         LEFT JOIN hsdg.audit_procedures p ON p.id = m.procedure_id
         LEFT JOIN hsdg.employees pe ON pe.id = m.partner_consulted_by_employee_id
         LEFT JOIN hsdg.employees cb ON cb.id = m.created_by_employee_id
        WHERE m.workflow_instance_id = $1
        ORDER BY m.seq`,
      [workflowInstanceId],
    ),
  ]);
  const periodRules = fraudRulesOn(versions, auditPeriodStart);
  const evaluated = rows.map((r) => {
    const knowledgeDate = iso(r.knowledge_date);
    const rules = knowledgeDate ? fraudRulesOn(versions, knowledgeDate) : periodRules;
    const dates = {
      amount: r.amount === null ? null : Number(r.amount),
      amountEstimated: r.amount_estimated,
      knowledgeDate,
      boardReportedOn: iso(r.board_reported_on),
      replyReceivedOn: iso(r.reply_received_on),
      cgForwardedOn: iso(r.cg_forwarded_on),
      conclusion: r.conclusion,
      withdrawn: r.withdrawn_at !== null,
    };
    const evaluation = evaluateFraudMatter(dates, rules, onDate);
    const matter: FraudMatter = {
      id: r.id,
      ref: fraudMatterRef(r.seq),
      nature: r.nature,
      description: r.description,
      amount: dates.amount,
      amountEstimated: r.amount_estimated,
      perpetrator: r.perpetrator ?? 'unknown',
      partiesInvolved: r.parties_involved,
      knowledgeDate,
      source: r.source,
      sourceRef: r.source_ref,
      procedureId: r.procedure_id,
      procedureRef: r.procedure_ref,
      auditProcedures: r.audit_procedures,
      tcwgCommunication: r.tcwg_communication,
      boardReportedOn: dates.boardReportedOn,
      replyReceivedOn: dates.replyReceivedOn,
      cgForwardedOn: dates.cgForwardedOn,
      adt4Reference: r.adt4_reference,
      regulatoryNote: r.regulatory_note,
      route: evaluation.route,
      routeBasis: evaluation.routeBasis,
      regulatoryStatus: evaluation.regulatoryStatus,
      deadlines: evaluation.deadlines,
      overdue: evaluation.overdue,
      nextDeadline: evaluation.nextDeadline,
      partnerConsultedByName: r.partner_name,
      partnerConsultedAt: r.partner_consulted_at?.toISOString() ?? null,
      partnerNote: r.partner_note,
      conclusion: r.conclusion,
      conclusionNote: r.conclusion_note,
      fromLegacy: r.from_legacy,
      evidenceCount: r.evidence_count,
      withdrawn: dates.withdrawn,
      createdByName: r.created_by_name,
      createdAt: r.created_at.toISOString(),
      version: r.version,
    };
    return { matter, evaluation };
  });
  return {
    periodRules,
    matters: evaluated.map((e) => e.matter),
    status: fraudFrameworkStatus(
      periodRules,
      evaluated.map((e) => ({ withdrawn: e.matter.withdrawn, evaluation: e.evaluation })),
    ),
  };
}

export async function fraudFrameworkStatusOn(
  client: PoolClient,
  workflowInstanceId: string,
  auditPeriodStart: string,
): Promise<FraudFrameworkStatus> {
  return (await readFraudMattersOn(client, workflowInstanceId, auditPeriodStart)).status;
}

// ── §12 Section 164(2) director workpaper ──────────────────────────────────

export async function readDirectorChecksOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<DirectorCheck[]> {
  const { rows } = await client.query<{
    id: string;
    name: string;
    din: string | null;
    designation: string | null;
    appointed_on: Date | string | null;
    ceased_on: Date | string | null;
    directorship_info: string | null;
    representation_ref: string | null;
    mca_source: string | null;
    disqualified: Tri;
    legal_analysis: string | null;
    auditor_conclusion: string | null;
    source: 'contacts' | 'team';
    contact_id: string | null;
    evidence_count: number;
    representation_links: number;
    mca_links: number;
    withdrawn_at: Date | null;
    version: number;
  }>(
    `SELECT d.id, d.name, d.din, d.designation, d.appointed_on, d.ceased_on, d.directorship_info,
            d.representation_ref, d.mca_source, d.disqualified, d.legal_analysis,
            d.auditor_conclusion, d.source, d.contact_id,
            count(l.id)::int AS evidence_count,
            count(l.id) FILTER (WHERE l.kind = 'management_representation')::int
              AS representation_links,
            count(l.id) FILTER (WHERE l.kind = 'mca_record')::int AS mca_links,
            d.withdrawn_at, d.version
       FROM hsdg.audit_director_check d
       LEFT JOIN hsdg.audit_reporting_evidence l
         ON l.director_id = d.id AND l.removed_at IS NULL
      WHERE d.workflow_instance_id = $1
      GROUP BY d.id
      ORDER BY d.withdrawn_at NULLS FIRST, d.created_at, d.name`,
    [workflowInstanceId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    din: r.din,
    designation: r.designation,
    appointedOn: iso(r.appointed_on),
    ceasedOn: iso(r.ceased_on),
    directorshipInfo: r.directorship_info,
    representationRef: r.representation_ref,
    mcaSource: r.mca_source,
    disqualified: r.disqualified,
    legalAnalysis: r.legal_analysis,
    auditorConclusion: r.auditor_conclusion,
    source: r.source,
    contactId: r.contact_id,
    evidenceCount: r.evidence_count,
    representationLinks: r.representation_links,
    mcaLinks: r.mca_links,
    withdrawn: r.withdrawn_at !== null,
    version: r.version,
  }));
}

export async function directorDisqualificationStatusOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<DirectorDisqualificationStatus> {
  const { rows } = await client.query<{ disqualified: Tri }>(
    `SELECT disqualified FROM hsdg.audit_director_check
      WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL`,
    [workflowInstanceId],
  );
  return directorStatus(rows.map((r) => ({ disqualified: r.disqualified, withdrawn: false })));
}

/** Directors on the entity's contacts master (contact_type director, or a director designation). */
export async function contactDirectorsOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<Array<{ contactId: string; name: string; designation: string | null }>> {
  const { rows } = await client.query<{
    id: string;
    full_name: string;
    designation: string | null;
  }>(
    `SELECT c.id, c.full_name, c.designation
       FROM hsdg.service_workflow_instances wi
       JOIN hsdg.engagements e ON e.id = wi.engagement_id
       JOIN hsdg.entity_contacts c ON c.entity_id = e.entity_id
      WHERE wi.id = $1
        AND (c.contact_type = 'director' OR c.designation ILIKE '%director%')
        AND length(trim(c.full_name)) > 0
      ORDER BY c.full_name`,
    [workflowInstanceId],
  );
  return rows.map((r) => ({ contactId: r.id, name: r.full_name, designation: r.designation }));
}

// ── §15 / §17 cross-references (read from the source modules) ──────────────

export async function reportingCrossRefsOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<ReportingCrossRefs> {
  const { rows: caroRows } = await client.query<{
    state: string;
    conclusion: string | null;
    system_outcome: string | null;
  }>(
    `SELECT state, conclusion, system_outcome FROM hsdg.audit_framework_subassessment
      WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
    [workflowInstanceId, SUB_SECTION_KEY.caro, FRAMEWORK_AREA_KEY.caro],
  );
  const caro = caroRows[0];
  const caroDecided = !!caro && DECIDED.has(caro.state) && caro.conclusion != null;
  const caroOutcome = caro ? (caroDecided ? caro.conclusion : caro.system_outcome) : null;
  const caroApplicable =
    caroOutcome === CARO_OUTCOME.applicable
      ? true
      : caroOutcome === CARO_OUTCOME.notApplicableExempt
        ? false
        : null;
  const clauses = await readCaroClauseStatus(client, workflowInstanceId);

  const [icfr, icfrReporting, cfs, group] = await Promise.all([
    readIcfrResultOn(client, workflowInstanceId),
    readIcfrReportingOn(client, workflowInstanceId),
    readConsolidationResultOn(client, workflowInstanceId),
    groupAuditStatusOn(client, workflowInstanceId),
  ]);

  const branchesExist =
    group.branchAuditPresent === 'yes' ? true : group.branchAuditPresent === 'no' ? false : null;
  const { rows: branchRows } = await client.query<{ total: number; with_report: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM hsdg.audit_group_file f
               WHERE f.branch_id = b.id AND f.slot = 'branch_report'
                 AND f.superseded_at IS NULL))::int AS with_report
       FROM hsdg.audit_group_branch b
      WHERE b.workflow_instance_id = $1 AND b.withdrawn_at IS NULL`,
    [workflowInstanceId],
  );
  const branches = branchRows[0] ?? { total: 0, with_report: 0 };

  return {
    caro: {
      applicable: caroApplicable,
      conclusion: caroDecided ? caro!.conclusion : null,
      complete:
        caroDecided &&
        (caroApplicable === false ||
          (clauses !== null && clauses.total > 0 && clauses.approved === clauses.total)),
      reportableClauses: clauses?.reportable ?? 0,
    },
    icfr: {
      reportingRequired: icfr?.reportingApplies ?? null,
      conclusion: icfrReporting?.concluded
        ? icfrReporting.conclusion
        : icfr?.decided
          ? icfr.outcome
          : null,
      complete: icfr?.complete ?? false,
      deficiencies: icfrReporting?.deficiencies.open ?? 0,
    },
    group: {
      cfsConclusion: cfs?.decided ? cfs.outcome : null,
      branchesExist,
      branchAuditors: group.branchAuditors,
      branchReportsDealt: Math.max(0, group.branchAuditors - group.branchPending),
      branchReportsPending: group.branchPending,
      branchReturnsReceived: branches.total === 0 ? null : branches.with_report === branches.total,
    },
  };
}

// ── §16 per-card evidence ──────────────────────────────────────────────────

export async function reportingEvidenceCountsOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<ReportingEvidenceCounts> {
  const { rows } = await client.query<{ card_key: ReportingCardKey; n: number }>(
    `SELECT card_key, count(*)::int AS n FROM hsdg.audit_reporting_evidence
      WHERE workflow_instance_id = $1 AND removed_at IS NULL
      GROUP BY card_key`,
    [workflowInstanceId],
  );
  const out: ReportingEvidenceCounts = {};
  for (const r of rows) out[r.card_key] = r.n;
  return out;
}

export async function readReportingEvidenceLinksOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<ReportingEvidenceLink[]> {
  const { rows } = await client.query<{
    id: string;
    card_key: ReportingCardKey;
    kind: ReportingEvidenceKind;
    fraud_matter_id: string | null;
    director_id: string | null;
    document_id: string | null;
    audit_evidence_id: string | null;
    title: string | null;
    filename: string | null;
    in_sharepoint: boolean;
    note: string | null;
    linked_by_name: string | null;
    linked_at: Date;
  }>(
    `SELECT l.id, l.card_key, l.kind, l.fraud_matter_id, l.director_id, l.document_id,
            l.audit_evidence_id, COALESCE(d.title, ev.title) AS title, cv.filename,
            (d.m365_live_item_id IS NOT NULL) AS in_sharepoint, l.note,
            lb.full_name AS linked_by_name, l.linked_at
       FROM hsdg.audit_reporting_evidence l
       LEFT JOIN hsdg.audit_evidence ev ON ev.id = l.audit_evidence_id
       LEFT JOIN hsdg.documents d ON d.id = COALESCE(l.document_id, ev.document_id)
                                 AND d.deleted_at IS NULL
       LEFT JOIN hsdg.document_versions cv ON cv.id = d.current_version_id
       LEFT JOIN hsdg.employees lb ON lb.id = l.linked_by_employee_id
      WHERE l.workflow_instance_id = $1 AND l.removed_at IS NULL
      ORDER BY l.card_key, l.linked_at`,
    [workflowInstanceId],
  );
  return rows.map((r) => ({
    id: r.id,
    cardKey: r.card_key,
    kind: r.kind,
    fraudMatterId: r.fraud_matter_id,
    directorId: r.director_id,
    documentId: r.document_id,
    auditEvidenceId: r.audit_evidence_id,
    title: r.title ?? 'Removed document',
    filename: r.filename,
    inSharePoint: r.in_sharepoint === true,
    note: r.note,
    linkedByName: r.linked_by_name,
    linkedAt: r.linked_at.toISOString(),
  }));
}

// ── Section 06 / Section 07 ────────────────────────────────────────────────

/**
 * The Section 06 procedures 02.7 calls for — one per card with a reporting
 * obligation. Empty until the 02.7 engine has run (the generic auditor's
 * reporting procedure stays until then).
 */
export async function reportingProceduresOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<PlannedReportingProcedure[]> {
  const result = await readOtherReportingResultOn(client, workflowInstanceId);
  if (!result) return [];
  return planReportingProcedures(result.cards);
}

/** What Section 07 completion reads from 02.7 (null when 02.7 is not seeded). */
export async function readOtherReportingCompletionOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<OtherReportingCompletionSummary | null> {
  const result = await readOtherReportingResultOn(client, workflowInstanceId);
  if (!result) return null;
  const { rows } = await client.query<{
    facts: {
      rule11eAdvanced?: Partial<Rule11eAssessment>;
      rule11eReceived?: Partial<Rule11eAssessment>;
    } | null;
  }>(
    `SELECT facts FROM hsdg.audit_framework_subassessment
      WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
    [workflowInstanceId, SUB_SECTION_KEY.otherReporting, FRAMEWORK_AREA_KEY.otherRegulatory],
  );
  const facts = rows[0]?.facts ?? null;
  const periodStart = await workflowPeriodStartOn(client, workflowInstanceId);
  return completionSummaryOf({
    decided: result.decided,
    cards: result.cards,
    fraud: await fraudFrameworkStatusOn(client, workflowInstanceId, periodStart),
    directors: await directorDisqualificationStatusOn(client, workflowInstanceId),
    rule11eAdvanced: facts?.rule11eAdvanced,
    rule11eReceived: facts?.rule11eReceived,
  });
}
