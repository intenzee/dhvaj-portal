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
  type DueDateCategory,
  type DueDateSource,
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
  ApplyExtensionInput,
  BulkGenerateResult,
  ComplianceCalendarRecord,
  ComplianceInstanceDetail,
  ComplianceInstanceRecord,
  ComplianceOverrideRecord,
  CompleteInstanceInput,
  GenerateInstanceInput,
  InstanceGovernmentExtension,
  OverrideInstanceInput,
  WaiveInstanceInput,
} from './compliance.types';

interface CalendarExtraRow {
  engagement_code: string;
  entity_name: string;
  service_code: string;
}

interface InstanceRow {
  id: string;
  engagement_id: string;
  compliance_rule_id: string;
  rule_code: string;
  rule_name: string;
  due_date_category: DueDateCategory;
  due_date_source: DueDateSource | null;
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
  is_extended: boolean;
  government_extension_id: string | null;
  ext_original_due_date: string | null;
  ext_revised_due_date: string | null;
  ext_notification_reference: string | null;
  ext_applicable_population: string | null;
  ext_effective_date: string | null;
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

/**
 * The operative statutory date, in precedence order (§19/§20):
 *   1. manual override  (§20 — the authorised exception)
 *   2. government extension revised date  (§19 — the overlay)
 *   3. computed snapshot  (the original statutory deadline)
 * The original (ci.statutory_deadline) is always retained alongside.
 */
const EFFECTIVE_STATUTORY = `COALESCE(ci.statutory_deadline_override, ge.revised_due_date, ci.statutory_deadline)`;

const INSTANCE_BASE = `
  SELECT ci.id, ci.engagement_id, ci.compliance_rule_id, cr.code AS rule_code, cr.name AS rule_name,
         cr.due_date_category, cr.due_date_source,
         ci.compliance_rule_version_id, crv.version AS rule_version,
         ci.reference_date::text, ci.statutory_deadline::text, ci.statutory_deadline_override::text,
         ${EFFECTIVE_STATUTORY}::text AS effective_statutory,
         ci.internal_sla_date::text, ci.internal_sla_override::text,
         COALESCE(ci.internal_sla_override, ci.internal_sla_date)::text AS effective_sla,
         ci.status,
         (ci.status = 'open' AND ${EFFECTIVE_STATUTORY} < CURRENT_DATE)
           AS is_statutory_overdue,
         (ci.status = 'open' AND COALESCE(ci.internal_sla_override, ci.internal_sla_date) < CURRENT_DATE)
           AS is_internally_overdue,
         (ci.government_extension_id IS NOT NULL) AS is_extended,
         ci.government_extension_id,
         ge.original_due_date::text AS ext_original_due_date,
         ge.revised_due_date::text AS ext_revised_due_date,
         ge.notification_reference AS ext_notification_reference,
         ge.applicable_population AS ext_applicable_population,
         ge.effective_date::text AS ext_effective_date,
         ci.completed_at, ci.completed_by_employee_id, ce.full_name AS completed_by_name,
         ci.notes, ci.version, ci.created_at, ci.updated_at
  FROM hsdg.compliance_instances ci
  JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
  JOIN hsdg.compliance_rule_versions crv ON crv.id = ci.compliance_rule_version_id
  LEFT JOIN hsdg.employees ce ON ce.id = ci.completed_by_employee_id
  LEFT JOIN hsdg.government_extensions ge ON ge.id = ci.government_extension_id`;

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
    // referenceDate and eventDate are inputs for different bases — a rule uses
    // exactly one, so supplying both is ambiguous (it could pick the version
    // "as of" the wrong date). Reject rather than silently prefer one.
    if (input.referenceDate && input.eventDate) {
      throw new BadRequestException(
        'Provide either referenceDate or eventDate, not both — a compliance rule uses a single basis.',
      );
    }
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

  /**
   * Generate obligations for every active rule linked to the engagement's
   * service, in one call. Each rule is generated in its own transaction, so a
   * rule that can't be derived automatically (a period/event basis needing an
   * explicit date), doesn't apply under the context, or already exists is
   * skipped with a reason rather than failing the batch.
   */
  async generateForService(
    ctx: RlsContext,
    engagementId: string,
    input: { context?: Record<string, unknown> },
  ): Promise<BulkGenerateResult> {
    const codes = await this.db.withRlsContext(ctx, async (client) => {
      const eng = await client.query<{ service_id: string }>(
        `SELECT service_id FROM hsdg.engagements WHERE id = $1`,
        [engagementId],
      );
      if (!eng.rows[0]) throw new NotFoundException('Engagement not found.');
      const { rows } = await client.query<{ code: string }>(
        `SELECT code FROM hsdg.compliance_rules
         WHERE service_id = $1 AND is_active = true ORDER BY code`,
        [eng.rows[0].service_id],
      );
      return rows.map((r) => r.code);
    });
    if (codes.length === 0) {
      throw new BadRequestException(
        "No active compliance rules are linked to this engagement's service.",
      );
    }

    const generated: ComplianceInstanceRecord[] = [];
    const skipped: Array<{ rule: string; reason: string }> = [];
    for (const code of codes) {
      try {
        generated.push(
          await this.generate(ctx, engagementId, {
            complianceRuleCode: code,
            ...(input.context ? { context: input.context } : {}),
          }),
        );
      } catch (err) {
        skipped.push({ rule: code, reason: (err as Error).message ?? 'skipped' });
      }
    }
    return { generated, skipped };
  }

