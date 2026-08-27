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
  type ComponentChecklistItem,
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
import {
  computeDeadlines,
  financialYearEndYear,
  resolveReferenceDate,
} from '../compliance/compliance-calc';
import type { ConfigureComponentInput, UpdateEngagementComponentInput } from './components.types';
import { translateComponentError } from './service-components.service';

interface EngagementComponentRow {
  id: string;
  engagement_id: string;
  engagement_service_id: string | null;
  service_name: string | null;
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
  superseded_by_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface CatalogueRow {
  id: string;
  service_id: string;
  code: string;
  name: string;
  description: string | null;
  default_applicability: ComponentApplicabilityDefault;
  default_frequency: Recurrence;
  compliance_rule_id: string | null;
  requires_registration: string[] | null;
  applies_to_categories: string[] | null;
}

/** The client facts §11 evaluates a component's applicability against. */
export interface EntityFacts {
  category: string;
  activeRegistrations: Set<string>;
}

interface RuleVersionRow {
  compliance_rule_id: string;
  id: string;
  calculation_basis: CalculationBasis;
  offset_months: number;
  offset_days: number;
  fixed_month: number | null;
  fixed_day: number | null;
  working_day_adjustment: WorkingDayAdjustment;
  internal_sla_offset_days: number;
}

interface DeadlinePreview {
  statutoryDeadline: string | null;
  internalSlaDate: string | null;
  versionId: string;
}

const EC_BASE = `
  SELECT ec.id, ec.engagement_id, ec.engagement_service_id, svc.name AS service_name,
         ec.service_component_id, sc.code AS component_code,
         sc.name AS component_name, sc.display_order AS component_display_order,
         ec.applicability_status, ec.applicability_reason, ec.frequency,
         ec.owner_employee_id, oe.full_name AS owner_name,
         ec.reviewer_employee_id, re.full_name AS reviewer_name,
         ec.ep_review_required, ec.status, ec.start_date::text, ec.end_date::text, ec.notes,
         ec.compliance_rule_version_id, ec.superseded_by_id, ec.version,
         ec.created_at, ec.updated_at
  FROM hsdg.engagement_components ec
  JOIN hsdg.service_components sc ON sc.id = ec.service_component_id
  LEFT JOIN hsdg.engagement_services es ON es.id = ec.engagement_service_id
  LEFT JOIN hsdg.services svc ON svc.id = es.service_id
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

  /** §11/§12 — categorise a service line's catalogue for this engagement. */
  async discover(
    ctx: RlsContext,
    engagementId: string,
    engagementServiceId?: string,
  ): Promise<ComponentDiscoveryResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const eng = await this.resolveServiceLine(client, engagementId, engagementServiceId);

      const { rows: catalogue } = await client.query<CatalogueRow>(
        `SELECT id, service_id, code, name, description, default_applicability, default_frequency,
                compliance_rule_id, requires_registration, applies_to_categories
         FROM hsdg.service_components
         WHERE service_id = $1 AND is_active = true
         ORDER BY display_order, code`,
        [eng.service_id],
      );

      // §11 — the client facts applicability is decided against (entity legal
      // category + the registrations it actively holds).
      const facts = await this.loadEntityFacts(client, engagementId);

      // Existing configurations on THIS service line, keyed by component.
      const { rows: existing } = await client.query<{
        id: string;
        service_component_id: string;
        status: ComponentConfigStatus;
        applicability_status: ComponentApplicabilityStatus;
      }>(
        `SELECT id, service_component_id, status, applicability_status
         FROM hsdg.engagement_components
         WHERE engagement_id = $1 AND engagement_service_id = $2`,
        [engagementId, eng.engagement_service_id],
      );
      // Prefer a live config; fall back to any historical one for display only.
      const liveByComponent = new Map<string, (typeof existing)[number]>();
      const anyByComponent = new Map<string, (typeof existing)[number]>();
      for (const row of existing) {
        anyByComponent.set(row.service_component_id, row);
        if (LIVE_STATUSES.includes(row.status)) liveByComponent.set(row.service_component_id, row);
      }

      // Batch the deadline preview: one query for the effective rule version of
      // every compliance-linked component, computed in JS (no per-component query).
      const ruleIds = [
        ...new Set(
          catalogue.map((c) => c.compliance_rule_id).filter((x): x is string => x !== null),
        ),
      ];
      const previews =
        ruleIds.length > 0
          ? await this.loadPreviews(client, ruleIds, eng.financial_year)
          : new Map<string, DeadlinePreview>();

      const rows: ComponentDiscoveryRow[] = catalogue.map((c) => {
        const live = liveByComponent.get(c.id);
        const historical = anyByComponent.get(c.id);
        const preview = c.compliance_rule_id ? (previews.get(c.compliance_rule_id) ?? null) : null;
        // A live config wins; otherwise §11 fact evaluation decides.
        const fact = live ? null : evaluateApplicability(c, facts);
        const category = live ? mapStatusToCategory(live.applicability_status) : fact!.category;
        const reason = live ? `Configured on this engagement (${live.status}).` : fact!.reason;
        return {
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
        };
      });

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
        engagementServiceId: eng.engagement_service_id,
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
      await this.assertEngagementVisible(client, engagementId); // 404 if not a member
      const params: unknown[] = [engagementId];
      let statusClause = '';
      if (filter.status) {
        params.push(filter.status);
        statusClause = `AND ec.status = $${params.length}`;
      }
      // Single query: count(*) OVER() carries the full filtered total alongside
      // the page (computed before LIMIT).
      params.push(page.limit, page.offset);
      const { rows } = await client.query<EngagementComponentRow & { total_count: string }>(
        `SELECT c.*, count(*) OVER() AS total_count
         FROM (${EC_BASE} WHERE ec.engagement_id = $1 ${statusClause}) c
         ORDER BY c.component_display_order, c.component_code
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        items: rows.map(mapEngagementComponent),
        total: rows[0] ? Number(rows[0].total_count) : 0,
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
      const line = await this.resolveServiceLine(client, engagementId, input.engagementServiceId);
      const component = await this.resolveComponent(client, input.serviceComponentCode);
      if (component.service_id !== line.service_id) {
        throw new BadRequestException(
          `Component "${component.code}" does not belong to the selected service.`,
        );
      }

