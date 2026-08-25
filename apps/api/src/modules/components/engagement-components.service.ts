import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  COMPONENT_APPLICABILITY_DEFAULT,
  COMPONENT_APPLICABILITY_STATUS,
  COMPONENT_CONFIG_STATUS,
  COMPONENT_DISCOVERY_CATEGORY,
  type ComponentApplicabilityDefault,
  type ComponentApplicabilityStatus,
  type ComponentConfigStatus,
  type ComponentDiscoveryCategory,
  type ComponentDiscoveryResult,
  type ComponentDiscoveryRow,
  type EngagementComponentRecord,
  type Recurrence,
  type CalculationBasis,
  type WorkingDayAdjustment,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { computeDeadlines, resolveReferenceDate } from '../compliance/compliance-calc';
import type { ConfigureComponentInput, UpdateEngagementComponentInput } from './components.types';
import { translateComponentError } from './service-components.service';

interface EngagementComponentRow {
  id: string;
  engagement_id: string;
  service_component_id: string;
  component_code: string;
  component_name: string;
  applicability_status: ComponentApplicabilityStatus;
  applicability_reason: string | null;
  frequency: Recurrence;
  owner_employee_id: string | null;
  owner_name: string | null;
  reviewer_employee_id: string | null;
  reviewer_name: string | null;
  ep_review_required: boolean;
  status: ComponentConfigStatus;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  compliance_rule_version_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface CatalogueRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  default_applicability: ComponentApplicabilityDefault;
  default_frequency: Recurrence;
  compliance_rule_id: string | null;
}

const EC_BASE = `
  SELECT ec.id, ec.engagement_id, ec.service_component_id, sc.code AS component_code,
         sc.name AS component_name, ec.applicability_status, ec.applicability_reason, ec.frequency,
         ec.owner_employee_id, oe.full_name AS owner_name,
         ec.reviewer_employee_id, re.full_name AS reviewer_name,
         ec.ep_review_required, ec.status, ec.start_date::text, ec.end_date::text, ec.notes,
         ec.compliance_rule_version_id, ec.version, ec.created_at, ec.updated_at
  FROM hsdg.engagement_components ec
  JOIN hsdg.service_components sc ON sc.id = ec.service_component_id
  LEFT JOIN hsdg.employees oe ON oe.id = ec.owner_employee_id
  LEFT JOIN hsdg.employees re ON re.id = ec.reviewer_employee_id`;

/** A live config is anything not cancelled/superseded (matches the DB unique index). */
const LIVE_STATUSES: ComponentConfigStatus[] = [
  COMPONENT_CONFIG_STATUS.draft,
  COMPONENT_CONFIG_STATUS.active,
  COMPONENT_CONFIG_STATUS.onHold,
  COMPONENT_CONFIG_STATUS.completed,
];

/**
 * Per-engagement component CONFIGURATION and the Component Discovery engine
 * (spec §11–§13, §16, §24). Discovery categorises the catalogue for one
 * engagement's service and previews deadlines; configuration records the
 * professional applicability decision, frequency, owner/reviewer and lifecycle
 * status. Engagement-scoped RLS (members read, leads write) governs access, so
 * the platform admin never touches a client's component configuration.
 */