  async list(
    ctx: RlsContext,
    engagementId: string,
    page: PageParams,
    filter: { status?: ComplianceStatus } = {},
  ): Promise<PageResult<ComplianceInstanceRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const eng = await client.query(`SELECT 1 FROM hsdg.engagements WHERE id = $1`, [
        engagementId,
      ]);
      if (!eng.rows[0]) throw new NotFoundException('Engagement not found.');

      const params: unknown[] = [engagementId];
      let statusClause = '';
      if (filter.status) {
        params.push(filter.status);
        statusClause = ` AND ci.status = $${params.length}`;
      }
      params.push(page.limit, page.offset);
      const { rows } = await client.query<InstanceRow>(
        `${INSTANCE_BASE}
         WHERE ci.engagement_id = $1${statusClause}
         ORDER BY ${EFFECTIVE_STATUTORY}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const totalRes = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM hsdg.compliance_instances ci
         WHERE ci.engagement_id = $1${statusClause}`,
        params.slice(0, params.length - 2),
      );
      return {
        items: rows.map(mapInstance),
        total: Number(totalRes.rows[0]?.total ?? 0),
      };
    });
  }

  /**
   * A firm-wide compliance calendar (§12): every obligation across the
   * engagements the caller can see (RLS-scoped), ordered by effective statutory
   * deadline. Filter by status, a due-date window, and overdue-only — the data
   * behind a Compliance Calendar / "due soon" dashboard card.
   */
  async calendar(
    ctx: RlsContext,
    page: PageParams,
    filter: {
      status?: ComplianceStatus;
      dueFrom?: string;
      dueTo?: string;
      overdueOnly?: boolean;
      dueDateCategory?: DueDateCategory;
    } = {},
  ): Promise<PageResult<ComplianceCalendarRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (filter.status) {
        params.push(filter.status);
        conditions.push(`ci.status = $${params.length}`);
      }
      if (filter.dueDateCategory) {
        params.push(filter.dueDateCategory);
        conditions.push(`cr.due_date_category = $${params.length}`);
      }
      const effective = EFFECTIVE_STATUTORY;
      if (filter.dueFrom) {
        params.push(filter.dueFrom);
        conditions.push(`${effective} >= $${params.length}::date`);
      }
      if (filter.dueTo) {
        params.push(filter.dueTo);
        conditions.push(`${effective} <= $${params.length}::date`);
      }
      if (filter.overdueOnly) {
        conditions.push(`ci.status = 'open' AND ${effective} < CURRENT_DATE`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(page.limit, page.offset);

      const { rows } = await client.query<InstanceRow & CalendarExtraRow>(
        `${INSTANCE_BASE.replace(
          'FROM hsdg.compliance_instances ci',
          `, eng.engagement_code, ent.legal_name AS entity_name, s.code AS service_code
           FROM hsdg.compliance_instances ci
           JOIN hsdg.engagements eng ON eng.id = ci.engagement_id
           JOIN hsdg.entities ent ON ent.id = eng.entity_id
           JOIN hsdg.services s ON s.id = eng.service_id`,
        )}
         ${where}
         ORDER BY ${effective}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const totalRes = await client.query<{ total: string }>(
        // The rule + extension joins must be present here too: ${where} can
        // filter on the effective statutory date (ge.revised_due_date) and on
        // the rule's due-date category (cr.due_date_category).
        `SELECT count(*) AS total FROM hsdg.compliance_instances ci
         JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
         LEFT JOIN hsdg.government_extensions ge ON ge.id = ci.government_extension_id ${where}`,
        params.slice(0, params.length - 2),
      );
      return {
        items: rows.map((r) => ({
          ...mapInstance(r),
          engagementCode: r.engagement_code,
          entityName: r.entity_name,
          serviceCode: r.service_code,
        })),
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

  /**
   * Apply a government extension (§19) as an OVERLAY on this obligation's
   * statutory clock. Unlike a manual override (§20), the extension is a
   * firm-wide record referenced by id — the instance keeps its original computed
   * date, and the effective statutory date becomes the extension's revised date
   * (unless a manual override, higher precedence, is also present). Open only.
   */
  async applyExtension(
    ctx: RlsContext,
    engagementId: string,
    instanceId: string,
    input: ApplyExtensionInput,
  ): Promise<ComplianceInstanceDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectInstance(client, instanceId, engagementId);
      if (!before) throw new NotFoundException('Compliance instance not found.');
      if (before.status !== COMPLIANCE_STATUS.open) {
        throw new BadRequestException(
          `Cannot apply an extension to a "${before.status}" compliance instance — only open obligations.`,
        );
      }

      // The extension must exist and target the SAME rule — an extension is
      // evidence tied to one statutory obligation, never applied cross-rule.
      const extRes = await client.query<{
        id: string;
        compliance_rule_id: string;
        revised_due_date: string;
        notification_reference: string;
      }>(
        `SELECT id, compliance_rule_id, revised_due_date::text, notification_reference
         FROM hsdg.government_extensions WHERE id = $1`,
        [input.governmentExtensionId],
      );
      if (!extRes.rows[0]) throw new BadRequestException('Unknown government extension.');
      const ext = extRes.rows[0];
      if (ext.compliance_rule_id !== before.complianceRuleId) {
        throw new BadRequestException(
          'This government extension targets a different compliance rule than the obligation.',
        );
      }

      const correlationId = resolveAmbientCorrelationId(this.cls) ?? null;
      const updated = await this.versionedUpdate(
        client,
        instanceId,
        engagementId,
        `government_extension_id = $1`,
        [ext.id],
        input.version,
      );
      if (!updated) return this.notPermittedOrStale(before, input.version);

      await this.audit.recordWith(client, ctx, {
        action: 'compliance.extension_applied',
        objectType: 'compliance_instance',
        objectId: instanceId,
        before: { effectiveStatutory: before.effectiveStatutoryDeadline },
        after: {
          governmentExtensionId: ext.id,
          revisedDueDate: ext.revised_due_date,
          notificationReference: ext.notification_reference,
        },
        correlationId,
      });
      return (await this.selectInstanceDetail(client, instanceId, engagementId))!;
    });
  }

  /** Remove a government extension overlay, reverting to the original clock (audited). */
  async clearExtension(
    ctx: RlsContext,
    engagementId: string,
    instanceId: string,
    version: number | undefined,
  ): Promise<ComplianceInstanceDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectInstance(client, instanceId, engagementId);
      if (!before) throw new NotFoundException('Compliance instance not found.');
      if (!before.isExtended) {
        throw new BadRequestException('No government extension is applied to this obligation.');
      }
      const correlationId = resolveAmbientCorrelationId(this.cls) ?? null;
      const updated = await this.versionedUpdate(
        client,
        instanceId,
        engagementId,
        `government_extension_id = NULL`,
        [],
        version,
      );
      if (!updated) return this.notPermittedOrStale(before, version);

      await this.audit.recordWith(client, ctx, {
        action: 'compliance.extension_cleared',
        objectType: 'compliance_instance',
        objectId: instanceId,
        before: { governmentExtensionId: before.governmentExtension?.id ?? null },
        after: { governmentExtensionId: null },
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
    dueDateCategory: row.due_date_category,
    dueDateSource: row.due_date_source,
    referenceDate: row.reference_date,
    statutoryDeadline: row.statutory_deadline,
    statutoryDeadlineOverride: row.statutory_deadline_override,
    revisedStatutoryDeadline: row.ext_revised_due_date,
    effectiveStatutoryDeadline: row.effective_statutory,
    internalSlaDate: row.internal_sla_date,
    internalSlaOverride: row.internal_sla_override,
    effectiveInternalSlaDate: row.effective_sla,
    status: row.status,
    isStatutoryOverdue: row.is_statutory_overdue,
    isInternallyOverdue: row.is_internally_overdue,
    isExtended: row.is_extended,
    governmentExtension: mapInstanceExtension(row),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    completedById: row.completed_by_employee_id,
    completedByName: row.completed_by_name,
    notes: row.notes,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Build the embedded government-extension summary from a joined instance row (§19). */
function mapInstanceExtension(row: InstanceRow): InstanceGovernmentExtension | null {
  if (
    row.government_extension_id === null ||
    row.ext_original_due_date === null ||
    row.ext_revised_due_date === null ||
    row.ext_notification_reference === null ||
    row.ext_applicable_population === null ||
    row.ext_effective_date === null
  ) {
    return null;
  }
  return {
    id: row.government_extension_id,
    originalDueDate: row.ext_original_due_date,
    revisedDueDate: row.ext_revised_due_date,
    notificationReference: row.ext_notification_reference,
    applicablePopulation: row.ext_applicable_population,
    effectiveDate: row.ext_effective_date,
  };
}