      const applicabilityStatus =
        input.applicabilityStatus ?? defaultToStatus(component.default_applicability);
      const frequency = input.frequency ?? component.default_frequency;

      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.engagement_components
             (engagement_id, engagement_service_id, service_component_id, applicability_status,
              applicability_reason, frequency, owner_employee_id, reviewer_employee_id,
              ep_review_required, status, start_date, end_date, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,false),COALESCE($10,'draft'),$11,$12,$13)
           RETURNING id`,
          [
            engagementId,
            line.engagement_service_id,
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
      // §13/§17 — materialise the component's default checklist (if any) from
      // the catalogue template, so the team starts with the standard steps.
      await client.query(
        `INSERT INTO hsdg.engagement_component_checklist (engagement_component_id, label, sequence)
         SELECT $1, t.label, t.ord
         FROM hsdg.service_components sc,
              unnest(sc.checklist_template) WITH ORDINALITY AS t(label, ord)
         WHERE sc.id = $2 AND sc.checklist_template IS NOT NULL`,
        [id, component.id],
      );
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

      params.push(componentId);
      const idIdx = params.length;
      params.push(engagementId);
      const engIdx = params.length;
      // Close the read-then-write race: when the caller supplied a version, guard
      // the UPDATE on the row we read, so a concurrent edit in between yields
      // rowCount 0 (a lost update) rather than silently overwriting.
      let versionGuard = '';
      if (input.version !== undefined) {
        params.push(current.version);
        versionGuard = ` AND version = $${params.length}`;
      }
      let updated: number;
      try {
        const result = await client.query(
          `UPDATE hsdg.engagement_components
           SET ${sets.join(', ')}, version = version + 1
           WHERE id = $${idIdx} AND engagement_id = $${engIdx}${versionGuard}`,
          params,
        );
        updated = result.rowCount ?? 0;
      } catch (err) {
        throw translateEngagementComponentError(err);
      }
      if (updated === 0 && input.version !== undefined) {
        throw new ConflictException('Configuration was modified concurrently — reload and retry.');
      }
      // If this edit removed the component (status → cancelled/superseded) or
      // marked it not applicable, stop its pending work too — same as remove().
      if (
        (input.status === COMPONENT_CONFIG_STATUS.cancelled ||
          input.status === COMPONENT_CONFIG_STATUS.superseded ||
          input.applicabilityStatus === COMPONENT_APPLICABILITY_STATUS.notApplicable) &&
        current.status !== input.status
      ) {
        await this.closePendingInstances(client, componentId, 'cancelled');
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
      // Removing scope also stops its pending work: cancel this component's
      // scheduled/active instances (completed/waived work is preserved, §25).
      const cancelledWork = await this.closePendingInstances(client, componentId, 'cancelled');
      const record = (await this.selectOne(client, componentId))!;
      await this.audit.recordWith(client, ctx, {
        action: 'component.removed',
        objectType: 'engagement_component',
        objectId: componentId,
        before: { status: current.status },
        after: { status: 'cancelled', reason: reason ?? null, cancelledWork },
      });
      return record;
    });
  }

  /**
   * §23/§24 — change a component's frequency. Once work exists this is a
   * controlled configuration CHANGE, not an in-place edit: the current
   * configuration is SUPERSEDED and a new version (same setup, new frequency)
   * takes over. The old frequency's pending work is marked 'superseded' (its
   * completed/waived work is preserved as history); the caller then generates
   * the new frequency's work against the returned new version. If no work exists
   * yet, the frequency is simply updated in place (no version churn).
   */
  async changeFrequency(
    ctx: RlsContext,
    engagementId: string,
    componentId: string,
    newFrequency: Recurrence,
  ): Promise<EngagementComponentRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.selectOneForEngagement(client, engagementId, componentId);
      if (
        current.status === COMPONENT_CONFIG_STATUS.cancelled ||
        current.status === COMPONENT_CONFIG_STATUS.superseded
      ) {
        throw new BadRequestException('This component configuration is no longer live.');
      }
      if (current.frequency === newFrequency) {
        throw new BadRequestException('The component already has that frequency.');
      }

      // Any real work (not cancelled/superseded) means we version rather than
      // edit in place — so the old frequency's history is preserved.
      const { rows: workRows } = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM hsdg.component_instances
         WHERE engagement_component_id = $1 AND status NOT IN ('cancelled','superseded')`,
        [componentId],
      );
      const hasWork = Number(workRows[0]?.n ?? 0) > 0;

      if (!hasWork) {
        await client.query(
          `UPDATE hsdg.engagement_components SET frequency = $2, version = version + 1
           WHERE id = $1`,
          [componentId, newFrequency],
        );
        const updated = (await this.selectOne(client, componentId))!;
        await this.audit.recordWith(client, ctx, {
          action: 'component.frequency_changed',
          objectType: 'engagement_component',
          objectId: componentId,
          before: { frequency: current.frequency },
          after: { frequency: newFrequency, superseded: false },
        });
        return updated;
      }

      // Supersede: free the live-unique slot first (old → superseded), then
      // insert the new version, then link old → new and mark old pending work.
      await client.query(
        `UPDATE hsdg.engagement_components
         SET status = 'superseded', superseded_at = now(), version = version + 1
         WHERE id = $1`,
        [componentId],
      );
      let newId: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.engagement_components
             (engagement_id, service_component_id, applicability_status, applicability_reason,
              frequency, owner_employee_id, reviewer_employee_id, ep_review_required, status,
              start_date, end_date, notes)
           SELECT engagement_id, service_component_id, applicability_status, applicability_reason,
                  $2, owner_employee_id, reviewer_employee_id, ep_review_required, $3,
                  start_date, end_date, notes
           FROM hsdg.engagement_components WHERE id = $1
           RETURNING id`,
          // Carry the original live status onto the new version (not 'superseded').
          [componentId, newFrequency, current.status],
        );
        newId = rows[0]!.id;
      } catch (err) {
        throw translateEngagementComponentError(err);
      }
      await client.query(
        `UPDATE hsdg.engagement_components SET superseded_by_id = $2 WHERE id = $1`,
        [componentId, newId],
      );
      const supersededWork = await this.closePendingInstances(client, componentId, 'superseded');

      const newRecord = (await this.selectOne(client, newId))!;
      await this.audit.recordWith(client, ctx, {
        action: 'component.frequency_superseded',
        objectType: 'engagement_component',
        objectId: componentId,
        before: { frequency: current.frequency, status: current.status },
        after: { frequency: newFrequency, supersededByComponentId: newId, supersededWork },
      });
      return newRecord;
    });
  }

  // ── Checklist (spec §13/§17) ─────────────────────────────────────────────

  /** List a component's checklist items (ordered). */
  async listChecklist(
    ctx: RlsContext,
    engagementId: string,
    componentId: string,
  ): Promise<ComponentChecklistItem[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertComponentInEngagement(client, engagementId, componentId);
      return this.selectChecklist(client, componentId);
    });
  }

  /** Add a custom checklist item (leads only, via RLS). */
  async addChecklistItem(
    ctx: RlsContext,
    engagementId: string,
    componentId: string,
    label: string,
  ): Promise<ComponentChecklistItem[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertComponentInEngagement(client, engagementId, componentId);
      try {
        await client.query(
          `INSERT INTO hsdg.engagement_component_checklist (engagement_component_id, label, sequence)
           VALUES ($1, $2,
             COALESCE((SELECT max(sequence) + 1 FROM hsdg.engagement_component_checklist
                        WHERE engagement_component_id = $1), 0))`,
          [componentId, label],
        );
      } catch (err) {
        throw translateEngagementComponentError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'component.checklist_item_added',
        objectType: 'engagement_component',
        objectId: componentId,
        after: { engagementId, label },
      });
      return this.selectChecklist(client, componentId);
    });
  }

  /** Toggle done or rename a checklist item (any member may tick; via RLS). */
  async setChecklistItem(
    ctx: RlsContext,
    engagementId: string,
    componentId: string,
    itemId: string,
    patch: { isDone?: boolean; label?: string },
  ): Promise<ComponentChecklistItem[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertComponentInEngagement(client, engagementId, componentId);
      const sets: string[] = [];
      const params: unknown[] = [];
      if (patch.isDone !== undefined) {
        params.push(patch.isDone);
        sets.push(`is_done = $${params.length}`);
      }
      if (patch.label !== undefined) {
        params.push(patch.label);
        sets.push(`label = $${params.length}`);
      }
      if (sets.length === 0) return this.selectChecklist(client, componentId);
      params.push(itemId, componentId);
      const result = await client.query(
        `UPDATE hsdg.engagement_component_checklist SET ${sets.join(', ')}
          WHERE id = $${params.length - 1} AND engagement_component_id = $${params.length}`,
        params,
      );
      if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Checklist item not found.');
      return this.selectChecklist(client, componentId);
    });
  }

  /** Remove a checklist item (leads only, via RLS). */
  async removeChecklistItem(
    ctx: RlsContext,
    engagementId: string,
    componentId: string,
    itemId: string,
  ): Promise<ComponentChecklistItem[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertComponentInEngagement(client, engagementId, componentId);
      const result = await client.query(
        `DELETE FROM hsdg.engagement_component_checklist
          WHERE id = $1 AND engagement_component_id = $2`,
        [itemId, componentId],
      );
      if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Checklist item not found.');
      return this.selectChecklist(client, componentId);
    });
  }

  private async assertComponentInEngagement(
    client: PoolClient,
    engagementId: string,
    componentId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.engagement_components WHERE id = $1 AND engagement_id = $2`,
      [componentId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Component not found on this engagement.');
  }

  private async selectChecklist(
    client: PoolClient,
    componentId: string,
  ): Promise<ComponentChecklistItem[]> {
    const { rows } = await client.query<{
      id: string;
      label: string;
      sequence: number;
      is_done: boolean;
      done_by_employee_id: string | null;
      done_by_name: string | null;
      done_at: Date | null;
    }>(
      `SELECT cl.id, cl.label, cl.sequence, cl.is_done,
              cl.done_by_employee_id, e.full_name AS done_by_name, cl.done_at
       FROM hsdg.engagement_component_checklist cl
       LEFT JOIN hsdg.employees e ON e.id = cl.done_by_employee_id
       WHERE cl.engagement_component_id = $1
       ORDER BY cl.sequence, cl.created_at`,
      [componentId],
    );
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      sequence: r.sequence,
      isDone: r.is_done,
      doneByEmployeeId: r.done_by_employee_id,
      doneByName: r.done_by_name,
      doneAt: r.done_at ? r.done_at.toISOString() : null,
    }));
  }

  // ── internals ──────────────────────────────────────────────────────────

  /**
   * Close out a component's not-yet-finalised work instances (scheduled/active)
   * to `toStatus` — 'cancelled' when scope is removed, 'superseded' when a new
   * configuration version replaces it. Completed/waived instances are left
   * untouched (filed work is history, §25). Returns the count changed.
   */
  private async closePendingInstances(
    client: PoolClient,
    engagementComponentId: string,
    toStatus: 'cancelled' | 'superseded',
  ): Promise<number> {
    const result = await client.query(
      `UPDATE hsdg.component_instances SET status = $2, version = version + 1
       WHERE engagement_component_id = $1 AND status IN ('scheduled','active')`,
      [engagementComponentId, toStatus],
    );
    return result.rowCount ?? 0;
  }

  /** 404 if the engagement is not visible to the caller (RLS). */
  private async assertEngagementVisible(client: PoolClient, engagementId: string): Promise<void> {
    const { rows } = await client.query(`SELECT 1 FROM hsdg.engagements WHERE id = $1`, [
      engagementId,
    ]);
    if (!rows[0]) throw new NotFoundException('Engagement not found.');
  }

  /**
   * Resolve the target service line (multi-service, §9–§10). With an explicit
   * engagementServiceId, that live line is used; otherwise the primary line —
   * so single-service callers behave exactly as before.
   */
  private async resolveServiceLine(
    client: PoolClient,
    engagementId: string,
    engagementServiceId?: string,
  ): Promise<{
    engagement_service_id: string;
    service_id: string;
    service_code: string;
    financial_year: string;
  }> {
    const base = `SELECT es.id AS engagement_service_id, es.service_id,
                         s.code AS service_code, es.financial_year
                  FROM hsdg.engagement_services es
                  JOIN hsdg.services s ON s.id = es.service_id
                  WHERE es.engagement_id = $1`;
    const { rows } = engagementServiceId
      ? await client.query(`${base} AND es.id = $2 AND es.status <> 'cancelled'`, [
          engagementId,
          engagementServiceId,
        ])
      : await client.query(`${base} AND es.is_primary`, [engagementId]);
    if (!rows[0]) {
      throw new NotFoundException(
        engagementServiceId
          ? 'Service line not found on this engagement.'
          : 'Engagement not found.',
      );
    }
    return rows[0] as {
      engagement_service_id: string;
      service_id: string;
      service_code: string;
      financial_year: string;
    };
  }

  /** §11 — the entity's legal category and the registrations it actively holds. */
  private async loadEntityFacts(client: PoolClient, engagementId: string): Promise<EntityFacts> {
    const cat = await client.query<{ category: string }>(
      `SELECT et.category
         FROM hsdg.engagements e
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
        WHERE e.id = $1`,
      [engagementId],
    );
    const regs = await client.query<{ registration_type: string }>(
      `SELECT DISTINCT r.registration_type
         FROM hsdg.entity_registrations r
         JOIN hsdg.engagements e ON e.entity_id = r.entity_id
        WHERE e.id = $1 AND r.status = 'active'`,
      [engagementId],
    );
    return {
      category: cat.rows[0]?.category ?? 'other',
      activeRegistrations: new Set(regs.rows.map((r) => r.registration_type)),
    };
  }

  private async resolveComponent(client: PoolClient, code: string): Promise<CatalogueRow> {
    const { rows } = await client.query<CatalogueRow>(
      `SELECT id, service_id, code, name, description, default_applicability, default_frequency,
              compliance_rule_id, requires_registration, applies_to_categories
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
   * Preview deadlines for many rules at once: one query selects the version
   * effective as of the engagement's FY end for each rule, then dates are
   * computed in JS. Only bases derivable without a per-instance date (fy_end,
   * fixed_date) yield dates; period/month/event bases surface the version but
   * leave the dates unpreviewed (spec §12 "preview where determinable").
   */
  private async loadPreviews(
    client: PoolClient,
    ruleIds: string[],
    financialYear: string,
  ): Promise<Map<string, DeadlinePreview>> {
    const asOf = `${financialYearEndYear(financialYear)}-03-31`; // 31 March of the FY's ending year
    const { rows } = await client.query<RuleVersionRow>(
      `SELECT DISTINCT ON (compliance_rule_id)
              compliance_rule_id, id, calculation_basis, offset_months, offset_days,
              fixed_month, fixed_day, working_day_adjustment, internal_sla_offset_days
       FROM hsdg.compliance_rule_versions
       WHERE compliance_rule_id = ANY($1::uuid[])
         AND effective_from <= $2::date AND (effective_to IS NULL OR $2::date <= effective_to)
       ORDER BY compliance_rule_id, effective_from DESC`,
      [ruleIds, asOf],
    );
    if (rows.length === 0) return new Map();
    const holidays = await this.loadHolidays(client);
    const map = new Map<string, DeadlinePreview>();
    for (const v of rows) map.set(v.compliance_rule_id, computePreview(v, financialYear, holidays));
    return map;
  }

  private async loadHolidays(client: PoolClient): Promise<Set<string>> {
    const { rows } = await client.query<{ holiday_date: string }>(
      `SELECT holiday_date::text FROM hsdg.compliance_holidays`,
    );
    return new Set(rows.map((r) => r.holiday_date));
  }
}

// ── mapping & category helpers ───────────────────────────────────────────────

/** Compute a deadline preview from an effective rule version (pure). */
function computePreview(
  v: RuleVersionRow,
  financialYear: string,
  holidays: ReadonlySet<string>,
): DeadlinePreview {
  // period/month/event bases need a per-instance date we don't have at discovery
  // time — surface the version but leave the dates unpreviewed.
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

function mapEngagementComponent(row: EngagementComponentRow): EngagementComponentRecord {
  return {
    id: row.id,
    engagementId: row.engagement_id,
    engagementServiceId: row.engagement_service_id,
    serviceName: row.service_name,
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
    supersededById: row.superseded_by_id,
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

/** Human labels for the registration types §11 gates on. */
const REGISTRATION_LABEL: Record<string, string> = {
  gstin: 'GST',
  tan: 'TAN (TDS)',
  cin: 'CIN',
  llpin: 'LLPIN',
  iec: 'IEC',
  pt: 'Professional Tax',
  esic: 'ESIC',
  pf: 'PF',
  other: 'registration',
};

/**
 * §11 — decide a component's applicability from CLIENT FACTS rather than the
 * static catalogue default. A registration or category rule that the client
 * fails makes the component `not_applicable` with a plain-English reason; a rule
 * the client satisfies keeps the catalogue default and explains why; a component
 * with no rule falls back to the default behaviour.
 */
export function evaluateApplicability(
  c: CatalogueRow,
  facts: EntityFacts,
): { category: ComponentDiscoveryCategory; reason: string } {
  const needsReg = c.requires_registration ?? [];
  const needsCat = c.applies_to_categories ?? [];

  if (needsReg.length > 0 && !needsReg.some((r) => facts.activeRegistrations.has(r))) {
    const labels = needsReg.map((r) => REGISTRATION_LABEL[r] ?? r).join(' or ');
    return {
      category: COMPONENT_DISCOVERY_CATEGORY.notApplicable,
      reason: `Not applicable — client holds no active ${labels} registration.`,
    };
  }
  if (needsCat.length > 0 && !needsCat.includes(facts.category)) {
    return {
      category: COMPONENT_DISCOVERY_CATEGORY.notApplicable,
      reason: `Not applicable — applies to ${needsCat.join(' / ')} entities only (this client is ${facts.category}).`,
    };
  }

  const category = defaultToCategory(c.default_applicability);
  const parts: string[] = [];
  if (needsReg.length > 0) {
    const matched = needsReg
      .filter((r) => facts.activeRegistrations.has(r))
      .map((r) => REGISTRATION_LABEL[r] ?? r);
    parts.push(`client holds an active ${matched.join(' / ')} registration`);
  }
  if (needsCat.length > 0) parts.push(`client is a ${facts.category} entity`);
  if (parts.length > 0) {
    return { category, reason: `Applicable — ${parts.join('; ')}.` };
  }
  return { category, reason: defaultReason(c.default_applicability) };
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
