import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ClsService } from 'nestjs-cls';
import {
  COMPLIANCE_CLOCK,
  COMPLIANCE_STATUS,
  type CalculationBasis,
  type ComplianceClock,
  type ComplianceStatus,
  type WorkingDayAdjustment,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { resolveAmbientCorrelationId } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import {
  computeDeadlines,
  evaluateCondition,
  financialYearEndYear,
  resolveReferenceDate,
  toISODate,
} from './compliance-calc';
import { translateComplianceError } from './compliance-rules.service';
import type {
  ComplianceInstanceDetail,
  ComplianceInstanceRecord,
  ComplianceOverrideRecord,
  CompleteInstanceInput,
  GenerateInstanceInput,
  OverrideInstanceInput,
  WaiveInstanceInput,
} from './compliance.types';

interface InstanceRow {
  id: string;
  engagement_id: string;
  compliance_rule_id: string;
  rule_code: string;
  rule_name: string;
  compliance_rule_version_id: string;
  rule_version: number;
  reference_date: string;
  statutory_deadline: string;
  statutory_deadline_override: string | null;
  effective_statutory: string;
  internal_sla_date: string;
  internal_sla_override: string | null;
  effective_sla: string;
  status: ComplianceStatus;
  is_statutory_overdue: boolean;
  is_internally_overdue: boolean;
  completed_at: Date | null;
  completed_by_employee_id: string | null;
  completed_by_name: string | null;
  notes: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface VersionRow {
  id: string;
  version: number;
  calculation_basis: CalculationBasis;
  offset_months: number;
  offset_days: number;
  fixed_month: number | null;
  fixed_day: number | null;
  working_day_adjustment: WorkingDayAdjustment;
  internal_sla_offset_days: number;
  condition: unknown | null;
}

const INSTANCE_BASE = `
  SELECT ci.id, ci.engagement_id, ci.compliance_rule_id, cr.code AS rule_code, cr.name AS rule_name,
         ci.compliance_rule_version_id, crv.version AS rule_version,
         ci.reference_date::text, ci.statutory_deadline::text, ci.statutory_deadline_override::text,
         COALESCE(ci.statutory_deadline_override, ci.statutory_deadline)::text AS effective_statutory,
         ci.internal_sla_date::text, ci.internal_sla_override::text,
         COALESCE(ci.internal_sla_override, ci.internal_sla_date)::text AS effective_sla,
         ci.status,
         (ci.status = 'open' AND COALESCE(ci.statutory_deadline_override, ci.statutory_deadline) < CURRENT_DATE)
           AS is_statutory_overdue,
         (ci.status = 'open' AND COALESCE(ci.internal_sla_override, ci.internal_sla_date) < CURRENT_DATE)
           AS is_internally_overdue,
         ci.completed_at, ci.completed_by_employee_id, ce.full_name AS completed_by_name,
         ci.notes, ci.version, ci.created_at, ci.updated_at
  FROM hsdg.compliance_instances ci
  JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
  JOIN hsdg.compliance_rule_versions crv ON crv.id = ci.compliance_rule_version_id
  LEFT JOIN hsdg.employees ce ON ce.id = ci.completed_by_employee_id`;

/**
 * The per-engagement compliance engine (Phase 8, ADR-0013).
 *
 * Generation selects the rule version in force as of the obligation's reference
 * date, computes both clocks via the pure {@link computeDeadlines} engine, and
 * SNAPSHOTS the result plus the version id. Instances are never recomputed — so
 * changing a future rule version leaves every existing instance untouched.
 * Engagement-scoped RLS (members read, leads write) governs access.
 */
@Injectable()
export class ComplianceInstancesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  async generate(
    ctx: RlsContext,
    engagementId: string,
    input: GenerateInstanceInput,
  ): Promise<ComplianceInstanceRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const eng = await client.query<{ financial_year: string }>(
        `SELECT financial_year FROM hsdg.engagements WHERE id = $1`,
        [engagementId],
      );
      if (!eng.rows[0]) throw new NotFoundException('Engagement not found.');
      const financialYear = eng.rows[0].financial_year;

      const ruleRes = await client.query<{ id: string; is_active: boolean }>(
        `SELECT id, is_active FROM hsdg.compliance_rules WHERE code = $1`,
        [input.complianceRuleCode],
      );
      if (!ruleRes.rows[0]) {
        throw new BadRequestException(`Unknown compliance rule "${input.complianceRuleCode}".`);
      }
      if (!ruleRes.rows[0].is_active) {
        throw new BadRequestException(`Compliance rule "${input.complianceRuleCode}" is inactive.`);
      }
      const ruleId = ruleRes.rows[0].id;

      // The "as of" date selects the effective rule version. It is the caller's
      // explicit reference/event date, else the engagement's FY end.
      const asOf =
        input.referenceDate ??
        input.eventDate ??
        toISODate(new Date(Date.UTC(financialYearEndYear(financialYear), 2, 31)));

      const verRes = await client.query<VersionRow>(
        `SELECT id, version, calculation_basis, offset_months, offset_days, fixed_month, fixed_day,
                working_day_adjustment, internal_sla_offset_days, condition
         FROM hsdg.compliance_rule_versions
         WHERE compliance_rule_id = $1 AND effective_from <= $2::date
           AND (effective_to IS NULL OR $2::date <= effective_to)
         ORDER BY effective_from DESC LIMIT 1`,
        [ruleId, asOf],
      );
      if (!verRes.rows[0]) {
        throw new BadRequestException(
          `No version of compliance rule "${input.complianceRuleCode}" is effective as of ${asOf}.`,
        );
      }
      const v = verRes.rows[0];

      if (!evaluateCondition(v.condition, input.context ?? {})) {
        throw new BadRequestException(
          'This compliance rule does not apply under the supplied context.',
        );
      }

      const referenceDate = resolveReferenceDate(v.calculation_basis, {
        financialYear,
        referenceDate: input.referenceDate,
        eventDate: input.eventDate,
        fixedMonth: v.fixed_month,
        fixedDay: v.fixed_day,
      });
      const holidays = await this.loadHolidays(client);
      const { statutoryDeadline, internalSlaDate } = computeDeadlines(
        {
          referenceDate,
          offsetMonths: v.offset_months,
          offsetDays: v.offset_days,
          workingDayAdjustment: v.working_day_adjustment,
          internalSlaOffsetDays: v.internal_sla_offset_days,
        },
        holidays,
      );
      const refIso = toISODate(referenceDate);

      let instanceId: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.compliance_instances
             (engagement_id, compliance_rule_id, compliance_rule_version_id, reference_date,
              statutory_deadline, internal_sla_date)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [engagementId, ruleId, v.id, refIso, statutoryDeadline, internalSlaDate],
        );
        instanceId = rows[0]!.id;
      } catch (err) {
        throw translateComplianceError(err);
      }

      const instance = await this.selectInstance(client, instanceId, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'compliance.instance_generated',
        objectType: 'compliance_instance',
        objectId: instanceId,
        after: {
          rule: input.complianceRuleCode,
          ruleVersion: v.version,
          referenceDate: refIso,
          statutoryDeadline,
          internalSlaDate,
        },
      });
      return instance!;
    });
  }

  async list(
    ctx: RlsContext,
    engagementId: string,
    page: PageParams,
  ): Promise<PageResult<ComplianceInstanceRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const eng = await client.query(`SELECT 1 FROM hsdg.engagements WHERE id = $1`, [
        engagementId,
      ]);
      if (!eng.rows[0]) throw new NotFoundException('Engagement not found.');

      const { rows } = await client.query<InstanceRow & { total_count: string }>(
        `${INSTANCE_BASE}
         WHERE ci.engagement_id = $1
         ORDER BY COALESCE(ci.statutory_deadline_override, ci.statutory_deadline)
         LIMIT $2 OFFSET $3`,
        [engagementId, page.limit, page.offset],
      );
      // count(*) OVER() doesn't survive the deadline ORDER BY cleanly with the
      // joins here, so total is a separate cheap count under the same RLS.
      const totalRes = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM hsdg.compliance_instances WHERE engagement_id = $1`,
        [engagementId],
      );
      return {
        items: rows.map(mapInstance),
        total: Number(totalRes.rows[0]?.total ?? 0),
      };
    });
  }

  async getOne(
    ctx: RlsContext,
    engagementId: string,
    instanceId: string,
  ): Promise<ComplianceInstanceDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const detail = await this.selectInstanceDetail(client, instanceId, engagementId);
      if (!detail) throw new NotFoundException('Compliance instance not found.');
      return detail;
    });
  }

  /** Manually override a deadline on one of the two clocks (audited, reason required). */
  async override(
    ctx: RlsContext,
    engagementId: string,
    instanceId: string,
    input: OverrideInstanceInput,
  ): Promise<ComplianceInstanceDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectInstance(client, instanceId, engagementId);
      if (!before) throw new NotFoundException('Compliance instance not found.');
      if (before.status !== COMPLIANCE_STATUS.open) {
        throw new BadRequestException(
          `Cannot override a "${before.status}" compliance instance — only open obligations.`,
        );
      }

      const isStatutory = input.clock === COMPLIANCE_CLOCK.statutory;
      const previous = isStatutory
        ? before.effectiveStatutoryDeadline
        : before.effectiveInternalSlaDate;
      const column = isStatutory ? 'statutory_deadline_override' : 'internal_sla_override';

      const updated = await this.versionedUpdate(
        client,
        instanceId,
        engagementId,
        `${column} = $1`,
        [input.newDate],
        input.version,
      );
      if (!updated) return this.notPermittedOrStale(before, input.version);

      const correlationId = resolveAmbientCorrelationId(this.cls) ?? null;
      await client.query(
        `INSERT INTO hsdg.compliance_instance_overrides
           (compliance_instance_id, engagement_id, clock, previous_date, new_date, reason,
            evidence_reference, actor_user_id, actor_role, correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,'')::uuid,$9,$10)`,
        [
          instanceId,
          engagementId,
          input.clock,
          previous,
          input.newDate,
          input.reason,
          input.evidenceReference ?? null,
          ctx.userId,
          ctx.role,
          correlationId,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'compliance.deadline_overridden',
        objectType: 'compliance_instance',
        objectId: instanceId,
        before: { clock: input.clock, date: previous },
        after: { clock: input.clock, date: input.newDate },
        reason: input.reason,
        correlationId,
      });
      return (await this.selectInstanceDetail(client, instanceId, engagementId))!;
    });
  }

  async complete(
    ctx: RlsContext,
    engagementId: string,
    instanceId: string,
    input: CompleteInstanceInput,
  ): Promise<ComplianceInstanceRecord> {
    return this.transitionStatus(ctx, engagementId, instanceId, {
      to: COMPLIANCE_STATUS.completed,
      notes: input.notes,
      version: input.version,
      auditAction: 'compliance.instance_completed',
    });
  }

  async waive(
    ctx: RlsContext,
    engagementId: string,
    instanceId: string,
    input: WaiveInstanceInput,
  ): Promise<ComplianceInstanceRecord> {
    return this.transitionStatus(ctx, engagementId, instanceId, {
      to: COMPLIANCE_STATUS.waived,
      reason: input.reason,
      version: input.version,
      auditAction: 'compliance.instance_waived',
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async transitionStatus(
    ctx: RlsContext,
    engagementId: string,
    instanceId: string,
    opts: {
      to: ComplianceStatus;
      notes?: string;
      reason?: string;
      version?: number;
      auditAction: string;
    },
  ): Promise<ComplianceInstanceRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectInstance(client, instanceId, engagementId);
      if (!before) throw new NotFoundException('Compliance instance not found.');
      if (before.status !== COMPLIANCE_STATUS.open) {
        throw new BadRequestException(
          `Compliance instance is already "${before.status}" — only open obligations can change.`,
        );
      }

      const completing = opts.to === COMPLIANCE_STATUS.completed;
      const sets = completing
        ? `status = 'completed', completed_at = now(), completed_by_employee_id = $1`
        : `status = 'waived', notes = COALESCE($1, notes)`;
      const firstParam = completing ? (ctx.employeeId ?? null) : (opts.reason ?? null);

      const updated = await this.versionedUpdate(
        client,
        instanceId,
        engagementId,
        sets,
        [firstParam],
        opts.version,
      );
      if (!updated) return this.notPermittedOrStale(before, opts.version);

      await this.audit.recordWith(client, ctx, {
        action: opts.auditAction,
        objectType: 'compliance_instance',
        objectId: instanceId,
        before: { status: before.status },
        after: { status: opts.to },
        reason: opts.reason ?? null,
      });
      return (await this.selectInstance(client, instanceId, engagementId))!;
    });
  }

  /** UPDATE the instance with an optimistic version guard, scoped to the engagement. */
  private async versionedUpdate(
    client: PoolClient,
    instanceId: string,
    engagementId: string,
    setClause: string,
    setParams: unknown[],
    expectedVersion: number | undefined,
  ): Promise<boolean> {
    const params = [...setParams, instanceId, engagementId];
    const idParam = `$${params.length - 1}`;
    const engParam = `$${params.length}`;
    let versionClause = '';
    if (expectedVersion !== undefined) {
      params.push(expectedVersion);
      versionClause = ` AND version = $${params.length}`;
    }
    let updated: number;
    try {
      const result = await client.query(
        `UPDATE hsdg.compliance_instances SET ${setClause}, version = version + 1
         WHERE id = ${idParam} AND engagement_id = ${engParam}${versionClause}`,
        params,
      );
      updated = result.rowCount ?? 0;
    } catch (err) {
      throw translateComplianceError(err);
    }
    return updated > 0;
  }

  /** 0 rows updated on a visible row ⇒ either a stale version or RLS (non-lead). */
  private notPermittedOrStale(
    before: ComplianceInstanceRecord,
    expectedVersion: number | undefined,
  ): never {
    if (expectedVersion !== undefined && before.version !== expectedVersion) {
      throw new ConflictException(
        'Compliance instance was modified by someone else. Refresh and retry (stale version).',
      );
    }
    throw new ForbiddenException('Not permitted to modify this compliance instance.');
  }

  private async loadHolidays(client: PoolClient): Promise<Set<string>> {
    const { rows } = await client.query<{ holiday_date: string }>(
      `SELECT holiday_date::text FROM hsdg.compliance_holidays`,
    );
    return new Set(rows.map((r) => r.holiday_date));
  }

  private async selectInstance(
    client: PoolClient,
    instanceId: string,
    engagementId: string,
  ): Promise<ComplianceInstanceRecord | null> {
    const { rows } = await client.query<InstanceRow>(
      `${INSTANCE_BASE} WHERE ci.id = $1 AND ci.engagement_id = $2`,
      [instanceId, engagementId],
    );
    return rows[0] ? mapInstance(rows[0]) : null;
  }

  private async selectInstanceDetail(
    client: PoolClient,
    instanceId: string,
    engagementId: string,
  ): Promise<ComplianceInstanceDetail | null> {
    const base = await this.selectInstance(client, instanceId, engagementId);
    if (!base) return null;
    const { rows } = await client.query<{
      id: string;
      clock: ComplianceClock;
      previous_date: string | null;
      new_date: string;
      reason: string;
      evidence_reference: string | null;
      actor_user_id: string | null;
      actor_role: string | null;
      created_at: Date;
    }>(
      `SELECT id, clock, previous_date::text, new_date::text, reason, evidence_reference,
              actor_user_id, actor_role, created_at
       FROM hsdg.compliance_instance_overrides
       WHERE compliance_instance_id = $1
       ORDER BY created_at DESC`,
      [instanceId],
    );
    const overrides: ComplianceOverrideRecord[] = rows.map((r) => ({
      id: r.id,
      clock: r.clock,
      previousDate: r.previous_date,
      newDate: r.new_date,
      reason: r.reason,
      evidenceReference: r.evidence_reference,
      actorUserId: r.actor_user_id,
      actorRole: r.actor_role,
      createdAt: r.created_at.toISOString(),
    }));
    return { ...base, overrides };
  }
}

function mapInstance(row: InstanceRow): ComplianceInstanceRecord {
  return {
    id: row.id,
    engagementId: row.engagement_id,
    complianceRuleId: row.compliance_rule_id,
    complianceRuleCode: row.rule_code,
    complianceRuleName: row.rule_name,
    complianceRuleVersionId: row.compliance_rule_version_id,
    complianceRuleVersion: row.rule_version,
    referenceDate: row.reference_date,
    statutoryDeadline: row.statutory_deadline,
    statutoryDeadlineOverride: row.statutory_deadline_override,
    effectiveStatutoryDeadline: row.effective_statutory,
    internalSlaDate: row.internal_sla_date,
    internalSlaOverride: row.internal_sla_override,
    effectiveInternalSlaDate: row.effective_sla,
    status: row.status,
    isStatutoryOverdue: row.is_statutory_overdue,
    isInternallyOverdue: row.is_internally_overdue,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    completedById: row.completed_by_employee_id,
    completedByName: row.completed_by_name,
    notes: row.notes,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
