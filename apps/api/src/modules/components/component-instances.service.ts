import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  COMPONENT_INSTANCE_STATUS,
  type CalculationBasis,
  type ComponentInstanceRecord,
  type ComponentInstanceStatus,
  type EngagementActivationResult,
  type GenerateInstancesResult,
  type Recurrence,
  type RollHorizonResult,
  type WorkingDayAdjustment,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { AppConfigService } from '../../config/config.module';
import { AuditService } from '../audit/audit.service';
import {
  addMonthsUTC,
  computeDeadlines,
  parseISODate,
  resolveReferenceDate,
  toISODate,
} from '../compliance/compliance-calc';
import { enumeratePeriods } from './component-periods';

interface InstanceRow {
  id: string;
  engagement_component_id: string;
  engagement_id: string;
  component_code: string;
  component_name: string;
  period_key: string;
  period_label: string;
  period_start: string;
  period_end: string;
  statutory_deadline: string | null;
  internal_sla_date: string | null;
  compliance_rule_version_id: string | null;
  status: ComponentInstanceStatus;
  is_future: boolean;
  is_overdue: boolean;
  completed_at: Date | null;
  completed_by_employee_id: string | null;
  completed_by_name: string | null;
  notes: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface RuleVersionRow {
  id: string;
  effective_from: string;
  effective_to: string | null;
  calculation_basis: CalculationBasis;
  offset_months: number;
  offset_days: number;
  fixed_month: number | null;
  fixed_day: number | null;
  working_day_adjustment: WorkingDayAdjustment;
  internal_sla_offset_days: number;
}

interface ConfigRow {
  id: string;
  frequency: Recurrence;
  status: string;
  applicability_status: string;
  component_code: string;
  compliance_rule_id: string | null;
  // The manual "active window" (spec §13/§24) — generation is bounded to periods
  // that overlap [start_date, end_date]. Either end is optional (open-ended).
  start_date: string | null;
  end_date: string | null;
}

const CONFIG_SELECT = `
  SELECT ec.id, ec.frequency, ec.status, ec.applicability_status,
         ec.start_date::text, ec.end_date::text,
         sc.code AS component_code, sc.compliance_rule_id
  FROM hsdg.engagement_components ec
  JOIN hsdg.service_components sc ON sc.id = ec.service_component_id`;

const INSTANCE_BASE = `
  SELECT ci.id, ci.engagement_component_id, ci.engagement_id,
         sc.code AS component_code, sc.name AS component_name,
         ci.period_key, ci.period_label, ci.period_start::text, ci.period_end::text,
         ci.statutory_deadline::text, ci.internal_sla_date::text, ci.compliance_rule_version_id,
         ci.status,
         (ci.period_start > CURRENT_DATE) AS is_future,
         (ci.status IN ('scheduled','active') AND ci.statutory_deadline IS NOT NULL
            AND ci.statutory_deadline < CURRENT_DATE) AS is_overdue,
         ci.completed_at, ci.completed_by_employee_id, ce.full_name AS completed_by_name,
         ci.notes, ci.version, ci.created_at, ci.updated_at
  FROM hsdg.component_instances ci
  JOIN hsdg.engagement_components ec ON ec.id = ci.engagement_component_id
  JOIN hsdg.service_components sc ON sc.id = ec.service_component_id
  LEFT JOIN hsdg.employees ce ON ce.id = ci.completed_by_employee_id`;

/**
 * Component work generation (spec §21–§22, §36). A configured recurring
 * component generates one instance per period of the engagement's financial
 * year; a one-time component, a single instance. Generation is idempotent (a
 * unique (component, period) key), so re-running never duplicates and simply
 * fills any period newly in range. Each instance SNAPSHOTS the compliance rule
 * version used for its deadline, so a later rule change never rewrites history.
 * Engagement-scoped RLS (members read, leads write) governs access.
 */
@Injectable()
export class ComponentInstancesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /** The firm's configured recurring-work horizon, in months (spec §18). */
  configuredHorizonMonths(): number {
    return this.config.get('COMPLIANCE_HORIZON_MONTHS');
  }

