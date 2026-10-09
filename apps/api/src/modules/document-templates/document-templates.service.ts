import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  DEFAULT_TEMPLATE_VARIANT,
  TEMPLATE_CONTENT_TYPE,
  TEMPLATE_MERGE_FIELDS,
  selectTemplateVariant,
  templateDefinition,
  type CreateTemplateVariantInput,
  type DocumentTemplateKey,
  type DocumentTemplateRecord,
  type DocumentTemplateVersionRecord,
  type TemplateConditions,
  type TemplateSelectionFacts,
  type TemplateVersionStatus,
  type UploadTemplateVersionInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AppConfigService } from '../../config/config.module';
import { AuditService } from '../audit/audit.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../documents/storage/storage-provider';
import { decodeUpload } from '../documents/documents.upload';
import { scanDocxFields } from './docx-merge';
import { scanXlsxFields } from './xlsx-merge';

/** Every merge field the engine knows, keyed to its label (for `[label]` gaps). */
export const KNOWN_MERGE_FIELDS: ReadonlyMap<string, string> = new Map(
  TEMPLATE_MERGE_FIELDS.map((f) => [f.key, f.label]),
);

interface TemplateRow {
  id: string;
  template_key: DocumentTemplateKey;
  variant_key: string;
  title: string;
  applies_when: TemplateConditions;
  is_active: boolean;
  version: number;
}
interface VersionRow {
  id: string;
  template_id: string;
  version_no: number;
  filename: string;
  size_bytes: string;
  checksum_sha256: string;
  status: TemplateVersionStatus;
  notes: string | null;
  fields_found: string[];
  unknown_fields: string[];
  uploaded_by_name: string | null;
  uploaded_at: Date;
  approved_by_name: string | null;
  approved_at: Date | null;
}

const VERSION_SELECT = `
  SELECT v.id, v.template_id, v.version_no, v.filename, v.size_bytes, v.checksum_sha256,
         v.status, v.notes, v.fields_found, v.unknown_fields,
         ue.full_name AS uploaded_by_name, v.uploaded_at,
         ae.full_name AS approved_by_name, v.approved_at
    FROM hsdg.document_template_versions v
    LEFT JOIN hsdg.employees ue ON ue.id = v.uploaded_by_employee_id
    LEFT JOIN hsdg.employees ae ON ae.id = v.approved_by_employee_id`;

/** The approved template version chosen for an engagement, with its bytes. */
export interface ResolvedTemplate {
  templateKey: DocumentTemplateKey;
  variantKey: string;
  versionId: string;
  versionNo: number;
  bytes: Buffer;
}

/**
 * Firm document templates (Section 01 spec §2, §10.2): the approved DHVAJ Word
 * files that "Create from Template" merges engagement data into.
 *
 * Firm-wide configuration — read by everyone, managed by MP/admin (RLS
 * `ctx_is_firmwide`). Each template key carries variants chosen by the
 * engagement's facts; each variant keeps an append-only version history with at
 * most one approved version. The bytes sit behind the document StorageProvider.
 */
