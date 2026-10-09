import type { PoolClient } from 'pg';
import type {
  AcceptanceContext,
  AcceptanceOtherService,
  AcceptancePriorYear,
  FirstYearSource,
  IndependenceSummary,
} from '@hsdg/contracts';
import { readPriorAuditFile } from './master-facts';

/**
 * Section 01 context reader (spec §4, §7.1, §8, §13): the facts the questions
 * are evaluated against, read from the file and the masters in the caller's
 * RLS transaction so nobody re-enters them.
 */

/** First-year vs continuing, and where that call came from. */
export async function readFirstYear(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<{ firstYear: boolean | null; source: FirstYearSource }> {
  const profile = await client.query<{ initial_audit: boolean; initial_audit_derived: boolean }>(
    `SELECT initial_audit, initial_audit_derived FROM hsdg.audit_entity_profile
      WHERE workflow_instance_id = $1`,
    [workflowInstanceId],
  );
  if (profile.rows[0] && !profile.rows[0].initial_audit_derived) {
    return { firstYear: profile.rows[0].initial_audit, source: 'profile' };
  }
  const prior = await client.query(
    `SELECT 1
       FROM hsdg.service_workflow_instances wi
       JOIN hsdg.engagements e ON e.id = wi.engagement_id
       JOIN hsdg.engagements e2 ON e2.entity_id = e.entity_id AND e2.financial_year < e.financial_year
       JOIN hsdg.service_workflow_instances other
         ON other.engagement_id = e2.id AND other.status <> 'cancelled'
        AND other.workflow_key = 'statutory_audit'
      WHERE wi.id = $1
      LIMIT 1`,
    [workflowInstanceId],
  );
  if ((prior.rowCount ?? 0) > 0) return { firstYear: false, source: 'history' };
  // A recorded predecessor engagement for the same client also means continuing.
  const pred = await client.query(
    `SELECT 1 FROM hsdg.service_workflow_instances wi
       JOIN hsdg.engagements e ON e.id = wi.engagement_id
      WHERE wi.id = $1 AND e.predecessor_engagement_id IS NOT NULL`,
    [workflowInstanceId],
  );
  if ((pred.rowCount ?? 0) > 0) return { firstYear: false, source: 'history' };
  return { firstYear: true, source: 'history' };
}

/** Other active services DHVAJ provides to the same client (IND-03). */
export async function readOtherServices(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<AcceptanceOtherService[]> {
  const { rows } = await client.query<{
    id: string;
    service_name: string;
    engagement_code: string;
    financial_year: string;
    status: string;
  }>(
    `SELECT es.id, s.name AS service_name, oe.engagement_code, es.financial_year, es.status
       FROM hsdg.service_workflow_instances wi
       JOIN hsdg.engagements e ON e.id = wi.engagement_id
       JOIN hsdg.engagement_services es
         ON es.entity_id = e.entity_id AND es.id <> wi.engagement_service_id
        AND es.status IN ('active', 'on_hold', 'prospect')
       JOIN hsdg.services s ON s.id = es.service_id
       JOIN hsdg.engagements oe ON oe.id = es.engagement_id
      WHERE wi.id = $1
      ORDER BY es.financial_year DESC, s.name ASC`,
    [workflowInstanceId],
  );
  return rows.map((r) => ({
    engagementServiceId: r.id,
    serviceName: r.service_name,
    engagementCode: r.engagement_code,
    financialYear: r.financial_year,
    status: r.status,
  }));
}

/** Working status of Section 01 files by slot key (the file cards' table). */
export async function readFileStatuses(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<Record<string, string>> {
  const { rows: exists } = await client.query<{ t: string | null }>(
    `SELECT to_regclass('hsdg.audit_acceptance_files')::text AS t`,
  );
  if (!exists[0]?.t) return {};
  const { rows } = await client.query<{ slot_key: string; status: string }>(
    `SELECT slot_key, status FROM hsdg.audit_acceptance_files WHERE workflow_instance_id = $1`,
    [workflowInstanceId],
  );
  return Object.fromEntries(rows.map((r) => [r.slot_key, r.status]));
}

/** Last year's Section 01 — conclusion, carried matters and answers (spec §7.1, §13). */
export async function readPriorYearAcceptance(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<AcceptancePriorYear | null> {
  const prior = await readPriorAuditFile(client, workflowInstanceId);
  if (!prior) return null;
  const { rows: appr } = await client.query<{
    conclusion: string;
    approved_by_name: string | null;
    approved_at: Date;
  }>(
    `SELECT ap.conclusion, emp.full_name AS approved_by_name, ap.approved_at
       FROM hsdg.audit_acceptance_approvals ap
       LEFT JOIN hsdg.employees emp ON emp.id = ap.approved_by_employee_id
      WHERE ap.workflow_instance_id = $1
      ORDER BY ap.version DESC LIMIT 1`,
    [prior.workflowInstanceId],
  );
  const { rows: matters } = await client.query<{
    seq: number;
    title: string;
    status: string;
    resolution: string | null;
  }>(
    `SELECT seq, title, status, resolution FROM hsdg.audit_matter
      WHERE workflow_instance_id = $1 AND section = 'acceptance'
        AND (status IN ('open','under_review','blocking','accepted_with_approval'))
      ORDER BY seq`,
    [prior.workflowInstanceId],
  );
  const { rows: answers } = await client.query<{
    question_key: string;
    answer: string | null;
    details: Record<string, unknown>;
  }>(
    `SELECT a.question_key, a.answer, a.details
       FROM hsdg.audit_acceptance_answers a
       JOIN hsdg.audit_acceptance_segments s ON s.id = a.segment_id
      WHERE s.workflow_instance_id = $1`,
    [prior.workflowInstanceId],
  );
  const a = appr[0];
  return {
    workflowInstanceId: prior.workflowInstanceId,
    engagementId: prior.engagementId,
    financialYear: prior.financialYear,
    conclusion: a?.conclusion ?? null,
    approvedByName: a?.approved_by_name ?? null,
    approvedAt: a ? a.approved_at.toISOString() : null,
    carriedForwardMatters: matters.map((m) => ({
      matterCode: `M-${String(m.seq).padStart(3, '0')}`,
      title: m.title,
      status: m.status,
      resolution: m.resolution,
    })),
    answers: Object.fromEntries(
      answers.map((r) => [r.question_key, { answer: r.answer, details: r.details ?? {} }]),
    ),
  };
}

/** Engagement Partner / Manager of the engagement. */
export async function readLeads(
  client: PoolClient,
  engagementId: string,
): Promise<Pick<AcceptanceContext, 'partner' | 'manager'>> {
  const { rows } = await client.query<{
    ep_id: string | null;
    ep_name: string | null;
    em_id: string | null;
    em_name: string | null;
  }>(
    `SELECT e.engagement_partner_id AS ep_id, ep.full_name AS ep_name,
            e.engagement_manager_id AS em_id, em.full_name AS em_name
       FROM hsdg.engagements e
       LEFT JOIN hsdg.employees ep ON ep.id = e.engagement_partner_id
       LEFT JOIN hsdg.employees em ON em.id = e.engagement_manager_id
      WHERE e.id = $1`,
    [engagementId],
  );
  const r = rows[0];
  return {
    partner: { employeeId: r?.ep_id ?? null, name: r?.ep_name ?? null },
    manager: { employeeId: r?.em_id ?? null, name: r?.em_name ?? null },
  };
}

const TEAM_ROLE_LABEL: Record<string, string> = {
  partner: 'Engagement Partner',
  manager: 'Engagement Manager',
  in_charge: 'In-charge',
  member: 'Team member',
  reviewer: 'Reviewer',
  specialist: 'Specialist',
};

/**
 * Team independence summary (01.5, spec §8): everyone on the engagement —
 * the Engagement Partner, the Engagement Manager and the engagement team —
 * and the declaration each has given for this audit file.
 */
export async function readIndependence(
  client: PoolClient,
  engagementId: string,
  workflowInstanceId: string,
): Promise<IndependenceSummary> {
  const { rows } = await client.query<{
    employee_id: string;
    full_name: string | null;
    role: string;
    status: 'independent' | 'threat_disclosed' | null;
    disclosure: string | null;
    declared_at: Date | null;
    is_me: boolean;
  }>(
    `WITH team AS (
       SELECT engagement_partner_id AS employee_id, 'partner' AS role, 1 AS rank
         FROM hsdg.engagements WHERE id = $1 AND engagement_partner_id IS NOT NULL
       UNION ALL
       SELECT engagement_manager_id, 'manager', 2
         FROM hsdg.engagements WHERE id = $1 AND engagement_manager_id IS NOT NULL
       UNION ALL
       SELECT employee_id, role_on_engagement, 3
         FROM hsdg.engagement_team WHERE engagement_id = $1
     ), people AS (
       SELECT DISTINCT ON (employee_id) employee_id, role
         FROM team ORDER BY employee_id, rank
     )
     SELECT p.employee_id, e.full_name, p.role, d.status, d.disclosure, d.declared_at,
            (p.employee_id = hsdg.ctx_employee_id()) AS is_me
       FROM people p
       LEFT JOIN hsdg.employees e ON e.id = p.employee_id
       LEFT JOIN hsdg.audit_independence_declarations d
              ON d.workflow_instance_id = $2 AND d.employee_id = p.employee_id
      ORDER BY CASE p.role WHEN 'partner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,
               e.full_name`,
    [engagementId, workflowInstanceId],
  );
  const mapped = rows.map((r) => ({
    row: {
      employeeId: r.employee_id,
      employeeName: r.full_name ?? 'Team member',
      role: TEAM_ROLE_LABEL[r.role] ?? r.role,
      status: r.status ?? ('pending' as const),
      disclosure: r.disclosure,
      declaredAt: r.declared_at ? r.declared_at.toISOString() : null,
    },
    isMe: r.is_me === true,
  }));
  const completed = mapped.filter((m) => m.row.status !== 'pending').length;
  return {
    required: mapped.length,
    completed,
    pending: mapped.length - completed,
    threatsDisclosed: mapped.filter((m) => m.row.status === 'threat_disclosed').length,
    rows: mapped.map((m) => m.row),
    mine: mapped.find((m) => m.isMe)?.row ?? null,
  };
}

export async function readAcceptanceContext(
  client: PoolClient,
  engagementId: string,
  workflowInstanceId: string,
): Promise<AcceptanceContext> {
  const fy = await readFirstYear(client, workflowInstanceId);
  const otherServices = await readOtherServices(client, workflowInstanceId);
  const fileStatuses = await readFileStatuses(client, workflowInstanceId);
  const priorYear =
    fy.firstYear === false ? await readPriorYearAcceptance(client, workflowInstanceId) : null;
  const leads = await readLeads(client, engagementId);
  return {
    firstYear: fy.firstYear,
    firstYearSource: fy.source,
    otherServices,
    independence: await readIndependence(client, engagementId, workflowInstanceId),
    fileStatuses,
    priorYear,
    ...leads,
  };
}
