import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  TAX_AUDIT_MILESTONES,
  TAX_AUDIT_MILESTONE_LABEL,
  TAX_AUDIT_MILESTONE_ROLE_LABEL,
  TAX_AUDIT_MILESTONE_TICKABLE,
  TODAY_GROUP,
  canSeeTaxAuditBoard,
  partnerLoadSummary,
  section271BExposure,
  taxAuditBoardBucket,
  taxAuditMilestoneOffsets,
  taxAuditMilestonePlan,
  type EngagementKind,
  type SaveTaxAuditMilestoneInput,
  type TaxAuditBoard,
  type TaxAuditBoardRow,
  type TaxAuditMilestone,
  type TaxAuditMilestoneKey,
  type TaxAuditMilestoneOffsets,
  type TaxAuditMilestonePlanItem,
  type TaxAuditMilestoneRole,
  type TaxAuditMilestones,
  type TaxAuditStage,
  type TodayItem,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import {
  WORK_LINK_COLUMNS,
  type WorkLinkSqlRow,
  workFilingContextOf,
  workLinkFilingOf,
  workLinkJoin,
  workLinkOf,
} from '../../common/work-links';
import { AuditService } from '../audit/audit.service';
import { istToday } from '../engagements/time/auto-time';

/** A milestone's stored mark: ticked done, and/or a person named for it. */
interface Mark {
  doneAt: string | null;
  doneByName: string | null;
  ownerId: string | null;
  ownerName: string | null;
}

/** An audit with what its milestones need: dates, people by role, marks. */
export interface MilestoneAuditRow extends WorkLinkSqlRow {
  id: string;
  engagement_id: string;
  engagement_code: string;
  engagement_kind: EngagementKind;
  entity_name: string;
  financial_year: string;
  stage: TaxAuditStage;
  due_date: string | null;
  decided: boolean;
  accepted_at: Date | null;
  signed_at: Date | null;
  signing_partner_name: string | null;
  turnover: string | null;
  manager_id: string | null;
  manager_name: string | null;
  partner_id: string | null;
  partner_name: string | null;
  senior_id: string | null;
  senior_name: string | null;
  marks: Partial<Record<TaxAuditMilestoneKey, Mark>>;
}

/**
 * The audits, each with its due date (override, then CBDT extension, then
 * statute) and the people its milestones fall to by role:
 *   · Manager: the engagement's manager, else its partner;
 *   · Signing Partner: the audit's signing partner, else the engagement's partner;
 *   · Senior: the team's in-charge, else whoever the report filing's task is
 *     assigned to, else the manager.
 * Read under the caller's RLS. `where` filters `a` / `eng`.
 */
