import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { TemplateType } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { translatePgError } from './catalogue.service';
import type {
  AddTemplateVersionInput,
  CatalogueTemplateDetail,
  CatalogueTemplateRecord,
  CatalogueTemplateVersionRecord,
  CreateTemplateInput,
  TemplateFilter,
  TemplateItem,
} from './catalogue.types';

const TEMPLATE_SELECT = `
  SELECT t.id, t.template_type, t.code, t.name, t.description, t.is_active, t.version,
         t.created_at, t.updated_at
  FROM hsdg.catalogue_templates t`;

interface TemplateRow {
  id: string;
  template_type: TemplateType;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface VersionRow {
  id: string;
  version: number;
  effective_from: string;
  effective_to: string | null;
  body: { items?: TemplateItem[] } | null;
  notes: string | null;
  created_at: Date;
}

/**
 * Firm-wide CONFIG: reusable, versioned checklist / PBC / document-requirement
 * templates (§18/§25/§27). Reads are open to any authenticated context; writes
 * are RLS-gated to firm-wide (MP/admin). Versions are append-only (the migration
 * revokes UPDATE/DELETE), so a version a configuration already snapshotted can
 * never be silently rewritten.
 */
@Injectable()
export class CatalogueTemplatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async listTemplates(
    ctx: RlsContext,
    filter: TemplateFilter,
    page: PageParams,
  ): Promise<PageResult<CatalogueTemplateRecord>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.templateType) {
      params.push(filter.templateType);
      conditions.push(`t.template_type = $${params.length}`);
    }
    if (filter.active !== undefined) {
      params.push(filter.active);
      conditions.push(`t.is_active = $${params.length}`);
    }
    if (filter.search) {
      params.push(`%${filter.search}%`);
      conditions.push(`(t.name ILIKE $${params.length} OR t.code ILIKE $${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitParam = `$${params.length + 1}`;
    const offsetParam = `$${params.length + 2}`;
    params.push(page.limit, page.offset);

    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<TemplateRow & { total_count: string }>(
        `SELECT sub.*, count(*) OVER() AS total_count
         FROM (${TEMPLATE_SELECT} ${where}) sub
         ORDER BY sub.template_type, sub.code
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params,
      );
      return {
        items: rows.map(mapTemplate),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }

  async getTemplateById(ctx: RlsContext, id: string): Promise<CatalogueTemplateDetail | null> {
    return this.db.withRlsContext(ctx, (client) => this.selectTemplateDetail(client, id));
  }

  async createTemplate(
    ctx: RlsContext,
    input: CreateTemplateInput,
  ): Promise<CatalogueTemplateRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.catalogue_templates (template_type, code, name, description, is_active)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            input.templateType,
            input.code,
            input.name,
            input.description ?? null,
            input.isActive ?? true,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translatePgError(err);
      }
      const created = await this.selectTemplate(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'catalogue_template.created',
        objectType: 'catalogue_template',
        objectId: id,
        after: { code: input.code, templateType: input.templateType },
      });
      return created!;
    });
  }

  /**
   * Append a new effective-dated version. The version number auto-increments per
   * template; overlapping/duplicate effective_from is rejected by the unique
   * constraint (surfaced as a clean 409).
   */
  async addVersion(
    ctx: RlsContext,
    templateId: string,
    input: AddTemplateVersionInput,
  ): Promise<CatalogueTemplateVersionRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const template = await this.selectTemplate(client, templateId);
      if (!template) throw new NotFoundException('Template not found.');

      const items = normaliseItems(input.items ?? []);
      let versionId: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.catalogue_template_versions
             (catalogue_template_id, version, effective_from, effective_to, body, notes)
           VALUES (
             $1,
             COALESCE((SELECT max(version) FROM hsdg.catalogue_template_versions
                       WHERE catalogue_template_id = $1), 0) + 1,
             $2, $3, jsonb_build_object('items', $4::jsonb), $5)
           RETURNING id`,
          [
            templateId,
            input.effectiveFrom,
            input.effectiveTo ?? null,
            JSON.stringify(items),
            input.notes ?? null,
          ],
        );
        versionId = rows[0]!.id;
      } catch (err) {
        throw translatePgError(err);
      }
      const version = await this.selectVersion(client, versionId);
      await this.audit.recordWith(client, ctx, {
        action: 'catalogue_template.version_added',
        objectType: 'catalogue_template',
        objectId: templateId,
        after: { versionId, version: version!.version, effectiveFrom: version!.effectiveFrom },
      });
      return version!;
    });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async selectTemplate(
    client: PoolClient,
    id: string,
  ): Promise<CatalogueTemplateRecord | null> {
    const { rows } = await client.query<TemplateRow>(`${TEMPLATE_SELECT} WHERE t.id = $1`, [id]);
    return rows[0] ? mapTemplate(rows[0]) : null;
  }

  private async selectTemplateDetail(
    client: PoolClient,
    id: string,
  ): Promise<CatalogueTemplateDetail | null> {
    const template = await this.selectTemplate(client, id);
    if (!template) return null;
    const { rows } = await client.query<VersionRow>(
      `SELECT id, version, effective_from::text, effective_to::text, body, notes, created_at
       FROM hsdg.catalogue_template_versions
       WHERE catalogue_template_id = $1
       ORDER BY effective_from DESC, version DESC`,
      [id],
    );
    return { ...template, versions: rows.map(mapVersion) };
  }

  private async selectVersion(
    client: PoolClient,
    id: string,
  ): Promise<CatalogueTemplateVersionRecord | null> {
    const { rows } = await client.query<VersionRow>(
      `SELECT id, version, effective_from::text, effective_to::text, body, notes, created_at
       FROM hsdg.catalogue_template_versions WHERE id = $1`,
      [id],
    );
    return rows[0] ? mapVersion(rows[0]) : null;
  }
}

/** Trim/validate items and default sequence to declaration order when absent. */
function normaliseItems(items: TemplateItem[]): TemplateItem[] {
  return items.map((item, index) => {
    const label = (item.label ?? '').trim();
    if (!label) throw new BadRequestException('Every template item needs a non-empty label.');
    return {
      label,
      sequence: item.sequence ?? index + 1,
      ...(item.mandatory !== undefined ? { mandatory: item.mandatory } : {}),
      ...(item.description ? { description: item.description } : {}),
    };
  });
}

function mapTemplate(r: TemplateRow): CatalogueTemplateRecord {
  return {
    id: r.id,
    templateType: r.template_type,
    code: r.code,
    name: r.name,
    description: r.description,
    isActive: r.is_active,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapVersion(r: VersionRow): CatalogueTemplateVersionRecord {
  return {
    id: r.id,
    version: r.version,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    items: Array.isArray(r.body?.items) ? r.body!.items! : [],
    notes: r.notes,
    createdAt: r.created_at,
  };
}
