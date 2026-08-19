import type { PoolClient } from 'pg';
import type { EngagementStatus } from '@hsdg/contracts';
import type { EngagementDetail, EngagementSummary } from './engagements.types';

/**
 * The one read shape for an engagement row, shared by the CRUD service and the
 * Phase 6 lifecycle/workflow services so they never drift against each other.
 */
export const ENGAGEMENT_BASE = `
  SELECT eng.id, eng.engagement_code, eng.entity_id, ent.entity_code, ent.legal_name AS entity_name,
         eng.service_id, s.code AS service_code, s.name AS service_name,
         eng.financial_year, eng.period_label, eng.office_id, o.code AS office_code,
         eng.status, eng.engagement_partner_id, ep.full_name AS ep_name,
         eng.engagement_manager_id, mgr.full_name AS manager_name,
         eng.predecessor_engagement_id, eng.planned_start_date, eng.planned_end_date,
         eng.accepted_at, eng.version,
         eng.current_workflow_state_id, ws.slug AS workflow_state_slug, ws.name AS workflow_state_name,
         ws.sequence AS workflow_state_sequence, ws.is_initial AS workflow_state_is_initial,
         ws.is_terminal AS workflow_state_is_terminal,
         eng.on_hold_reason, eng.on_hold_previous_status, eng.on_hold_at, eng.on_hold_expected_resume_date
  FROM hsdg.engagements eng
  JOIN hsdg.entities ent ON ent.id = eng.entity_id
  JOIN hsdg.services s ON s.id = eng.service_id
  JOIN hsdg.offices o ON o.id = eng.office_id
  LEFT JOIN hsdg.employees ep ON ep.id = eng.engagement_partner_id
  LEFT JOIN hsdg.employees mgr ON mgr.id = eng.engagement_manager_id
  LEFT JOIN hsdg.workflow_states ws ON ws.id = eng.current_workflow_state_id`;

export interface EngagementRow {
  id: string;
  engagement_code: string;
  entity_id: string;
  entity_code: string;
  entity_name: string;
  service_id: string;
  service_code: string;
  service_name: string;
  financial_year: string;
  period_label: string;
  office_id: string;
  office_code: string;
  status: EngagementStatus;
  engagement_partner_id: string | null;
  ep_name: string | null;
  engagement_manager_id: string | null;
  manager_name: string | null;
  predecessor_engagement_id: string | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  accepted_at: Date | null;
  version: number;
  current_workflow_state_id: string | null;
  workflow_state_slug: string | null;
  workflow_state_name: string | null;
  workflow_state_sequence: number | null;
  workflow_state_is_initial: boolean | null;
  workflow_state_is_terminal: boolean | null;
  on_hold_reason: string | null;
  on_hold_previous_status: string | null;
  on_hold_at: Date | null;
  on_hold_expected_resume_date: string | null;
}

export function mapEngagement(row: EngagementRow & { team_count: string }): EngagementSummary {
  return {
    id: row.id,
    engagementCode: row.engagement_code,
    entityId: row.entity_id,
    entityCode: row.entity_code,
    entityName: row.entity_name,
    serviceId: row.service_id,
    serviceCode: row.service_code,
    serviceName: row.service_name,
    financialYear: row.financial_year,
    periodLabel: row.period_label,
    officeId: row.office_id,
    officeCode: row.office_code,
    status: row.status,
    engagementPartnerId: row.engagement_partner_id,
    engagementPartnerName: row.ep_name,
    engagementManagerId: row.engagement_manager_id,
    engagementManagerName: row.manager_name,
    predecessorEngagementId: row.predecessor_engagement_id,
    plannedStartDate: row.planned_start_date,
    plannedEndDate: row.planned_end_date,
    acceptedAt: row.accepted_at ? row.accepted_at.toISOString() : null,
    teamCount: Number(row.team_count),
    version: row.version,
    currentWorkflowState: row.current_workflow_state_id
      ? {
          id: row.current_workflow_state_id,
          slug: row.workflow_state_slug!,
          name: row.workflow_state_name!,
          sequence: row.workflow_state_sequence!,
          isInitial: row.workflow_state_is_initial!,
          isTerminal: row.workflow_state_is_terminal!,
        }
      : null,
    onHoldReason: row.on_hold_reason,
    onHoldPreviousStatus: (row.on_hold_previous_status as EngagementStatus | null) ?? null,
    onHoldAt: row.on_hold_at ? row.on_hold_at.toISOString() : null,
    onHoldExpectedResumeDate: row.on_hold_expected_resume_date,
  };
}

/** Full detail (summary + team roster) for one engagement, or null if RLS hides it / it doesn't exist. */
export async function selectEngagementDetail(
  client: PoolClient,
  id: string,
): Promise<EngagementDetail | null> {
  const { rows } = await client.query<EngagementRow>(`${ENGAGEMENT_BASE} WHERE eng.id = $1`, [id]);
  if (!rows[0]) return null;
  const team = await client.query<{
    id: string;
    employee_id: string;
    employee_code: string;
    full_name: string;
    role_on_engagement: EngagementDetail['team'][number]['roleOnEngagement'];
    assigned_at: Date;
  }>(
    `SELECT t.id, t.employee_id, e.employee_code, e.full_name, t.role_on_engagement, t.assigned_at
     FROM hsdg.engagement_team t
     JOIN hsdg.employees e ON e.id = t.employee_id
     WHERE t.engagement_id = $1
     ORDER BY t.assigned_at`,
    [id],
  );
  return {
    ...mapEngagement({ ...rows[0], team_count: String(team.rows.length) }),
    team: team.rows.map((m) => ({
      id: m.id,
      employeeId: m.employee_id,
      employeeCode: m.employee_code,
      employeeName: m.full_name,
      roleOnEngagement: m.role_on_engagement,
      assignedAt: m.assigned_at.toISOString(),
    })),
  };
}
