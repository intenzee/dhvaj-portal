import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { AuditService } from '../audit/audit.service';
import type {
  CreateServiceInput,
  CreateServiceLineInput,
  ReviewModelRecord,
  ServiceDetail,
  ServiceFilter,
  ServiceLineRecord,
  ServiceSummary,
  UpdateServiceInput,
  UpdateServiceLineInput,
  WorkflowFamilyRecord,
  WorkflowStateRecord,
} from './catalogue.types';

const SERVICE_SELECT = `
  SELECT s.id, s.code, s.name, s.description, s.default_recurrence, s.is_active, s.version,
         s.service_line_id, sl.code AS line_code, sl.name AS line_name,
         s.required_review_model_id, rm.slug AS review_slug, rm.rank AS review_rank,
         s.workflow_family_id, wf.slug AS workflow_slug
  FROM hsdg.services s
  JOIN hsdg.service_lines sl ON sl.id = s.service_line_id
  JOIN hsdg.review_models rm ON rm.id = s.required_review_model_id
  JOIN hsdg.workflow_families wf ON wf.id = s.workflow_family_id`;

interface ServiceRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  default_recurrence: ServiceSummary['defaultRecurrence'];
  is_active: boolean;
  version: number;
  service_line_id: string;
  line_code: string;
  line_name: string;
  required_review_model_id: string;
  review_slug: string;
  review_rank: number;
  workflow_family_id: string;
  workflow_slug: string;
}

