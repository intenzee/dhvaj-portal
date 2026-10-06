import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  secondsToHours,
  sumMembers,
  type AuditTeamMember,
  type AuditTeamMemberDetail,
  type StatutoryAuditTeam,
  type TeamBalanceResult,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { isEngagementLead } from './master-facts';
import {
  estimateHours,
  memberFlags,
  planBalance,
  type TeamArea,
  type TeamLeads,
  type TeamPerson,
  type TeamProcedure,
} from './team-automation';

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
  grade_name: string | null;
  grade_rank: number | null;
  is_suggested: boolean | null;
  basis: string | null;
}

/** The work on one file that Team plans and flags from. */
interface FileWork {
  procedures: TeamProcedure[];
  areas: TeamArea[];
  /** Live review notes on work each person owns. */
  notesToAnswer: Map<string, number>;
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
    return this.db.withRlsContext(ctx, async (client) => {
      // A lead opening Team brings the suggested planned hours up to date.
      if (await isEngagementLead(client, engagementId)) {
        await this.syncAllocations(client, engagementId);
      }
      return this.readTeam(client, engagementId);
    });
  }

  /**
   * Planned hours from the file: a person with no allocation gets the
   * estimate; one still on the estimate follows it. Hours a person set are
   * never touched. Signed-off / archived files are left as they are.
   */
  private async syncAllocations(client: PoolClient, engagementId: string): Promise<void> {
    const { rows: shells } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.service_workflow_instances
        WHERE engagement_id = $1 AND workflow_key = 'statutory_audit'
          AND status NOT IN ('cancelled','archived','completed') AND signed_off_at IS NULL`,
      [engagementId],
    );
    const lead = await this.engagementLead(client, engagementId);
    const leads: TeamLeads = {
      epId: lead.engagement_partner_id,
      managerId: lead.engagement_manager_id,
    };
    for (const shell of shells) {
      const work = await this.loadWork(client, shell.id);
      const { rows } = await client.query<MemberRow>(MEMBER_ROLLUP_SQL, [engagementId, shell.id]);
      for (const m of rows) {
        const est = estimateHours(m.employee_id, work.procedures, work.areas, leads);
        if (m.is_suggested === false) continue; // a person set these hours
        if (m.is_suggested == null) {
          if (est.hours <= 0) continue;
          await client.query(
            `INSERT INTO hsdg.audit_team_allocations
               (workflow_instance_id, engagement_id, employee_id, planned_hours, is_suggested, basis)
             VALUES ($1, $2, $3, $4, true, $5)
             ON CONFLICT (workflow_instance_id, employee_id) DO NOTHING`,
            [shell.id, engagementId, m.employee_id, est.hours, est.basis],
          );
        } else if (Number(m.planned_hours) !== est.hours || m.basis !== est.basis) {
          await client.query(
            `UPDATE hsdg.audit_team_allocations
                SET planned_hours = $3, basis = $4, version = version + 1
              WHERE workflow_instance_id = $1 AND employee_id = $2 AND is_suggested`,
            [shell.id, m.employee_id, est.hours, est.basis],
          );
        }
      }
    }
  }

  /** Procedures, active areas and live notes on one file, for planning and flags. */
  private async loadWork(client: PoolClient, wi: string): Promise<FileWork> {
    const { rows: procs } = await client.query<{
      id: string;
      procedure_ref: string;
      title: string;
      state: string;
      owner_employee_id: string | null;
      reviewer_employee_id: string | null;
      due_date: string | null;
      risk_level: string | null;
      significant: boolean | null;
    }>(
      `SELECT p.id, p.procedure_ref, p.title, p.state, p.owner_employee_id,
              p.reviewer_employee_id, p.due_date, wa.risk_level, r.is_significant AS significant
         FROM hsdg.audit_procedures p
         JOIN hsdg.audit_work_areas wa ON wa.id = p.work_area_id
         LEFT JOIN hsdg.audit_risks r ON r.id = p.risk_id
        WHERE p.workflow_instance_id = $1
        ORDER BY p.procedure_ref`,
      [wi],
    );
    const { rows: areas } = await client.query<{ id: string; owner_employee_id: string | null }>(
      `SELECT id, owner_employee_id FROM hsdg.audit_work_areas
        WHERE workflow_instance_id = $1 AND is_active`,
      [wi],
    );
    const { rows: notes } = await client.query<{ owner_id: string; n: number }>(
      `SELECT COALESCE(p.owner_employee_id, wa.owner_employee_id) AS owner_id, count(*)::int AS n
         FROM hsdg.audit_review_notes rn
         LEFT JOIN hsdg.audit_procedures p ON rn.target_type = 'procedure' AND p.id = rn.target_id
         LEFT JOIN hsdg.audit_work_areas wa ON rn.target_type = 'work_area' AND wa.id = rn.target_id
        WHERE rn.workflow_instance_id = $1 AND rn.status = 'open'
          AND COALESCE(p.owner_employee_id, wa.owner_employee_id) IS NOT NULL
        GROUP BY 1`,
      [wi],
    );
    return {
      procedures: procs.map((p) => ({
        id: p.id,
        ref: p.procedure_ref,
        title: p.title,
        state: p.state,
        ownerId: p.owner_employee_id,
        reviewerId: p.reviewer_employee_id,
        dueDate: p.due_date,
        areaRisk: p.risk_level,
        significant: p.significant === true,
      })),
      areas: areas.map((a) => ({ id: a.id, ownerId: a.owner_employee_id })),
      notesToAnswer: new Map(notes.map((n) => [n.owner_id, n.n])),
    };
  }

  // ── Balance the work ──────────────────────────────────────────────────────

  /**
   * Apply "Balance the work": the proposed owner / reviewer changes (all, or
   * those for the procedures given). Each applies only if the procedure is
   * still not started and still with the same person.
   */
  async applyBalance(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    procedureIds?: readonly string[],
  ): Promise<TeamBalanceResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      const [current] = (await this.readTeam(client, engagementId)).filter(
        (t) => t.workflowInstanceId === workflowInstanceId,
      );
      const wanted = procedureIds?.length ? new Set(procedureIds) : null;
      const moves = (current?.balance ?? []).filter((m) => !wanted || wanted.has(m.procedureId));
      if (moves.length === 0) {
        throw new ConflictException('Nothing to balance — the work is already spread.');
      }
      let moved = 0;
      for (const m of moves) {
        const col = m.field === 'owner' ? 'owner_employee_id' : 'reviewer_employee_id';
        const r = await client.query(
          `UPDATE hsdg.audit_procedures
              SET ${col} = $3, version = version + 1
            WHERE id = $1 AND workflow_instance_id = $2 AND state = 'not_started'
              AND ${col} IS NOT DISTINCT FROM $4`,
          [m.procedureId, workflowInstanceId, m.toEmployeeId, m.fromEmployeeId],
        );
        moved += r.rowCount ?? 0;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.team_balanced',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { moved },
      });
      // Estimates follow the work that moved.
      await this.syncAllocations(client, engagementId);
      const [team] = (await this.readTeam(client, engagementId)).filter(
        (t) => t.workflowInstanceId === workflowInstanceId,
      );
      return { team: team!, moved };
    });
  }

  private async readTeam(client: PoolClient, engagementId: string): Promise<StatutoryAuditTeam[]> {
    const { rows: shells } = await client.query<ShellRow>(
      `SELECT id, engagement_service_id, engagement_id
         FROM hsdg.service_workflow_instances
        WHERE engagement_id = $1 AND status <> 'cancelled'
        ORDER BY created_at ASC`,
      [engagementId],
    );
    if (shells.length === 0) return [];

    const lead = await this.engagementLead(client, engagementId);

    const teams: StatutoryAuditTeam[] = [];
    const leads: TeamLeads = {
      epId: lead.engagement_partner_id,
      managerId: lead.engagement_manager_id,
    };
    const today = new Date().toISOString().slice(0, 10);
    for (const shell of shells) {
      const { rows } = await client.query<MemberRow>(MEMBER_ROLLUP_SQL, [engagementId, shell.id]);
      const work = await this.loadWork(client, shell.id);
      const members: AuditTeamMember[] = rows.map((r) => {
        const owned = work.procedures.filter((p) => p.ownerId === r.employee_id);
        const plannedHours = Number(r.planned_hours);
        const actualHours = secondsToHours(Number(r.actual_seconds));
        const est = estimateHours(r.employee_id, work.procedures, work.areas, leads);
        const isLead = r.employee_id === leads.epId || r.employee_id === leads.managerId;
        return {
          employeeId: r.employee_id,
          name: r.full_name,
          role: roleLabel(r.employee_id, r.role_on_engagement, lead),
          workItems: Number(r.work_items),
          plannedHours,
          actualHours,
          isReviewer: r.is_reviewer,
          grade: r.grade_name,
          estimatedHours: est.hours,
          plannedSuggested: r.is_suggested === true,
          planBasis: r.is_suggested === true ? r.basis : est.basis,
          progress: {
            done: owned.filter((p) => p.state === 'complete').length,
            total: owned.length,
          },
          flags: memberFlags({
            plannedHours,
            actualHours,
            ownedProcedures: owned.length,
            ownedAreas: work.areas.filter((a) => a.ownerId === r.employee_id).length,
            isLead,
            overdue: owned.filter((p) => p.state !== 'complete' && p.dueDate && p.dueDate < today)
              .length,
            returned: owned.filter((p) => p.state === 'returned').length,
            notesToAnswer: work.notesToAnswer.get(r.employee_id) ?? 0,
            waitingForTheirReview: work.procedures.filter(
              (p) => p.reviewerId === r.employee_id && p.state === 'ready_for_review',
            ).length,
          }),
        };
      });
      const people: TeamPerson[] = rows.map((r) => ({
        employeeId: r.employee_id,
        name: r.full_name,
        gradeRank: r.grade_rank,
        role:
          r.employee_id === leads.epId || r.employee_id === leads.managerId
            ? null
            : r.role_on_engagement,
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
        unassigned: work.procedures.filter((p) => p.ownerId == null).length,
        balance: planBalance(people, work.procedures, leads),
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
               -- Hours a person sets are theirs — the file no longer re-estimates them.
               is_suggested = false,
               basis = NULL,
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
      `SELECT 1 FROM hsdg.service_workflow_instances WHERE id = $1 AND engagement_id = $2 AND status <> 'cancelled'`,
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
       g.name AS grade_name, g.rank AS grade_rank, a.is_suggested, a.basis,
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
  LEFT JOIN hsdg.grades g ON g.id = emp.grade_id
  LEFT JOIN hsdg.engagement_team t ON t.engagement_id = $1 AND t.employee_id = c.employee_id
  LEFT JOIN hsdg.audit_team_allocations a ON a.workflow_instance_id = $2 AND a.employee_id = c.employee_id
 ORDER BY emp.full_name`;