export function milestoneAuditSql(where: string): string {
  return `
    SELECT a.id, a.engagement_id, eng.engagement_code, eng.kind AS engagement_kind,
           ent.legal_name AS entity_name, a.financial_year, a.stage,
           x.due::text AS due_date, (d.id IS NOT NULL) AS decided,
           a.accepted_at, a.signed_at, sp.full_name AS signing_partner_name,
           COALESCE(
             NULLIF(COALESCE((d.inputs ->> 'businessTurnover')::numeric, 0)
                    + COALESCE((d.inputs ->> 'professionReceipts')::numeric, 0), 0),
             ent.annual_turnover)::text AS turnover,
           r.manager_id, (SELECT full_name FROM hsdg.employees WHERE id = r.manager_id) AS manager_name,
           r.partner_id, (SELECT full_name FROM hsdg.employees WHERE id = r.partner_id) AS partner_name,
           r.senior_id, (SELECT full_name FROM hsdg.employees WHERE id = r.senior_id) AS senior_name,
           COALESCE((
             SELECT jsonb_object_agg(m.milestone, jsonb_build_object(
                      'doneAt', m.done_at, 'doneByName', db.full_name,
                      'ownerId', m.owner_employee_id, 'ownerName', oe.full_name))
               FROM hsdg.tax_audit_milestones m
               LEFT JOIN hsdg.employees db ON db.id = m.done_by_employee_id
               LEFT JOIN hsdg.employees oe ON oe.id = m.owner_employee_id
              WHERE m.tax_audit_id = a.id), '{}'::jsonb) AS marks,
           ${WORK_LINK_COLUMNS}
      FROM hsdg.tax_audits a
      JOIN hsdg.engagements eng ON eng.id = a.engagement_id
      JOIN hsdg.entities ent ON ent.id = eng.entity_id
      LEFT JOIN hsdg.employees sp ON sp.id = a.signing_partner_id
      LEFT JOIN hsdg.tax_audit_applicability d
             ON d.engagement_id = a.engagement_id AND d.financial_year = a.financial_year
      LEFT JOIN hsdg.compliance_instances ci ON ci.id = a.compliance_instance_id
      LEFT JOIN hsdg.government_extensions ge ON ge.id = ci.government_extension_id
      LEFT JOIN LATERAL (SELECT COALESCE(ci.statutory_deadline_override, ge.revised_due_date,
                                         ci.statutory_deadline) AS due) x ON true
      LEFT JOIN LATERAL (
        SELECT t.assigned_to_employee_id AS id FROM hsdg.tasks t
         WHERE t.source_compliance_instance_id = a.compliance_instance_id
           AND t.assigned_to_employee_id IS NOT NULL AND t.status <> 'cancelled'
         ORDER BY t.created_at DESC LIMIT 1) ft ON true
      LEFT JOIN LATERAL (
        SELECT tm.employee_id AS id FROM hsdg.engagement_team tm
         WHERE tm.engagement_id = a.engagement_id AND tm.role_on_engagement = 'in_charge'
         ORDER BY tm.assigned_at LIMIT 1) ic ON true
      CROSS JOIN LATERAL (
        SELECT COALESCE(eng.engagement_manager_id, eng.engagement_partner_id) AS manager_id,
               COALESCE(a.signing_partner_id, eng.engagement_partner_id) AS partner_id,
               COALESCE(ic.id, ft.id, eng.engagement_manager_id, eng.engagement_partner_id)
                 AS senior_id) r
      ${workLinkJoin('a.compliance_instance_id')}
     WHERE ${where}`;
}

/** Days before the due date each milestone falls, as the firm set them. */
export async function readMilestoneOffsets(client: PoolClient): Promise<TaxAuditMilestoneOffsets> {
  const { rows } = await client.query<{ offsets: unknown }>(
    `SELECT tax_audit_milestone_offsets AS offsets FROM hsdg.firm_settings LIMIT 1`,
  );
  return taxAuditMilestoneOffsets(rows[0]?.offsets);
}

/** The audit's plan: milestones with dates and done-ness. */
export function planOf(
  r: MilestoneAuditRow,
  offsets: TaxAuditMilestoneOffsets,
  today: string,
): TaxAuditMilestonePlanItem[] {
  const ticked: Partial<Record<TaxAuditMilestoneKey, string>> = {};
  for (const [k, m] of Object.entries(r.marks)) {
    if (m?.doneAt) ticked[k as TaxAuditMilestoneKey] = m.doneAt;
  }
  return taxAuditMilestonePlan(
    {
      stage: r.stage,
      dueDate: r.due_date,
      applicabilityDecided: r.decided,
      acceptedAt: r.accepted_at ? r.accepted_at.toISOString() : null,
      signedAt: r.signed_at ? r.signed_at.toISOString() : null,
      ticked,
    },
    offsets,
    today,
  );
}