  /** The horizon cut-off date (today + configured/overridden months), ISO. */
  private horizonEnd(overrideMonths?: number): string {
    const months = overrideMonths ?? this.config.get('COMPLIANCE_HORIZON_MONTHS');
    const today = parseISODate(toISODate(new Date()));
    return toISODate(addMonthsUTC(today, months));
  }

  /** Generate instances for one configured component (idempotent). */
  async generateForComponent(
    ctx: RlsContext,
    engagementId: string,
    componentId: string,
  ): Promise<GenerateInstancesResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const financialYear = await this.engagementFy(client, engagementId);
      const config = await this.loadConfig(client, engagementId, componentId);
      const result = await this.generateOne(
        client,
        engagementId,
        financialYear,
        config,
        this.horizonEnd(),
      );
      await this.audit.recordWith(client, ctx, {
        action: 'component.work_generated',
        objectType: 'engagement_component',
        objectId: componentId,
        after: {
          generated: result.generated.length,
          removed: result.removed.length,
          skipped: result.skipped.length,
        },
      });
      return result;
    });
  }

  /** Generate for every live, applicable component on the engagement (bulk, §21). */
  async generateAll(ctx: RlsContext, engagementId: string): Promise<GenerateInstancesResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const financialYear = await this.engagementFy(client, engagementId);
      const { rows: configs } = await client.query<ConfigRow>(
        `${CONFIG_SELECT}
         WHERE ec.engagement_id = $1
           AND ec.status NOT IN ('cancelled','superseded')
           AND ec.applicability_status <> 'not_applicable'`,
        [engagementId],
      );
      const merged: GenerateInstancesResult = { generated: [], removed: [], skipped: [] };
      const horizon = this.horizonEnd();
      for (const config of configs) {
        const one = await this.generateOne(client, engagementId, financialYear, config, horizon);
        merged.generated.push(...one.generated);
        merged.removed.push(...one.removed);
        for (const s of one.skipped)
          merged.skipped.push({ ...s, period: `${config.component_code}:${s.period}` });
      }
      await this.audit.recordWith(client, ctx, {
        action: 'component.work_generated_all',
        objectType: 'engagement',
        objectId: engagementId,
        after: {
          generated: merged.generated.length,
          removed: merged.removed.length,
          skipped: merged.skipped.length,
        },
      });
      return merged;
    });
  }

  /**
   * §20/§37 — the engagement activation ceremony. A single, gated, atomic step:
   * check preconditions, flip every DRAFT component configuration to ACTIVE and
   * generate the recurring work — all in one transaction. Only an engagement
   * lead may run it (enforced by RLS on the engagement_components write).
   */
  async activate(ctx: RlsContext, engagementId: string): Promise<EngagementActivationResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      // ── Preconditions (§37) ──────────────────────────────────────────────
      const eng = await client.query<{ engagement_partner_id: string | null }>(
        `SELECT engagement_partner_id FROM hsdg.engagements WHERE id = $1`,
        [engagementId],
      );
      if (!eng.rows[0]) throw new NotFoundException('Engagement not found.');
      if (!eng.rows[0].engagement_partner_id) {
        throw new BadRequestException(
          'Assign an accountable Engagement Partner before activating.',
        );
      }

      const { rows: configs } = await client.query<ConfigRow>(
        `${CONFIG_SELECT}
         WHERE ec.engagement_id = $1 AND ec.status NOT IN ('cancelled','superseded')`,
        [engagementId],
      );
      if (configs.length === 0) {
        throw new BadRequestException('Configure at least one component before activating.');
      }
      const pending = configs.filter((c) => c.applicability_status === 'pending_review');
      if (pending.length > 0) {
        throw new BadRequestException(
          `Resolve applicability before activating: ${pending.map((c) => c.component_code).join(', ')}.`,
        );
      }

      // ── Activate: draft configurations → active ──────────────────────────
      const flip = await client.query(
        `UPDATE hsdg.engagement_components
            SET status = 'active', version = version + 1
          WHERE engagement_id = $1 AND status = 'draft'`,
        [engagementId],
      );
      const activatedComponents = flip.rowCount ?? 0;

      // ── Generate the recurring work for every applicable component ────────
      const financialYear = await this.engagementFy(client, engagementId);
      let generated = 0;
      let removed = 0;
      const warnings: string[] = [];
      const horizon = this.horizonEnd();
      for (const config of configs) {
        if (config.applicability_status === 'not_applicable') continue;
        const one = await this.generateOne(client, engagementId, financialYear, config, horizon);
        generated += one.generated.length;
        removed += one.removed.length;
        for (const s of one.skipped) warnings.push(`${config.component_code}: ${s.reason}`);
      }

      await this.audit.recordWith(client, ctx, {
        action: 'engagement.activated',
        objectType: 'engagement',
        objectId: engagementId,
        after: { activatedComponents, generated, removed },
      });
      return { activatedComponents, generated, removed, warnings };
    });
  }

  /**
   * Rolling-horizon sweep (spec §18). Across every engagement the caller can
   * LEAD (RLS-scoped; the firm-wide operator/MP covers the whole firm), fill in
   * the recurring work now within the future horizon — idempotently, so as time
   * advances new periods are materialised and existing ones are never
   * duplicated. This is the scheduled worker's entry point (a cron authenticates
   * as the firm-wide operator); it can also be scoped to one engagement.
   */
  async rollHorizon(
    ctx: RlsContext,
    opts: { horizonMonths?: number; engagementId?: string } = {},
  ): Promise<RollHorizonResult> {
    const months = opts.horizonMonths ?? this.config.get('COMPLIANCE_HORIZON_MONTHS');
    const horizonEndDate = this.horizonEnd(opts.horizonMonths);
    return this.db.withRlsContext(ctx, async (client) => {
      const engParams: unknown[] = [];
      let engFilter = '';
      if (opts.engagementId) {
        engParams.push(opts.engagementId);
        engFilter = ` AND e.id = $${engParams.length}`;
      }
      // Engagements the caller can WRITE (is_engagement_lead) that carry at least
      // one live, applicable component configuration.
      const { rows: engs } = await client.query<{ id: string; financial_year: string }>(
        `SELECT DISTINCT e.id, e.financial_year
         FROM hsdg.engagements e
         JOIN hsdg.engagement_components ec ON ec.engagement_id = e.id
         WHERE ec.status NOT IN ('cancelled','superseded')
           AND ec.applicability_status <> 'not_applicable'
           AND hsdg.is_engagement_lead(e.id)${engFilter}`,
        engParams,
      );

      let engagementsProcessed = 0;
      let generated = 0;
      let removed = 0;
      for (const eng of engs) {
        const { rows: configs } = await client.query<ConfigRow>(
          `${CONFIG_SELECT}
           WHERE ec.engagement_id = $1
             AND ec.status NOT IN ('cancelled','superseded')
             AND ec.applicability_status <> 'not_applicable'`,
          [eng.id],
        );
        for (const config of configs) {
          const one = await this.generateOne(
            client,
            eng.id,
            eng.financial_year,
            config,
            horizonEndDate,
          );
          generated += one.generated.length;
          removed += one.removed.length;
        }
        engagementsProcessed += 1;
      }

      await this.audit.recordWith(client, ctx, {
        action: 'compliance.horizon_rolled',
        objectType: 'engagement',
        objectId: opts.engagementId ?? null,
        after: { horizonMonths: months, horizonEndDate, engagementsProcessed, generated, removed },
      });
      return { horizonMonths: months, horizonEndDate, engagementsProcessed, generated, removed };
    });
  }

  async list(
    ctx: RlsContext,
    engagementId: string,
    page: PageParams,
    filter: { componentId?: string; status?: ComponentInstanceStatus },
  ): Promise<PageResult<ComponentInstanceRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const params: unknown[] = [engagementId];
      const conds: string[] = [`ci.engagement_id = $1`];
      if (filter.componentId) {
        params.push(filter.componentId);
        conds.push(`ci.engagement_component_id = $${params.length}`);
      }
      if (filter.status) {
        params.push(filter.status);
        conds.push(`ci.status = $${params.length}`);
      }
      const where = conds.join(' AND ');
      params.push(page.limit, page.offset);
      const { rows } = await client.query<InstanceRow & { total_count: string }>(
        `SELECT c.*, count(*) OVER() AS total_count
         FROM (${INSTANCE_BASE} WHERE ${where}) c
         ORDER BY c.component_code, c.period_start
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        items: rows.map(mapInstance),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }

  /** Transition an instance: complete / waive / cancel / (re)activate. */
  async setStatus(
    ctx: RlsContext,
    engagementId: string,
    instanceId: string,
    input: { status: ComponentInstanceStatus; notes?: string; version?: number },
  ): Promise<ComponentInstanceRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.selectOne(client, engagementId, instanceId);
      if (input.version !== undefined && input.version !== current.version) {
        throw new BadRequestException(
          `Instance was modified concurrently (expected version ${input.version}, found ${current.version}).`,
        );
      }
      const setsCompleted = input.status === COMPONENT_INSTANCE_STATUS.completed;
      await client.query(
        `UPDATE hsdg.component_instances
         SET status = $3,
             completed_at = CASE WHEN $4 THEN now() ELSE NULL END,
             completed_by_employee_id = CASE WHEN $4 THEN hsdg.ctx_employee_id() ELSE NULL END,
             notes = COALESCE($5, notes),
             version = version + 1
         WHERE id = $1 AND engagement_id = $2`,
        [instanceId, engagementId, input.status, setsCompleted, input.notes ?? null],
      );
      const record = await this.selectOne(client, engagementId, instanceId);
      await this.audit.recordWith(client, ctx, {
        action: 'component.instance_status_changed',
        objectType: 'component_instance',
        objectId: instanceId,
        before: { status: current.status },
        after: { status: input.status },
      });
      return record;
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async generateOne(
    client: PoolClient,
    engagementId: string,
    financialYear: string,
    config: ConfigRow,
    horizonEndIso: string,
  ): Promise<GenerateInstancesResult> {
    const generated: ComponentInstanceRecord[] = [];
    const removed: ComponentInstanceRecord[] = [];
    const skipped: Array<{ period: string; reason: string }> = [];

    // Determine the TARGET period set for the current config. When generation is
    // suppressed (component removed / not applicable / ad-hoc frequency / an
    // empty active window), the target is empty — the reconcile below then
    // cancels any scheduled work that no longer belongs.
    //
    // Two sets are derived. `windowPeriods` is the config's full in-window set
    // (frequency × active window) — it drives the cancel-reconcile, so existing
    // future work is never cancelled merely for being beyond the horizon.
    // `periods` further restricts to the FUTURE HORIZON (§18) and drives what is
    // CREATED now; the rolling job fills the rest as time advances.
    let windowPeriods: ReturnType<typeof enumeratePeriods> = [];
    let periods: ReturnType<typeof enumeratePeriods> = [];
    if (config.status === 'cancelled' || config.status === 'superseded') {
      skipped.push({ period: '—', reason: 'component configuration is removed' });
    } else if (config.applicability_status === 'not_applicable') {
      skipped.push({ period: '—', reason: 'component is not applicable' });
    } else {
      const allPeriods = enumeratePeriods(config.frequency, financialYear);
      if (allPeriods.length === 0) {
        skipped.push({
          period: '—',
          reason: `${config.frequency} is ad-hoc — no periods generated`,
        });
      } else {
        // Manual "active window" (spec §13/§24): if the user set an active-from
        // and/or active-to, keep only periods that OVERLAP that window — so "I
        // look after this client Apr–Sep" produces only Apr–Sep work.
        windowPeriods = allPeriods.filter(
          (p) =>
            (config.start_date === null || p.end >= config.start_date) &&
            (config.end_date === null || p.start <= config.end_date),
        );
        // FUTURE HORIZON (spec §18): only CREATE periods starting on/before the
        // horizon cut-off. Past periods are always in scope; the rolling job
        // re-runs to fill periods as they come within the horizon. The horizon
        // never cancels already-created in-window work (it only bounds creation).
        periods = windowPeriods.filter((p) => p.start <= horizonEndIso);
        if (windowPeriods.length === 0) {
          skipped.push({
            period: '—',
            reason: 'no periods fall within the component’s active window',
          });
        }
      }
    }

    const versions =
      periods.length > 0 && config.compliance_rule_id
        ? await this.loadVersions(client, config.compliance_rule_id)
        : [];
    const holidays = versions.length > 0 ? await this.loadHolidays(client) : new Set<string>();

    // Reconcile to the current config (frequency × active window), not merely
    // "add missing": the target set is exactly the in-window periods. Existing
    // work is created/revived to match, and anything now out of scope that has
    // NOT been finalised is cancelled — so narrowing the window (or changing
    // frequency) actually shrinks the generated work. Completed/waived work is
    // never touched (§25).
    const { rows: existing } = await client.query<{
      id: string;
      period_key: string;
      status: string;
    }>(
      `SELECT id, period_key, status FROM hsdg.component_instances
       WHERE engagement_component_id = $1`,
      [config.id],
    );
    const existingByKey = new Map(existing.map((e) => [e.period_key, e]));
    // Reconcile against the full in-window set, not the horizon-limited set — so
    // future in-window work already created is kept, only truly out-of-scope
    // (out-of-window / stale-frequency) work is cancelled.
    const targetKeys = new Set(windowPeriods.map((p) => p.key));

    // 1. Ensure every in-window period exists and is live.
    for (const period of periods) {
      const deadline = this.computeForPeriod(versions, financialYear, period.end, holidays);
      const ex = existingByKey.get(period.key);
      if (!ex) {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.component_instances
             (engagement_component_id, engagement_id, period_key, period_label, period_start,
              period_end, statutory_deadline, internal_sla_date, compliance_rule_version_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            config.id,
            engagementId,
            period.key,
            period.label,
            period.start,
            period.end,
            deadline?.statutoryDeadline ?? null,
            deadline?.internalSlaDate ?? null,
            deadline?.versionId ?? null,
          ],
        );
        generated.push(await this.selectOne(client, engagementId, rows[0]!.id));
      } else if (ex.status === 'cancelled') {
        // Re-widening the window revives a previously cancelled period.
        await client.query(
          `UPDATE hsdg.component_instances
           SET status = 'scheduled', statutory_deadline = $2, internal_sla_date = $3,
               compliance_rule_version_id = $4, version = version + 1
           WHERE id = $1`,
          [
            ex.id,
            deadline?.statutoryDeadline ?? null,
            deadline?.internalSlaDate ?? null,
            deadline?.versionId ?? null,
          ],
        );
        generated.push(await this.selectOne(client, engagementId, ex.id));
      } else {
        skipped.push({ period: period.key, reason: 'already exists' });
      }
    }

    // 2. Cancel scheduled/active work that is no longer in scope (out of the
    //    window, or left over from a previous frequency). Finalised work stays.
    for (const ex of existing) {
      if (!targetKeys.has(ex.period_key) && (ex.status === 'scheduled' || ex.status === 'active')) {
        await client.query(
          `UPDATE hsdg.component_instances SET status = 'cancelled', version = version + 1
           WHERE id = $1`,
          [ex.id],
        );
        removed.push(await this.selectOne(client, engagementId, ex.id));
      }
    }
    return { generated, skipped, removed };
  }

  /** Compute a period's deadline from the rule version effective as of period end. */
  private computeForPeriod(
    versions: RuleVersionRow[],
    financialYear: string,
    periodEnd: string,
    holidays: ReadonlySet<string>,
  ): { statutoryDeadline: string; internalSlaDate: string; versionId: string } | null {
    const v = pickVersion(versions, periodEnd);
    if (!v) return null;
    // event_date needs an explicit event, unavailable at generation — no deadline.
    if (v.calculation_basis === 'event_date') return null;
    const referenceDate = resolveReferenceDate(v.calculation_basis, {
      financialYear,
      referenceDate: periodEnd,
      fixedMonth: v.fixed_month,
      fixedDay: v.fixed_day,
    });
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
    return { statutoryDeadline, internalSlaDate, versionId: v.id };
  }

  private async engagementFy(client: PoolClient, engagementId: string): Promise<string> {
    const { rows } = await client.query<{ financial_year: string }>(
      `SELECT financial_year FROM hsdg.engagements WHERE id = $1`,
      [engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Engagement not found.');
    return rows[0].financial_year;
  }

  private async loadConfig(
    client: PoolClient,
    engagementId: string,
    componentId: string,
  ): Promise<ConfigRow> {
    const { rows } = await client.query<ConfigRow>(
      `${CONFIG_SELECT} WHERE ec.id = $1 AND ec.engagement_id = $2`,
      [componentId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Component configuration not found.');
    return rows[0];
  }

  private async loadVersions(client: PoolClient, ruleId: string): Promise<RuleVersionRow[]> {
    const { rows } = await client.query<RuleVersionRow>(
      `SELECT id, effective_from::text, effective_to::text, calculation_basis, offset_months,
              offset_days, fixed_month, fixed_day, working_day_adjustment, internal_sla_offset_days
       FROM hsdg.compliance_rule_versions
       WHERE compliance_rule_id = $1
       ORDER BY effective_from`,
      [ruleId],
    );
    return rows;
  }

  private async loadHolidays(client: PoolClient): Promise<Set<string>> {
    const { rows } = await client.query<{ holiday_date: string }>(
      `SELECT holiday_date::text FROM hsdg.compliance_holidays`,
    );
    return new Set(rows.map((r) => r.holiday_date));
  }

  private async selectOne(
    client: PoolClient,
    engagementId: string,
    instanceId: string,
  ): Promise<ComponentInstanceRecord> {
    const { rows } = await client.query<InstanceRow>(
      `${INSTANCE_BASE} WHERE ci.id = $1 AND ci.engagement_id = $2`,
      [instanceId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Component instance not found.');
    return mapInstance(rows[0]);
  }
}

/** Pick the rule version in force as of a date (latest effective_from ≤ asOf, within range). */
function pickVersion(versions: RuleVersionRow[], asOf: string): RuleVersionRow | null {
  let chosen: RuleVersionRow | null = null;
  for (const v of versions) {
    if (v.effective_from <= asOf && (v.effective_to === null || asOf <= v.effective_to)) {
      // versions are ordered by effective_from ASC, so the last match wins.
      chosen = v;
    }
  }
  return chosen;
}

function mapInstance(row: InstanceRow): ComponentInstanceRecord {
  return {
    id: row.id,
    engagementComponentId: row.engagement_component_id,
    engagementId: row.engagement_id,
    componentCode: row.component_code,
    componentName: row.component_name,
    periodKey: row.period_key,
    periodLabel: row.period_label,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    statutoryDeadline: row.statutory_deadline,
    internalSlaDate: row.internal_sla_date,
    complianceRuleVersionId: row.compliance_rule_version_id,
    status: row.status,
    isFuture: row.is_future,
    isOverdue: row.is_overdue,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    completedById: row.completed_by_employee_id,
    completedByName: row.completed_by_name,
    notes: row.notes,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