@Injectable()
export class CatalogueService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Reference reads ──────────────────────────────────────────────────────

  async listReviewModels(ctx: RlsContext): Promise<ReviewModelRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<ReviewModelRecord>(
        `SELECT id, slug, name, rank, description FROM hsdg.review_models ORDER BY rank`,
      );
      return rows;
    });
  }

  async listWorkflowFamilies(ctx: RlsContext): Promise<WorkflowFamilyRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const families = await client.query<{
        id: string;
        slug: string;
        name: string;
        description: string | null;
      }>(`SELECT id, slug, name, description FROM hsdg.workflow_families ORDER BY slug`);
      const states = await client.query<{
        workflow_family_id: string;
        id: string;
        slug: string;
        name: string;
        sequence: number;
        is_initial: boolean;
        is_terminal: boolean;
      }>(
        `SELECT workflow_family_id, id, slug, name, sequence, is_initial, is_terminal
         FROM hsdg.workflow_states ORDER BY workflow_family_id, sequence`,
      );
      return families.rows.map((f) => ({
        id: f.id,
        slug: f.slug,
        name: f.name,
        description: f.description,
        states: states.rows.filter((s) => s.workflow_family_id === f.id).map(mapWorkflowState),
      }));
    });
  }

  // ── Service lines ────────────────────────────────────────────────────────

  async listServiceLines(ctx: RlsContext): Promise<ServiceLineRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        code: string;
        name: string;
        description: string | null;
        display_order: number;
        is_active: boolean;
        version: number;
      }>(
        `SELECT id, code, name, description, display_order, is_active, version
         FROM hsdg.service_lines ORDER BY display_order, name`,
      );
      return rows.map(mapServiceLine);
    });
  }

  async createServiceLine(
    ctx: RlsContext,
    input: CreateServiceLineInput,
  ): Promise<ServiceLineRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.service_lines (code, name, description, display_order, is_active)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            input.code,
            input.name,
            input.description ?? null,
            input.displayOrder ?? 0,
            input.isActive ?? true,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translatePgError(err);
      }
      const created = await this.selectServiceLine(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'service_line.created',
        objectType: 'service_line',
        objectId: id,
        after: created,
      });
      return created!;
    });
  }

  async updateServiceLine(
    ctx: RlsContext,
    id: string,
    input: UpdateServiceLineInput,
  ): Promise<ServiceLineRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectServiceLine(client, id);
      if (!before) throw new NotFoundException('Service line not found.');

      const { sets, params } = buildSets({
        name: input.name,
        description: input.description,
        display_order: input.displayOrder,
        is_active: input.isActive,
      });
      if (sets.length === 0) return before;

      const after = await this.applyVersionedUpdate(
        client,
        'hsdg.service_lines',
        id,
        sets,
        params,
        input.version,
        () => this.selectServiceLine(client, id),
      );
      await this.audit.recordWith(client, ctx, {
        action: 'service_line.updated',
        objectType: 'service_line',
        objectId: id,
        before,
        after,
      });
      return after;
    });
  }

  // ── Services ─────────────────────────────────────────────────────────────

  async listServices(
    ctx: RlsContext,
    filter: ServiceFilter,
    page: PageParams,
  ): Promise<PageResult<ServiceSummary>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.serviceLineCode) {
      params.push(filter.serviceLineCode);
      conditions.push(`sl.code = $${params.length}`);
    }
    if (filter.active !== undefined) {
      params.push(filter.active);
      conditions.push(`s.is_active = $${params.length}`);
    }
    if (filter.search) {
      params.push(`%${filter.search}%`);
      conditions.push(`(s.name ILIKE $${params.length} OR s.code ILIKE $${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitParam = `$${params.length + 1}`;
    const offsetParam = `$${params.length + 2}`;
    params.push(page.limit, page.offset);

    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<ServiceRow & { total_count: string }>(
        `SELECT sub.*, count(*) OVER() AS total_count
         FROM (${SERVICE_SELECT} ${where}) sub
         ORDER BY sub.line_code, sub.name
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params,
      );
      return {
        items: rows.map(mapService),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }

  async getServiceById(ctx: RlsContext, id: string): Promise<ServiceDetail | null> {
    return this.db.withRlsContext(ctx, (client) => this.selectServiceDetail(client, id));
  }

  async createService(ctx: RlsContext, input: CreateServiceInput): Promise<ServiceDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const lineId = await this.resolveId(
        client,
        'hsdg.service_lines',
        'code',
        input.serviceLineCode,
        'service line',
      );
      const reviewId = await this.resolveId(
        client,
        'hsdg.review_models',
        'slug',
        input.requiredReviewModel,
        'review model',
      );
      const workflowId = await this.resolveId(
        client,
        'hsdg.workflow_families',
        'slug',
        input.workflowFamily,
        'workflow family',
      );

      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.services
             (service_line_id, code, name, description, required_review_model_id,
              workflow_family_id, default_recurrence, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            lineId,
            input.code,
            input.name,
            input.description ?? null,
            reviewId,
            workflowId,
            input.defaultRecurrence ?? 'annual',
            input.isActive ?? true,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translatePgError(err);
      }
      const created = await this.selectServiceDetail(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'service.created',
        objectType: 'service',
        objectId: id,
        after: created,
      });
      return created!;
    });
  }

  async updateService(
    ctx: RlsContext,
    id: string,
    input: UpdateServiceInput,
  ): Promise<ServiceDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectServiceDetail(client, id);
      if (!before) throw new NotFoundException('Service not found.');

      const fields: Record<string, unknown> = {
        name: input.name,
        description: input.description,
        default_recurrence: input.defaultRecurrence,
        is_active: input.isActive,
      };
      if (input.serviceLineCode !== undefined) {
        fields.service_line_id = await this.resolveId(
          client,
          'hsdg.service_lines',
          'code',
          input.serviceLineCode,
          'service line',
        );
      }
      if (input.requiredReviewModel !== undefined) {
        fields.required_review_model_id = await this.resolveId(
          client,
          'hsdg.review_models',
          'slug',
          input.requiredReviewModel,
          'review model',
        );
      }
      if (input.workflowFamily !== undefined) {
        fields.workflow_family_id = await this.resolveId(
          client,
          'hsdg.workflow_families',
          'slug',
          input.workflowFamily,
          'workflow family',
        );
      }

      const { sets, params } = buildSets(fields);
      if (sets.length === 0) return before;

      const after = await this.applyVersionedUpdate(
        client,
        'hsdg.services',
        id,
        sets,
        params,
        input.version,
        () => this.selectServiceDetail(client, id),
      );
      await this.audit.recordWith(client, ctx, {
        action: 'service.updated',
        objectType: 'service',
        objectId: id,
        before,
        after,
      });
      return after;
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Apply an update with `version = version + 1` and optional stale-version guard. */
  private async applyVersionedUpdate<T>(
    client: PoolClient,
    table: string,
    id: string,
    sets: string[],
    params: unknown[],
    expectedVersion: number | undefined,
    reselect: () => Promise<T | null>,
  ): Promise<T> {
    const withVersion = [...sets, 'version = version + 1'];
    const p = [...params, id];
    const idParam = `$${p.length}`;
    let versionClause = '';
    if (expectedVersion !== undefined) {
      p.push(expectedVersion);
      versionClause = ` AND version = $${p.length}`;
    }
    let updated: number;
    try {
      const result = await client.query(
        `UPDATE ${table} SET ${withVersion.join(', ')} WHERE id = ${idParam}${versionClause}`,
        p,
      );
      updated = result.rowCount ?? 0;
    } catch (err) {
      throw translatePgError(err);
    }
    if (updated === 0) {
      throw new ConflictException(
        'Record was modified by someone else. Refresh and retry (stale version).',
      );
    }
    return (await reselect())!;
  }

  private async resolveId(
    client: PoolClient,
    table: string,
    column: string,
    value: string,
    label: string,
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM ${table} WHERE ${column} = $1`,
      [value],
    );
    if (!rows[0]) throw new BadRequestException(`Unknown ${label} "${value}".`);
    return rows[0].id;
  }

  private async selectServiceLine(
    client: PoolClient,
    id: string,
  ): Promise<ServiceLineRecord | null> {
    const { rows } = await client.query<{
      id: string;
      code: string;
      name: string;
      description: string | null;
      display_order: number;
      is_active: boolean;
      version: number;
    }>(
      `SELECT id, code, name, description, display_order, is_active, version
       FROM hsdg.service_lines WHERE id = $1`,
      [id],
    );
    return rows[0] ? mapServiceLine(rows[0]) : null;
  }

  private async selectServiceDetail(client: PoolClient, id: string): Promise<ServiceDetail | null> {
    const { rows } = await client.query<ServiceRow>(`${SERVICE_SELECT} WHERE s.id = $1`, [id]);
    if (!rows[0]) return null;
    const states = await client.query<{
      id: string;
      slug: string;
      name: string;
      sequence: number;
      is_initial: boolean;
      is_terminal: boolean;
    }>(
      `SELECT id, slug, name, sequence, is_initial, is_terminal
       FROM hsdg.workflow_states WHERE workflow_family_id = $1 ORDER BY sequence`,
      [rows[0].workflow_family_id],
    );
    return { ...mapService(rows[0]), workflowStates: states.rows.map(mapWorkflowState) };
  }
}

function buildSets(fields: Record<string, unknown>): { sets: string[]; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [col, val] of Object.entries(fields)) {
    if (val !== undefined) {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    }
  }
  return { sets, params };
}

function mapWorkflowState(s: {
  id: string;
  slug: string;
  name: string;
  sequence: number;
  is_initial: boolean;
  is_terminal: boolean;
}): WorkflowStateRecord {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    sequence: s.sequence,
    isInitial: s.is_initial,
    isTerminal: s.is_terminal,
  };
}

function mapServiceLine(r: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  version: number;
}): ServiceLineRecord {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    displayOrder: r.display_order,
    isActive: r.is_active,
    version: r.version,
  };
}

function mapService(row: ServiceRow): ServiceSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    serviceLineId: row.service_line_id,
    serviceLineCode: row.line_code,
    serviceLineName: row.line_name,
    requiredReviewModelSlug: row.review_slug,
    requiredReviewModelRank: row.review_rank,
    workflowFamilyId: row.workflow_family_id,
    workflowFamilySlug: row.workflow_slug,
    defaultRecurrence: row.default_recurrence,
    isActive: row.is_active,
    version: row.version,
  };
}

/** Map PostgreSQL constraint/RLS violations to clean HTTP errors. */
export function translatePgError(err: unknown): Error {
  const e = err as { code?: string };
  if (e.code === '23505') return new ConflictException('A record with this code already exists.');
  if (e.code === '23503') return new BadRequestException('A referenced record does not exist.');
  if (e.code === '23514') return new BadRequestException('A value violates a constraint.');
  if (e.code === '42501') return new ForbiddenException('Not permitted to modify the catalogue.');
  return err as Error;
}