/** Who answers for a milestone: the person named, else the role's person. */
export function ownerOf(
  r: MilestoneAuditRow,
  key: TaxAuditMilestoneKey,
  role: TaxAuditMilestoneRole,
): { id: string | null; name: string | null; named: boolean } {
  const mark = r.marks[key];
  if (mark?.ownerId) return { id: mark.ownerId, name: mark.ownerName, named: true };
  if (role === 'manager') return { id: r.manager_id, name: r.manager_name, named: false };
  if (role === 'signing_partner') return { id: r.partner_id, name: r.partner_name, named: false };
  return { id: r.senior_id, name: r.senior_name, named: false };
}

/**
 * F-9: each open tax audit with a milestone of mine past its internal date —
 * one Overdue row per audit on my Today, naming the milestones I missed.
 */
export async function missedTaxAuditMilestones(
  client: PoolClient,
  me: string,
  engagementId: string | null,
  today: string,
): Promise<TodayItem[]> {
  const { rows } = await client.query<MilestoneAuditRow>(
    milestoneAuditSql(`a.stage NOT IN ('filed', 'not_applicable')
       AND x.due IS NOT NULL
       AND eng.status NOT IN ('closed', 'merged', 'cancelled', 'declined', 'withdrawn')
       AND ($2::uuid IS NULL OR a.engagement_id = $2)
       AND ($1 IN (r.manager_id, r.partner_id, r.senior_id)
            OR EXISTS (SELECT 1 FROM hsdg.tax_audit_milestones om
                        WHERE om.tax_audit_id = a.id AND om.owner_employee_id = $1))`),
    [me, engagementId],
  );
  if (rows.length === 0) return [];
  const offsets = await readMilestoneOffsets(client);
  return rows.flatMap((r) => {
    const mine = planOf(r, offsets, today).filter(
      (p) => p.missed && ownerOf(r, p.key, p.role).id === me,
    );
    if (mine.length === 0) return [];
    const first = mine[0]!;
    const filing = workFilingContextOf(r);
    const item: TodayItem = {
      key: `tax_audit_milestone:${r.id}`,
      kind: 'tax_audit_milestone',
      group: TODAY_GROUP.overdue,
      title:
        mine.length === 1
          ? `Tax audit FY ${r.financial_year}: ${first.label}`
          : `Tax audit FY ${r.financial_year}: ${first.label} and ${mine.length - 1} more`,
      engagementId: r.engagement_id,
      engagementCode: r.engagement_code,
      engagementKind: r.engagement_kind,
      entityName: r.entity_name,
      filing,
      internalDate: first.dueOn,
      statutoryDate: r.due_date,
      status: r.stage,
      isOverdue: true,
      blockedByOpenCount: 0,
      task: null,
      taxAudit: {
        auditId: r.id,
        financialYear: r.financial_year,
        missed: mine.map((p) => p.label),
      },
      link: workLinkOf(
        { engagementId: r.engagement_id, engagementKind: r.engagement_kind },
        workLinkFilingOf(r),
      ),
    };
    return [item];
  });
}

/**
 * Tax audit milestones (Phase 5, F-9): the internal dates counted back from
 * the report's due date, who answers for each, and what is done. The desks
 * move the stage, and with it the milestones behind it; the owner or the
 * engagement's partner or manager ticks the ones no desk moves yet, and the
 * partner or manager may name someone else for a milestone.
 */
