import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  secondsToHours,
  sumMembers,
  type AuditTeamMember,
  type AuditTeamMemberDetail,
  type StatutoryAuditTeam,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

interface ShellRow {
  id: string;
  engagement_service_id: string;
  engagement_id: string;
}

interface EngagementLeadRow {
  engagement_partner_id: string | null;
  engagement_manager_id: string | null;
  ep_name: string | null;
  manager_name: string | null;
}

interface MemberRow {
  employee_id: string;
  full_name: string;
  role_on_engagement: string | null;
  planned_hours: number;
  work_items: string;
  actual_seconds: string;
  is_reviewer: boolean;
}

export interface TeamAllocationInput {
  employeeId: string;
  plannedHours: number;
  responsibility?: string | null;
}

/**
 * Statutory Audit — Team service (Audit Spec §24, §37).
 *
 * The Team layer combines responsibility, workload and time. Each member row
 * reports their role, the count of work items they own (procedures + active
 * audit areas), their PLANNED hours (audit_team_allocations, §21) and their
 * ACTUAL hours — aggregated from the existing hsdg.engagement_time_entries
 * mechanism (§24 — no separate Time tab), plus whether they act as a reviewer.
 */
@Injectable()
export class AuditTeamService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  async listForEngagement(ctx: RlsContext, engagementId: string): Promise<StatutoryAuditTeam[]> {
    return this.db.withRlsContext(ctx, (client) => this.readTeam(client, engagementId));
  }

  private async readTeam(client: PoolClient, engagementId: string): Promise<StatutoryAuditTeam[]> {
    const { rows: shells } = await client.query<ShellRow>(
      `SELECT id, engagement_service_id, engagement_id
         FROM hsdg.service_workflow_instances
        WHERE engagement_id = $1
        ORDER BY created_at ASC`,
      [engagementId],
    );
    if (shells.length === 0) return [];

    const lead = await this.engagementLead(client, engagementId);

    const teams: StatutoryAuditTeam[] = [];
    for (const shell of shells) {
      const { rows } = await client.query<MemberRow>(MEMBER_ROLLUP_SQL, [engagementId, shell.id]);
      const members: AuditTeamMember[] = rows.map((r) => ({
        employeeId: r.employee_id,
        name: r.full_name,
        role: roleLabel(r.employee_id, r.role_on_engagement, lead),
        workItems: Number(r.work_items),
        plannedHours: Number(r.planned_hours),
        actualHours: secondsToHours(Number(r.actual_seconds)),
        isReviewer: r.is_reviewer,
      }));
      teams.push({
        workflowInstanceId: shell.id,
        engagementServiceId: shell.engagement_service_id,
        engagementId: shell.engagement_id,
        engagementPartnerId: lead.engagement_partner_id,
        engagementPartnerName: lead.ep_name,
        engagementManagerId: lead.engagement_manager_id,
        engagementManagerName: lead.manager_name,
        members,
        totals: {
          plannedHours: sumMembers(members, (m) => m.plannedHours),
          actualHours: sumMembers(members, (m) => m.actualHours),
          workItems: members.reduce((acc, m) => acc + m.workItems, 0),
        },
      });
    }
    return teams;
  }

  /** Per-person drilldown — assigned areas, procedures, reviews and time (§24). */
  async memberDetail(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    employeeId: string,
  ): Promise<AuditTeamMemberDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      const { rows: emp } = await client.query<{
        full_name: string;
        role_on_engagement: string | null;
      }>(
        `SELECT emp.full_name, t.role_on_engagement
           FROM hsdg.employees emp
           LEFT JOIN hsdg.engagement_team t ON t.engagement_id = $2 AND t.employee_id = emp.id
          WHERE emp.id = $1`,
        [employeeId, engagementId],
      );
      if (!emp[0]) throw new NotFoundException('Employee not found.');
      const lead = await this.engagementLead(client, engagementId);

      const { rows: alloc } = await client.query<{
        planned_hours: number;
        responsibility: string | null;
      }>(
        `SELECT planned_hours, responsibility FROM hsdg.audit_team_allocations
          WHERE workflow_instance_id = $1 AND employee_id = $2`,
        [workflowInstanceId, employeeId],
      );
      const { rows: seconds } = await client.query<{ actual_seconds: string }>(
        `SELECT COALESCE(SUM(duration_seconds), 0)::text AS actual_seconds
           FROM hsdg.engagement_time_entries
          WHERE engagement_id = $1 AND employee_id = $2`,
        [engagementId, employeeId],
      );
      const { rows: areas } = await client.query<{ id: string; title: string; state: string }>(
        `SELECT id, title, state FROM hsdg.audit_work_areas
          WHERE workflow_instance_id = $1 AND owner_employee_id = $2 AND is_active = true
          ORDER BY title`,
        [workflowInstanceId, employeeId],
      );
      const { rows: ownedProcs } = await client.query<{
        id: string;
        procedure_ref: string;
        title: string;
        state: string;
      }>(
        `SELECT id, procedure_ref, title, state FROM hsdg.audit_procedures
          WHERE workflow_instance_id = $1 AND owner_employee_id = $2
          ORDER BY procedure_ref`,
        [workflowInstanceId, employeeId],
      );
      const { rows: reviewProcs } = await client.query<{
        id: string;
        procedure_ref: string;
        title: string;
        state: string;
      }>(
        `SELECT id, procedure_ref, title, state FROM hsdg.audit_procedures
          WHERE workflow_instance_id = $1 AND reviewer_employee_id = $2
          ORDER BY procedure_ref`,
        [workflowInstanceId, employeeId],
      );
      // Open notes raised against a procedure or area this person owns.
      const { rows: openNotes } = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM hsdg.audit_review_notes rn
          WHERE rn.workflow_instance_id = $1
            AND rn.status <> 'cleared'
            AND (
              (rn.target_type = 'procedure' AND rn.target_id IN (
                 SELECT id FROM hsdg.audit_procedures
                  WHERE workflow_instance_id = $1 AND owner_employee_id = $2))
              OR (rn.target_type = 'work_area' AND rn.target_id IN (
                 SELECT id FROM hsdg.audit_work_areas
                  WHERE workflow_instance_id = $1 AND owner_employee_id = $2))
            )`,
        [workflowInstanceId, employeeId],
      );

      return {
        employeeId,
        name: emp[0].full_name,
        role: roleLabel(employeeId, emp[0].role_on_engagement, lead),
        plannedHours: Number(alloc[0]?.planned_hours ?? 0),
        actualHours: secondsToHours(Number(seconds[0]!.actual_seconds)),
        responsibility: alloc[0]?.responsibility ?? null,
        ownedAreas: areas.map((a) => ({ id: a.id, ref: null, title: a.title, state: a.state })),
        ownedProcedures: ownedProcs.map((p) => ({
          id: p.id,
          ref: p.procedure_ref,
          title: p.title,
          state: p.state,
        })),
        reviewingProcedures: reviewProcs.map((p) => ({
          id: p.id,
          ref: p.procedure_ref,
          title: p.title,
          state: p.state,
        })),
        openReviewNotes: Number(openNotes[0]!.count),
      };
    });
  }

  // ── Allocation (planned hours) (§21, §24) ───────────────────────────────────

  async setAllocation(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: TeamAllocationInput,
  ): Promise<StatutoryAuditTeam> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      const { rows: emp } = await client.query(`SELECT 1 FROM hsdg.employees WHERE id = $1`, [
        input.employeeId,
      ]);
      if (!emp[0]) throw new BadRequestException('Employee not found.');
      if (!Number.isFinite(input.plannedHours) || input.plannedHours < 0) {
        throw new BadRequestException('Planned hours must be zero or more.');
      }

      // One allocation row per person per file — upsert.
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_team_allocations
           (workflow_instance_id, engagement_id, employee_id, planned_hours, responsibility)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (workflow_instance_id, employee_id) DO UPDATE
           SET planned_hours = EXCLUDED.planned_hours,
               responsibility = EXCLUDED.responsibility,
               version = hsdg.audit_team_allocations.version + 1
         RETURNING id`,
        [
          workflowInstanceId,
          engagementId,
          input.employeeId,
          input.plannedHours,
          input.responsibility?.trim() || null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.team_allocation_set',
        objectType: 'audit_team_allocation',
        objectId: rows[0]!.id,
        after: { employeeId: input.employeeId, plannedHours: input.plannedHours },
      });
      const [team] = await this.readTeam(client, engagementId);
      return team!;
    });
  }

  async deleteAllocation(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    employeeId: string,
  ): Promise<StatutoryAuditTeam> {
    return this.db.withRlsContext(ctx, async (client) => {
      const result = await client.query(
        `DELETE FROM hsdg.audit_team_allocations
          WHERE workflow_instance_id = $1 AND employee_id = $2 AND engagement_id = $3`,
        [workflowInstanceId, employeeId, engagementId],
      );
      if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Allocation not found.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.team_allocation_removed',
        objectType: 'audit_team_allocation',
        objectId: employeeId,
      });
      const [team] = await this.readTeam(client, engagementId);
      return team!;
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async assertShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.service_workflow_instances WHERE id = $1 AND engagement_id = $2`,
      [workflowInstanceId, engagementId],
    );
    if (!rows[0])
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
  }

  private async engagementLead(
    client: PoolClient,
    engagementId: string,
  ): Promise<EngagementLeadRow> {
    const { rows } = await client.query<EngagementLeadRow>(
      `SELECT eng.engagement_partner_id, eng.engagement_manager_id,
              ep.full_name AS ep_name, mgr.full_name AS manager_name
         FROM hsdg.engagements eng
         LEFT JOIN hsdg.employees ep ON ep.id = eng.engagement_partner_id
         LEFT JOIN hsdg.employees mgr ON mgr.id = eng.engagement_manager_id
        WHERE eng.id = $1`,
      [engagementId],
    );
    return (
      rows[0] ?? {
        engagement_partner_id: null,
        engagement_manager_id: null,
        ep_name: null,
        manager_name: null,
      }
    );
  }
}

/** EP / Manager override the engagement role; other roles are title-cased. */
function roleLabel(
  employeeId: string,
  roleOnEngagement: string | null,
  lead: EngagementLeadRow,
): string {
  if (employeeId === lead.engagement_partner_id) return 'EP';
  if (employeeId === lead.engagement_manager_id) return 'Manager';
  if (!roleOnEngagement) return 'Member';
  return roleOnEngagement
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Per-person rollup for one audit file. $1 = engagement id (time + team roles are
 * engagement-scoped), $2 = workflow instance id (work items + allocation are
 * file-scoped). Candidates are everyone with a role, an allocation, or an
 * owned/reviewed item on the file.
 */
const MEMBER_ROLLUP_SQL = `
WITH candidates AS (
  SELECT t.employee_id FROM hsdg.engagement_team t WHERE t.engagement_id = $1
  UNION SELECT eng.engagement_partner_id FROM hsdg.engagements eng
         WHERE eng.id = $1 AND eng.engagement_partner_id IS NOT NULL
  UNION SELECT eng.engagement_manager_id FROM hsdg.engagements eng
         WHERE eng.id = $1 AND eng.engagement_manager_id IS NOT NULL
  UNION SELECT a.employee_id FROM hsdg.audit_team_allocations a WHERE a.workflow_instance_id = $2
  UNION SELECT p.owner_employee_id FROM hsdg.audit_procedures p
         WHERE p.workflow_instance_id = $2 AND p.owner_employee_id IS NOT NULL
  UNION SELECT p.reviewer_employee_id FROM hsdg.audit_procedures p
         WHERE p.workflow_instance_id = $2 AND p.reviewer_employee_id IS NOT NULL
  UNION SELECT wa.owner_employee_id FROM hsdg.audit_work_areas wa
         WHERE wa.workflow_instance_id = $2 AND wa.owner_employee_id IS NOT NULL
  UNION SELECT wa.reviewer_employee_id FROM hsdg.audit_work_areas wa
         WHERE wa.workflow_instance_id = $2 AND wa.reviewer_employee_id IS NOT NULL
)
SELECT c.employee_id, emp.full_name, t.role_on_engagement,
       COALESCE(a.planned_hours, 0) AS planned_hours,
       (
         (SELECT COUNT(*) FROM hsdg.audit_procedures p
            WHERE p.workflow_instance_id = $2 AND p.owner_employee_id = c.employee_id)
       + (SELECT COUNT(*) FROM hsdg.audit_work_areas wa
            WHERE wa.workflow_instance_id = $2 AND wa.owner_employee_id = c.employee_id
              AND wa.is_active = true)
       )::text AS work_items,
       COALESCE((SELECT SUM(te.duration_seconds) FROM hsdg.engagement_time_entries te
                  WHERE te.engagement_id = $1 AND te.employee_id = c.employee_id), 0)::text AS actual_seconds,
       (
         EXISTS(SELECT 1 FROM hsdg.audit_procedures p
                 WHERE p.workflow_instance_id = $2 AND p.reviewer_employee_id = c.employee_id)
         OR EXISTS(SELECT 1 FROM hsdg.audit_work_areas wa
                    WHERE wa.workflow_instance_id = $2 AND wa.reviewer_employee_id = c.employee_id)
       ) AS is_reviewer
  FROM candidates c
  JOIN hsdg.employees emp ON emp.id = c.employee_id
  LEFT JOIN hsdg.engagement_team t ON t.engagement_id = $1 AND t.employee_id = c.employee_id
  LEFT JOIN hsdg.audit_team_allocations a ON a.workflow_instance_id = $2 AND a.employee_id = c.employee_id
 ORDER BY emp.full_name`;