@Injectable()
export class DocumentTemplatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  // ── Admin ──────────────────────────────────────────────────────────────

  async list(ctx: RlsContext): Promise<DocumentTemplateRecord[]> {
    return this.db.withRlsContext(ctx, (client) => this.readAll(client));
  }

  async createVariant(
    ctx: RlsContext,
    input: CreateTemplateVariantInput,
  ): Promise<DocumentTemplateRecord> {
    const def = templateDefinition(input.templateKey);
    if (!def) throw new BadRequestException('Unknown template.');
    return this.db.withRlsContext(ctx, async (client) => {
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.document_templates
             (template_key, variant_key, title, applies_when, created_by_employee_id)
           VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
          [
            input.templateKey,
            input.variantKey,
            input.title?.trim() || `${def.title} (${input.variantKey.replace(/_/g, ' ')})`,
            JSON.stringify(input.appliesWhen ?? {}),
            ctx.employeeId ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException('That variant already exists for this template.');
        }
        throw err;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'document_template.variant_created',
        objectType: 'document_template',
        objectId: id,
        after: { templateKey: input.templateKey, variantKey: input.variantKey },
      });
      return (await this.readAll(client)).find((t) => t.id === id)!;
    });
  }

  async updateVariant(
    ctx: RlsContext,
    templateId: string,
    input: {
      title?: string;
      appliesWhen?: TemplateConditions;
      isActive?: boolean;
      version: number;
    },
  ): Promise<DocumentTemplateRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadTemplate(client, templateId);
      if (current.variant_key === DEFAULT_TEMPLATE_VARIANT && input.isActive === false) {
        throw new BadRequestException('The standard variant cannot be switched off.');
      }
      if (current.variant_key === DEFAULT_TEMPLATE_VARIANT && input.appliesWhen) {
        throw new BadRequestException('The standard variant always applies; it has no conditions.');
      }
      const res = await client.query(
        `UPDATE hsdg.document_templates
            SET title = COALESCE($3, title),
                applies_when = COALESCE($4::jsonb, applies_when),
                is_active = COALESCE($5, is_active),
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [
          templateId,
          input.version,
          input.title?.trim() || null,
          input.appliesWhen ? JSON.stringify(input.appliesWhen) : null,
          input.isActive ?? null,
        ],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This template changed since you loaded it; refresh and retry.',
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'document_template.variant_updated',
        objectType: 'document_template',
        objectId: templateId,
        after: { title: input.title, appliesWhen: input.appliesWhen, isActive: input.isActive },
      });
      return (await this.readAll(client)).find((t) => t.id === templateId)!;
    });
  }

  /**
   * Upload a new version (draft) — a Word .docx, or an Excel .xlsx for the
   * FS-workbook templates. Its merge fields are scanned and reported.
   */
  async uploadVersion(
    ctx: RlsContext,
    templateId: string,
    input: UploadTemplateVersionInput,
  ): Promise<DocumentTemplateRecord> {
    const templateKey = await this.db.withRlsContext(
      ctx,
      async (client) => (await this.loadTemplate(client, templateId)).template_key,
    );
    const format = templateDefinition(templateKey)?.format ?? 'docx';
    if (!new RegExp(`\\.${format}$`, 'i').test(input.filename)) {
      throw new BadRequestException(
        format === 'xlsx'
          ? 'Upload the template as an Excel (.xlsx) workbook.'
          : 'Upload the template as a Word (.docx) file.',
      );
    }
    const contentType = TEMPLATE_CONTENT_TYPE[format];
    const decoded = decodeUpload(input.contentBase64, this.config.get('DOCUMENT_MAX_BYTES'));
    let fields: string[];
    try {
      fields =
        format === 'xlsx'
          ? await scanXlsxFields(decoded.buffer)
          : await scanDocxFields(decoded.buffer);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const unknownFields = fields.filter((f) => !KNOWN_MERGE_FIELDS.has(f));
    const reference = this.storage.newReference('templates', templateId);
    await this.storage.write(reference, decoded.buffer, contentType);
    try {
      return await this.db.withRlsContext(ctx, async (client) => {
        await this.loadTemplate(client, templateId);
        const { rows } = await client.query<{ id: string; version_no: number }>(
          `INSERT INTO hsdg.document_template_versions
             (id, template_id, version_no, filename, content_type, size_bytes, checksum_sha256,
              storage_reference, notes, fields_found, unknown_fields, uploaded_by_employee_id)
           SELECT $1, $2, COALESCE(MAX(version_no), 0) + 1, $3, $4, $5, $6, $7, $8, $9, $10, $11
             FROM hsdg.document_template_versions WHERE template_id = $2
           RETURNING id, version_no`,
          [
            randomUUID(),
            templateId,
            input.filename,
            contentType,
            decoded.sizeBytes,
            decoded.checksumSha256,
            reference,
            input.notes?.trim() || null,
            fields.filter((f) => KNOWN_MERGE_FIELDS.has(f)),
            unknownFields,
            ctx.employeeId ?? null,
          ],
        );
        await this.audit.recordWith(client, ctx, {
          action: 'document_template.version_uploaded',
          objectType: 'document_template',
          objectId: templateId,
          after: { versionNo: rows[0]!.version_no, filename: input.filename, unknownFields },
        });
        return (await this.readAll(client)).find((t) => t.id === templateId)!;
      });
    } catch (err) {
      await this.storage.remove(reference).catch(() => undefined);
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('Another version was uploaded at the same time; retry.');
      }
      throw err;
    }
  }

  /** Approve a version: it becomes current; the previously approved one is superseded. */
  async approveVersion(
    ctx: RlsContext,
    templateId: string,
    versionId: string,
  ): Promise<DocumentTemplateRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ status: TemplateVersionStatus; version_no: number }>(
        `SELECT status, version_no FROM hsdg.document_template_versions
          WHERE id = $1 AND template_id = $2 FOR UPDATE`,
        [versionId, templateId],
      );
      const v = rows[0];
      if (!v) throw new NotFoundException('Template version not found.');
      if (v.status !== 'draft') {
        throw new BadRequestException(
          v.status === 'approved'
            ? 'This version is already the approved one.'
            : 'A superseded version cannot be approved again; upload it as a new version.',
        );
      }
      await client.query(
        `UPDATE hsdg.document_template_versions SET status = 'superseded'
          WHERE template_id = $1 AND status = 'approved'`,
        [templateId],
      );
      await client.query(
        `UPDATE hsdg.document_template_versions
            SET status = 'approved', approved_by_employee_id = $2, approved_at = now()
          WHERE id = $1`,
        [versionId, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'document_template.version_approved',
        objectType: 'document_template',
        objectId: templateId,
        after: { versionId, versionNo: v.version_no },
      });
      return (await this.readAll(client)).find((t) => t.id === templateId)!;
    });
  }

  /** The bytes of one template version (for the admin to check what was uploaded). */
  async downloadVersion(
    ctx: RlsContext,
    templateId: string,
    versionId: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const row = await this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        storage_reference: string;
        filename: string;
        content_type: string;
      }>(
        `SELECT storage_reference, filename, content_type FROM hsdg.document_template_versions
          WHERE id = $1 AND template_id = $2`,
        [versionId, templateId],
      );
      return rows[0];
    });
    if (!row) throw new NotFoundException('Template version not found.');
    return {
      buffer: await this.storage.read(row.storage_reference),
      filename: row.filename,
      contentType: row.content_type,
    };
  }

  // ── Firm settings ──────────────────────────────────────────────────────

  async readFirm(client: PoolClient): Promise<FirmSettings> {
    const { rows } = await client.query<{
      firm_name: string;
      frn: string | null;
      address: string | null;
      email: string | null;
      version: number;
    }>(`SELECT firm_name, frn, address, email, version FROM hsdg.firm_settings LIMIT 1`);
    const r = rows[0];
    return {
      firmName: r?.firm_name ?? 'DHVAJ & Associates',
      frn: r?.frn ?? null,
      address: r?.address ?? null,
      email: r?.email ?? null,
      version: r?.version ?? 1,
    };
  }

  async getFirm(ctx: RlsContext): Promise<FirmSettings> {
    return this.db.withRlsContext(ctx, (client) => this.readFirm(client));
  }

  async updateFirm(
    ctx: RlsContext,
    input: {
      firmName?: string;
      frn?: string | null;
      address?: string | null;
      email?: string | null;
      version: number;
    },
  ): Promise<FirmSettings> {
    return this.db.withRlsContext(ctx, async (client) => {
      const res = await client.query(
        `UPDATE hsdg.firm_settings
            SET firm_name = COALESCE(NULLIF(trim($2), ''), firm_name),
                frn = CASE WHEN $3::boolean THEN NULLIF(trim($4), '') ELSE frn END,
                address = CASE WHEN $5::boolean THEN NULLIF(trim($6), '') ELSE address END,
                email = CASE WHEN $7::boolean THEN NULLIF(trim($8), '') ELSE email END,
                version = version + 1,
                updated_by_employee_id = $9
          WHERE version = $1`,
        [
          input.version,
          input.firmName ?? null,
          input.frn !== undefined,
          input.frn ?? null,
          input.address !== undefined,
          input.address ?? null,
          input.email !== undefined,
          input.email ?? null,
          ctx.employeeId ?? null,
        ],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'Firm details changed since you loaded them; refresh and retry.',
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'firm_settings.updated',
        objectType: 'firm_settings',
        objectId: null,
        after: {
          firmName: input.firmName,
          frn: input.frn,
          address: input.address,
          email: input.email,
        },
      });
      return this.readFirm(client);
    });
  }

  // ── Used by Create from Template ────────────────────────────────────────

  /**
   * The applicable approved version of a template for an engagement's facts:
   * an explicit variant when asked, else the most specific matching active
   * variant that HAS an approved version. Null when none is approved.
   */
  async resolveOn(
    client: PoolClient,
    templateKey: DocumentTemplateKey,
    facts: TemplateSelectionFacts,
    variantKey?: string,
  ): Promise<{
    templateId: string;
    variantKey: string;
    versionId: string;
    versionNo: number;
    reference: string;
  } | null> {
    const { rows } = await client.query<{
      template_id: string;
      variant_key: string;
      applies_when: TemplateConditions;
      version_id: string;
      version_no: number;
      storage_reference: string;
    }>(
      `SELECT t.id AS template_id, t.variant_key, t.applies_when,
              v.id AS version_id, v.version_no, v.storage_reference
         FROM hsdg.document_templates t
         JOIN hsdg.document_template_versions v ON v.template_id = t.id AND v.status = 'approved'
        WHERE t.template_key = $1 AND t.is_active`,
      [templateKey],
    );
    const candidates = rows.map((r) => ({
      ...r,
      variantKey: r.variant_key,
      appliesWhen: r.applies_when ?? {},
    }));
    const chosen = variantKey
      ? (candidates.find((c) => c.variantKey === variantKey) ?? null)
      : selectTemplateVariant(candidates, facts);
    if (!chosen) return null;
    return {
      templateId: chosen.template_id,
      variantKey: chosen.variantKey,
      versionId: chosen.version_id,
      versionNo: chosen.version_no,
      reference: chosen.storage_reference,
    };
  }

  readBytes(reference: string): Promise<Buffer> {
    return this.storage.read(reference);
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async loadTemplate(client: PoolClient, templateId: string): Promise<TemplateRow> {
    const { rows } = await client.query<TemplateRow>(
      `SELECT id, template_key, variant_key, title, applies_when, is_active, version
         FROM hsdg.document_templates WHERE id = $1`,
      [templateId],
    );
    if (!rows[0]) throw new NotFoundException('Template not found.');
    return rows[0];
  }

  private async readAll(client: PoolClient): Promise<DocumentTemplateRecord[]> {
    const { rows: templates } = await client.query<TemplateRow>(
      `SELECT id, template_key, variant_key, title, applies_when, is_active, version
         FROM hsdg.document_templates
        ORDER BY template_key, (variant_key <> 'standard'), variant_key`,
    );
    const { rows: versions } = await client.query<VersionRow>(
      `${VERSION_SELECT} ORDER BY v.version_no DESC`,
    );
    return templates.map((t) => {
      const mine = versions.filter((v) => v.template_id === t.id).map(mapVersion);
      return {
        id: t.id,
        templateKey: t.template_key,
        variantKey: t.variant_key,
        title: t.title,
        appliesWhen: t.applies_when ?? {},
        isActive: t.is_active,
        currentVersion: mine.find((v) => v.status === 'approved') ?? null,
        versions: mine,
        version: t.version,
      };
    });
  }
}

export interface FirmSettings {
  firmName: string;
  frn: string | null;
  address: string | null;
  email: string | null;
  version: number;
}

function mapVersion(v: VersionRow): DocumentTemplateVersionRecord {
  return {
    id: v.id,
    templateId: v.template_id,
    versionNo: v.version_no,
    filename: v.filename,
    sizeBytes: Number(v.size_bytes),
    checksumSha256: v.checksum_sha256,
    status: v.status,
    notes: v.notes,
    fieldsFound: v.fields_found ?? [],
    unknownFields: v.unknown_fields ?? [],
    uploadedByName: v.uploaded_by_name,
    uploadedAt: v.uploaded_at.toISOString(),
    approvedByName: v.approved_by_name,
    approvedAt: v.approved_at ? v.approved_at.toISOString() : null,
  };
}