@Injectable()
export class TaxAuditMilestonesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async get(ctx: RlsContext, engagementId: string, auditId: string): Promise<TaxAuditMilestones> {
    return this.db.withRlsContext(ctx, (client) => this.read(client, ctx, engagementId, auditId));
  }

  async save(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    milestone: string,
    input: SaveTaxAuditMilestoneInput,
  ): Promise<TaxAuditMilestones> {
    if (!(TAX_AUDIT_MILESTONES as readonly string[]).includes(milestone)) {
      throw new NotFoundException('No such tax audit milestone.');
    }
    const key = milestone as TaxAuditMilestoneKey;
    if (input.done === undefined && input.ownerId === undefined) {
      throw new BadRequestException('Tick the milestone or name its owner.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.read(client, ctx, engagementId, auditId);
      const m = before.milestones.find((x) => x.key === key)!;
      const label = TAX_AUDIT_MILESTONE_LABEL[key];
      if (before.stage === 'not_applicable') {
        throw new BadRequestException('This tax audit is marked not applicable.');
      }
      if (input.ownerId !== undefined) {
        if (!before.canNameOwners) {
          throw new ForbiddenException(
            'The engagement’s partner or manager names who answers for a milestone.',
          );
        }
        if (input.ownerId !== null) {
          const { rowCount } = await client.query(
            `SELECT 1 FROM hsdg.employees WHERE id = $1 AND employment_status <> 'exited'`,
            [input.ownerId],
          );
          if (!rowCount) throw new BadRequestException('Choose someone still with the firm.');
        }
      }
      if (input.done !== undefined) {
        if (!TAX_AUDIT_MILESTONE_TICKABLE.includes(key)) {
          throw new BadRequestException(
            `“${label}” follows its desk; it is done when the audit moves past it.`,
          );
        }
        if (!m.canTick) {
          throw new ForbiddenException(
            `${m.ownerName ?? 'Its owner'} or the engagement’s partner or manager ticks “${label}”.`,
          );
        }
      }
      const sets: string[] = [];
      const values: unknown[] = [auditId, key];
      if (input.done !== undefined) {
        values.push(input.done, ctx.employeeId ?? null);
        sets.push(
          `done_at = CASE WHEN $3::boolean THEN COALESCE(m.done_at, now()) END`,
          `done_by_employee_id = CASE WHEN $3::boolean THEN COALESCE(m.done_by_employee_id, $4::uuid) END`,
        );
      }
      if (input.ownerId !== undefined) {
        values.push(input.ownerId);
        sets.push(`owner_employee_id = $${values.length}::uuid`);
      }
      await client.query(
        `INSERT INTO hsdg.tax_audit_milestones (tax_audit_id, milestone)
         VALUES ($1, $2) ON CONFLICT (tax_audit_id, milestone) DO NOTHING`,
        [auditId, key],
      );
      await client.query(
        `UPDATE hsdg.tax_audit_milestones m SET ${sets.join(', ')}
          WHERE m.tax_audit_id = $1 AND m.milestone = $2`,
        values,
      );
      // A row that says nothing any more goes.
      await client.query(
        `DELETE FROM hsdg.tax_audit_milestones
          WHERE tax_audit_id = $1 AND milestone = $2
            AND done_at IS NULL AND owner_employee_id IS NULL`,
        [auditId, key],
      );
      const after = await this.read(client, ctx, engagementId, auditId);
      const a = after.milestones.find((x) => x.key === key)!;
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.milestone_updated',
        objectType: 'tax_audit',
        objectId: auditId,
        before: { milestone: key, done: m.done, ownerId: m.ownerNamed ? m.ownerId : null },
        after: { milestone: key, done: a.done, ownerId: a.ownerNamed ? a.ownerId : null },
      });
      return after;
    });
  }

  /** GET /tax-audits/board — the Managing Partner's and Partners' view of a year. */
  async board(ctx: RlsContext, financialYear: string): Promise<TaxAuditBoard> {
    if (!canSeeTaxAuditBoard(ctx.role)) {
      throw new ForbiddenException('The tax audit board is for the Managing Partner and Partners.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const today = istToday(new Date());
      const offsets = await readMilestoneOffsets(client);
      const { rows } = await client.query<MilestoneAuditRow>(
        milestoneAuditSql(`a.financial_year = $1 AND a.revision = 0
           AND eng.status NOT IN ('merged', 'cancelled', 'declined', 'withdrawn')`),
        [financialYear],
      );
      const counts = { not_started: 0, in_progress: 0, completed: 0 };
      const byStage: TaxAuditBoard['byStage'] = {};
      const atRisk: TaxAuditBoardRow[] = [];
      let totalExposure = 0;
      for (const r of rows) {
        byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
        const bucket = taxAuditBoardBucket(r.stage);
        if (bucket) counts[bucket] += 1;
        if (bucket !== 'not_started' && bucket !== 'in_progress') continue;
        const missed = planOf(r, offsets, today)
          .filter((p) => p.missed)
          .map((p) => ({
            key: p.key,
            label: p.label,
            dueOn: p.dueOn!,
            ownerName: ownerOf(r, p.key, p.role).name,
          }));
        const late = r.due_date !== null && r.due_date < today;
        if (missed.length === 0 && !late) continue;
        const turnover = r.turnover === null ? null : Number(r.turnover);
        const exposure = late ? section271BExposure(turnover) : null;
        if (exposure !== null) totalExposure += exposure;
        atRisk.push({
          auditId: r.id,
          engagementId: r.engagement_id,
          engagementCode: r.engagement_code,
          entityName: r.entity_name,
          stage: r.stage,
          dueDate: r.due_date,
          signingPartnerName: r.signing_partner_name,
          missed,
          daysLate: late
            ? Math.round((Date.parse(today) - Date.parse(r.due_date!)) / 86_400_000)
            : null,
          turnover,
          exposure,
        });
      }
      atRisk.sort(
        (x, y) =>
          (x.dueDate ?? '9999').localeCompare(y.dueDate ?? '9999') ||
          x.entityName.localeCompare(y.entityName),
      );
      const limitRow = await client.query<{ limit: number }>(
        `SELECT tax_audit_limit AS limit FROM hsdg.firm_settings LIMIT 1`,
      );
      const limit = limitRow.rows[0]?.limit ?? 60;
      const partners = await client.query<{
        employee_id: string;
        full_name: string;
        reports: number;
      }>(`SELECT employee_id, full_name, reports FROM hsdg.tax_audit_signing_partners($1)`, [
        financialYear,
      ]);
      return {
        financialYear,
        today,
        counts,
        byStage,
        atRisk,
        totalExposure,
        limit,
        partners: partners.rows.map((p) => ({
          employeeId: p.employee_id,
          name: p.full_name,
          reports: p.reports,
          summary: partnerLoadSummary(p.full_name, p.reports, limit, financialYear),
        })),
      };
    });
  }

  private async read(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
  ): Promise<TaxAuditMilestones> {
    const { rows } = await client.query<MilestoneAuditRow>(
      milestoneAuditSql(`a.id = $1 AND a.engagement_id = $2`),
      [auditId, engagementId],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('Tax audit not found.');
    const lead = await client.query<{ ok: boolean }>(`SELECT hsdg.is_engagement_lead($1) AS ok`, [
      engagementId,
    ]);
    const isLead = lead.rows[0]?.ok === true;
    const today = istToday(new Date());
    const offsets = await readMilestoneOffsets(client);
    const open = r.stage !== 'filed' && r.stage !== 'not_applicable';
    const milestones: TaxAuditMilestone[] = planOf(r, offsets, today).map((p) => {
      const owner = ownerOf(r, p.key, p.role);
      const mark = r.marks[p.key];
      return {
        ...p,
        roleLabel: TAX_AUDIT_MILESTONE_ROLE_LABEL[p.role],
        doneAt: mark?.doneAt ?? null,
        doneByName: mark?.doneByName ?? null,
        ownerId: owner.id,
        ownerName: owner.name,
        ownerNamed: owner.named,
        canTick:
          open &&
          TAX_AUDIT_MILESTONE_TICKABLE.includes(p.key) &&
          // A milestone the stage already carries is not undone here.
          (!p.done || Boolean(mark?.doneAt)) &&
          (isLead || (ctx.employeeId != null && owner.id === ctx.employeeId)),
      };
    });
    return {
      auditId: r.id,
      engagementId: r.engagement_id,
      financialYear: r.financial_year,
      stage: r.stage,
      dueDate: r.due_date,
      milestones,
      canNameOwners: open && isLead,
    };
  }
}