@Injectable()
export class EngagementComponentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** §11/§12 — categorise the service's catalogue for this engagement. */
  async discover(ctx: RlsContext, engagementId: string): Promise<ComponentDiscoveryResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const eng = await this.loadEngagement(client, engagementId);

      const { rows: catalogue } = await client.query<CatalogueRow>(
        `SELECT id, code, name, description, default_applicability, default_frequency,
                compliance_rule_id
         FROM hsdg.service_components
         WHERE service_id = $1 AND is_active = true
         ORDER BY display_order, code`,
        [eng.service_id],
      );

      // Existing configurations on this engagement, keyed by component.
      const { rows: existing } = await client.query<{
        id: string;
        service_component_id: string;
        status: ComponentConfigStatus;
        applicability_status: ComponentApplicabilityStatus;
      }>(
        `SELECT id, service_component_id, status, applicability_status
         FROM hsdg.engagement_components WHERE engagement_id = $1`,
        [engagementId],
      );
      // Prefer a live config; fall back to any historical one for display only.
      const liveByComponent = new Map<string, (typeof existing)[number]>();
      const anyByComponent = new Map<string, (typeof existing)[number]>();
      for (const row of existing) {
        anyByComponent.set(row.service_component_id, row);
        if (LIVE_STATUSES.includes(row.status)) liveByComponent.set(row.service_component_id, row);
      }

      const holidays = await this.loadHolidays(client);
      const rows: ComponentDiscoveryRow[] = [];
      for (const c of catalogue) {
        const live = liveByComponent.get(c.id);
        const historical = anyByComponent.get(c.id);
        const preview = c.compliance_rule_id
          ? await this.previewDeadline(client, c.compliance_rule_id, eng.financial_year, holidays)
          : null;

        const category = live
          ? mapStatusToCategory(live.applicability_status)
          : defaultToCategory(c.default_applicability);
        const reason = live
          ? `Configured on this engagement (${live.status}).`
          : defaultReason(c.default_applicability);

        rows.push({
          serviceComponentId: c.id,
          code: c.code,
          name: c.name,
          description: c.description,
          category,
          reason,
          frequency: c.default_frequency,
          statutoryDeadlinePreview: preview?.statutoryDeadline ?? null,
          internalDeadlinePreview: preview?.internalSlaDate ?? null,
          complianceRuleVersionId: preview?.versionId ?? null,
          alreadyConfigured: Boolean(live),
          engagementComponentId: (live ?? historical)?.id ?? null,
          configuredStatus: (live ?? historical)?.status ?? null,
        });
      }

      const counts = {
        [COMPONENT_DISCOVERY_CATEGORY.mandatory]: 0,
        [COMPONENT_DISCOVERY_CATEGORY.applicable]: 0,
        [COMPONENT_DISCOVERY_CATEGORY.optional]: 0,
        [COMPONENT_DISCOVERY_CATEGORY.notApplicable]: 0,
        [COMPONENT_DISCOVERY_CATEGORY.pendingReview]: 0,
      } as Record<ComponentDiscoveryCategory, number>;
      for (const r of rows) counts[r.category] += 1;

      return {
        engagementId,
        serviceId: eng.service_id,
        serviceCode: eng.service_code,
        financialYear: eng.financial_year,
        rows,
        counts,
      };
    });
  }

  async list(
    ctx: RlsContext,
    engagementId: string,
    page: PageParams,
    filter: { status?: ComponentConfigStatus },
  ): Promise<PageResult<EngagementComponentRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.loadEngagement(client, engagementId); // 404 if not a member
      const params: unknown[] = [engagementId];
      let statusClause = '';
      if (filter.status) {
        params.push(filter.status);
        statusClause = `AND ec.status = $${params.length}`;
      }
      params.push(page.limit, page.offset);
      const { rows } = await client.query<EngagementComponentRow>(
        `${EC_BASE}
         WHERE ec.engagement_id = $1 ${statusClause}
         ORDER BY sc.display_order, sc.code
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const countParams: unknown[] = [engagementId];
      if (filter.status) countParams.push(filter.status);
      const { rows: countRows } = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM hsdg.engagement_components ec
         WHERE ec.engagement_id = $1 ${filter.status ? 'AND ec.status = $2' : ''}`,
        countParams,
      );
      return {
        items: rows.map(mapEngagementComponent),
        total: countRows[0] ? Number(countRows[0].total) : 0,
      };
    });
  }

  /** §12/§13 — select and configure a component on this engagement. */
  async configure(
    ctx: RlsContext,
    engagementId: string,
    input: ConfigureComponentInput,
  ): Promise<EngagementComponentRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.loadEngagement(client, engagementId);
      const component = await this.resolveComponent(client, input.serviceComponentCode);

      const applicabilityStatus =
        input.applicabilityStatus ?? defaultToStatus(component.default_applicability);
      const frequency = input.frequency ?? component.default_frequency;

      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.engagement_components
             (engagement_id, service_component_id, applicability_status, applicability_reason,
              frequency, owner_employee_id, reviewer_employee_id, ep_review_required, status,
              start_date, end_date, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,false),COALESCE($9,'draft'),$10,$11,$12)
           RETURNING id`,
          [
            engagementId,
            component.id,
            applicabilityStatus,
            input.applicabilityReason ?? null,
            frequency,
            input.ownerEmployeeId ?? null,
            input.reviewerEmployeeId ?? null,
            input.epReviewRequired ?? null,
            input.status ?? null,
            input.startDate ?? null,
            input.endDate ?? null,
            input.notes ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translateEngagementComponentError(err);
      }
      const record = (await this.selectOne(client, id))!;
      await this.audit.recordWith(client, ctx, {
        action: 'component.configured',
        objectType: 'engagement_component',
        objectId: id,
        after: { engagementId, componentCode: component.code, applicabilityStatus },
      });
      return record;
    });
  }

  /** §24 — amend an existing configuration (optimistic-locked). */
  async update(
    ctx: RlsContext,
    engagementId: string,
    componentId: string,
    input: UpdateEngagementComponentInput,
  ): Promise<EngagementComponentRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.selectOneForEngagement(client, engagementId, componentId);
      if (input.version !== undefined && input.version !== current.version) {
        throw new ConflictException(
          `Configuration was modified by someone else (expected version ${input.version}, found ${current.version}).`,
        );
      }
      const sets: string[] = [];
      const params: unknown[] = [];
      const push = (col: string, value: unknown): void => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.applicabilityStatus !== undefined)
        push('applicability_status', input.applicabilityStatus);
      if (input.applicabilityReason !== undefined)
        push('applicability_reason', input.applicabilityReason);
      if (input.frequency !== undefined) push('frequency', input.frequency);
      if (input.ownerEmployeeId !== undefined) push('owner_employee_id', input.ownerEmployeeId);
      if (input.reviewerEmployeeId !== undefined)
        push('reviewer_employee_id', input.reviewerEmployeeId);
      if (input.epReviewRequired !== undefined) push('ep_review_required', input.epReviewRequired);
      if (input.status !== undefined) push('status', input.status);
      if (input.startDate !== undefined) push('start_date', input.startDate);
      if (input.endDate !== undefined) push('end_date', input.endDate);
      if (input.notes !== undefined) push('notes', input.notes);
      if (sets.length === 0) return current;

      params.push(componentId, engagementId);
      try {
        await client.query(
          `UPDATE hsdg.engagement_components
           SET ${sets.join(', ')}, version = version + 1
           WHERE id = $${params.length - 1} AND engagement_id = $${params.length}`,
          params,
        );
      } catch (err) {
        throw translateEngagementComponentError(err);
      }
      const record = (await this.selectOne(client, componentId))!;
      await this.audit.recordWith(client, ctx, {
        action: 'component.reconfigured',
        objectType: 'engagement_component',
        objectId: componentId,
        before: { status: current.status, applicabilityStatus: current.applicabilityStatus },
        after: { fields: sets.map((s) => s.split(' = ')[0]) },
      });
      return record;
    });
  }

  /** §24 — remove a component: soft-cancel so future generation stops and history survives. */
  async remove(
    ctx: RlsContext,
    engagementId: string,
    componentId: string,
    reason: string | undefined,
  ): Promise<EngagementComponentRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.selectOneForEngagement(client, engagementId, componentId);
      if (
        current.status === COMPONENT_CONFIG_STATUS.cancelled ||
        current.status === COMPONENT_CONFIG_STATUS.superseded
      ) {
        throw new BadRequestException('This component configuration is already removed.');
      }
      await client.query(
        `UPDATE hsdg.engagement_components
         SET status = 'cancelled', applicability_reason = COALESCE($3, applicability_reason),
             version = version + 1
         WHERE id = $1 AND engagement_id = $2`,
        [componentId, engagementId, reason ?? null],
      );
      const record = (await this.selectOne(client, componentId))!;
      await this.audit.recordWith(client, ctx, {
        action: 'component.removed',
        objectType: 'engagement_component',
        objectId: componentId,
        before: { status: current.status },
        after: { status: 'cancelled', reason: reason ?? null },
      });
      return record;
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async loadEngagement(
    client: PoolClient,
    engagementId: string,
  ): Promise<{ service_id: string; service_code: string; financial_year: string }> {
    const { rows } = await client.query<{
      service_id: string;
      service_code: string;
      financial_year: string;
    }>(
      `SELECT e.service_id, s.code AS service_code, e.financial_year
       FROM hsdg.engagements e JOIN hsdg.services s ON s.id = e.service_id
       WHERE e.id = $1`,
      [engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Engagement not found.');
    return rows[0];
  }

  private async resolveComponent(client: PoolClient, code: string): Promise<CatalogueRow> {
    const { rows } = await client.query<CatalogueRow>(
      `SELECT id, code, name, description, default_applicability, default_frequency,
              compliance_rule_id
       FROM hsdg.service_components WHERE code = $1 AND is_active = true`,
      [code],
    );
    if (!rows[0]) throw new BadRequestException(`Unknown or inactive component "${code}".`);
    return rows[0];
  }

  private async selectOne(
    client: PoolClient,
    id: string,
  ): Promise<EngagementComponentRecord | null> {
    const { rows } = await client.query<EngagementComponentRow>(`${EC_BASE} WHERE ec.id = $1`, [
      id,
    ]);
    return rows[0] ? mapEngagementComponent(rows[0]) : null;
  }

  private async selectOneForEngagement(
    client: PoolClient,
    engagementId: string,
    componentId: string,
  ): Promise<EngagementComponentRecord> {
    const { rows } = await client.query<EngagementComponentRow>(
      `${EC_BASE} WHERE ec.id = $1 AND ec.engagement_id = $2`,
      [componentId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Component configuration not found.');
    return mapEngagementComponent(rows[0]);
  }

  /**
   * Preview a component's deadline from the compliance rule that governs it,
   * using the version effective as of the engagement's FY end. Only bases that
   * are derivable without a per-instance date (fy_end, fixed_date) yield a
   * preview; period/month/event bases need an explicit date supplied later, so
   * they preview as null (spec §12 "preview where determinable").
   */
  private async previewDeadline(
    client: PoolClient,
    complianceRuleId: string,
    financialYear: string,
    holidays: ReadonlySet<string>,
  ): Promise<{
    statutoryDeadline: string | null;
    internalSlaDate: string | null;
    versionId: string;
  } | null> {
    // FY end (31 March of the FY's ending year) as the "as of" selector.
    const endYear = Number(financialYear.slice(0, 4)) + 1;
    const asOf = `${endYear}-03-31`;
    const { rows } = await client.query<{
      id: string;
      calculation_basis: CalculationBasis;
      offset_months: number;
      offset_days: number;
      fixed_month: number | null;
      fixed_day: number | null;
      working_day_adjustment: WorkingDayAdjustment;
      internal_sla_offset_days: number;
    }>(
      `SELECT id, calculation_basis, offset_months, offset_days, fixed_month, fixed_day,
              working_day_adjustment, internal_sla_offset_days
       FROM hsdg.compliance_rule_versions
       WHERE compliance_rule_id = $1 AND effective_from <= $2::date
         AND (effective_to IS NULL OR $2::date <= effective_to)
       ORDER BY effective_from DESC LIMIT 1`,
      [complianceRuleId, asOf],
    );
    const v = rows[0];
    if (!v) return null;
    // period/month/event bases need a per-instance date we don't have at
    // discovery time — surface the version but leave the dates unpreviewed.
    if (v.calculation_basis !== 'fy_end' && v.calculation_basis !== 'fixed_date') {
      return { statutoryDeadline: null, internalSlaDate: null, versionId: v.id };
    }
    const referenceDate = resolveReferenceDate(v.calculation_basis, {
      financialYear,
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

  private async loadHolidays(client: PoolClient): Promise<Set<string>> {
    const { rows } = await client.query<{ holiday_date: string }>(
      `SELECT holiday_date::text FROM hsdg.compliance_holidays`,
    );
    return new Set(rows.map((r) => r.holiday_date));
  }
}

// ── mapping & category helpers ───────────────────────────────────────────────

function mapEngagementComponent(row: EngagementComponentRow): EngagementComponentRecord {
  return {
    id: row.id,
    engagementId: row.engagement_id,
    serviceComponentId: row.service_component_id,
    componentCode: row.component_code,
    componentName: row.component_name,
    applicabilityStatus: row.applicability_status,
    applicabilityReason: row.applicability_reason,
    frequency: row.frequency,
    ownerEmployeeId: row.owner_employee_id,
    ownerName: row.owner_name,
    reviewerEmployeeId: row.reviewer_employee_id,
    reviewerName: row.reviewer_name,
    epReviewRequired: row.ep_review_required,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    notes: row.notes,
    complianceRuleVersionId: row.compliance_rule_version_id,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Catalogue default → discovery category (recommended surfaces as "applicable"). */
function defaultToCategory(d: ComponentApplicabilityDefault): ComponentDiscoveryCategory {
  if (d === COMPONENT_APPLICABILITY_DEFAULT.mandatory)
    return COMPONENT_DISCOVERY_CATEGORY.mandatory;
  if (d === COMPONENT_APPLICABILITY_DEFAULT.recommended)
    return COMPONENT_DISCOVERY_CATEGORY.applicable;
  return COMPONENT_DISCOVERY_CATEGORY.optional;
}

/** Catalogue default → the applicability_status a fresh configuration starts with. */
function defaultToStatus(d: ComponentApplicabilityDefault): ComponentApplicabilityStatus {
  if (d === COMPONENT_APPLICABILITY_DEFAULT.mandatory)
    return COMPONENT_APPLICABILITY_STATUS.mandatory;
  if (d === COMPONENT_APPLICABILITY_DEFAULT.recommended)
    return COMPONENT_APPLICABILITY_STATUS.applicable;
  return COMPONENT_APPLICABILITY_STATUS.optional;
}

/** Configured applicability_status → discovery category. */
function mapStatusToCategory(s: ComponentApplicabilityStatus): ComponentDiscoveryCategory {
  switch (s) {
    case COMPONENT_APPLICABILITY_STATUS.mandatory:
      return COMPONENT_DISCOVERY_CATEGORY.mandatory;
    case COMPONENT_APPLICABILITY_STATUS.applicable:
      return COMPONENT_DISCOVERY_CATEGORY.applicable;
    case COMPONENT_APPLICABILITY_STATUS.optional:
      return COMPONENT_DISCOVERY_CATEGORY.optional;
    case COMPONENT_APPLICABILITY_STATUS.pendingReview:
      return COMPONENT_DISCOVERY_CATEGORY.pendingReview;
    case COMPONENT_APPLICABILITY_STATUS.notApplicable:
      return COMPONENT_DISCOVERY_CATEGORY.notApplicable;
    default:
      return COMPONENT_DISCOVERY_CATEGORY.optional;
  }
}

function defaultReason(d: ComponentApplicabilityDefault): string {
  if (d === COMPONENT_APPLICABILITY_DEFAULT.mandatory)
    return 'Mandatory under this service — system must include.';
  if (d === COMPONENT_APPLICABILITY_DEFAULT.recommended)
    return 'Recommended by default — confirm applicability.';
  return 'Optional — include if within scope.';
}

/** Component-config PG errors: the live-unique index is the duplication guard (§16). */
export function translateEngagementComponentError(err: unknown): Error {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e?.code === '23505' && e.constraint === 'engagement_components_live_unique') {
    return new ConflictException(
      'This component is already configured on the engagement. Remove the existing configuration first, or amend it.',
    );
  }
  // Reuse the catalogue translator for the remaining shapes (FK, check, RLS).
  return translateComponentError(err);
}
