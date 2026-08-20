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
  DOCUMENT_STATUS,
  type DocumentClassification,
  type DocumentSensitivity,
  type DocumentStatus,
  type DocumentType,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { translatePgError } from '../../common/errors/pg-error.util';
import { AppConfigService } from '../../config/config.module';
import { AuditService } from '../audit/audit.service';
import { STORAGE_PROVIDER, type StorageProvider } from './storage/storage-provider';
import { decodeUpload } from './documents.upload';
import type {
  AddVersionInput,
  ArchiveDocumentInput,
  CreateDocumentInput,
  DocumentDetail,
  DocumentDownload,
  DocumentRecord,
  DocumentVersionRecord,
  UpdateDocumentInput,
} from './documents.types';

interface DocumentRow {
  id: string;
  engagement_id: string;
  title: string;
  document_type: DocumentType;
  classification: DocumentClassification;
  sensitivity: DocumentSensitivity;
  status: DocumentStatus;
  current_version_no: number;
  current_filename: string | null;
  current_content_type: string | null;
  current_size_bytes: string | null;
  retention_until: string | null;
  archived_at: Date | null;
  archived_by_employee_id: string | null;
  created_by_employee_id: string | null;
  created_by_name: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface VersionRow {
  id: string;
  document_id: string;
  version_no: number;
  filename: string;
  content_type: string;
  size_bytes: string;
  checksum_sha256: string;
  note: string | null;
  uploaded_by_employee_id: string | null;
  uploaded_by_name: string | null;
  uploaded_at: Date;
}

const DOC_BASE = `
  SELECT d.id, d.engagement_id, d.title, d.document_type, d.classification, d.sensitivity,
         d.status, d.current_version_no,
         cv.filename AS current_filename, cv.content_type AS current_content_type,
         cv.size_bytes AS current_size_bytes,
         d.retention_until::text, d.archived_at, d.archived_by_employee_id,
         d.created_by_employee_id, ce.full_name AS created_by_name,
         d.version, d.created_at, d.updated_at
  FROM hsdg.documents d
  LEFT JOIN hsdg.document_versions cv ON cv.id = d.current_version_id
  LEFT JOIN hsdg.employees ce ON ce.id = d.created_by_employee_id`;

const VERSION_BASE = `
  SELECT v.id, v.document_id, v.version_no, v.filename, v.content_type, v.size_bytes,
         v.checksum_sha256, v.note, v.uploaded_by_employee_id,
         ue.full_name AS uploaded_by_name, v.uploaded_at
  FROM hsdg.document_versions v
  LEFT JOIN hsdg.employees ue ON ue.id = v.uploaded_by_employee_id`;

/**
 * Documents (Phase 10). Engagement-scoped professional evidence: metadata +
 * versioned bytes. Members read/download; leads upload, re-version, re-classify,
 * archive and restore. The bytes live behind a {@link StorageProvider}; the
 * database never stores a file, only an opaque reference obtainable solely
 * through an RLS-passing read — so a document id can never be turned into a
 * direct fetch. Every download is audited, and version rows are append-only, so
 * completed/signed-off evidence is never silently replaced (§12).
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async create(
    ctx: RlsContext,
    engagementId: string,
    input: CreateDocumentInput,
  ): Promise<DocumentRecord> {
    const decoded = decodeUpload(input.contentBase64, this.config.get('DOCUMENT_MAX_BYTES'));
    const documentId = randomUUID();
    const reference = this.storage.newReference(engagementId, documentId);
    const contentType = input.contentType ?? 'application/octet-stream';

    // Write the blob first, then commit metadata atomically. If the metadata
    // transaction fails (e.g. RLS denies a non-lead), compensate the orphan.
    await this.storage.write(reference, decoded.buffer, contentType);
    try {
      return await this.db.withRlsContext(ctx, async (client) => {
        await this.requireEngagement(client, engagementId);
        try {
          await client.query(
            `INSERT INTO hsdg.documents
               (id, engagement_id, title, document_type, classification, sensitivity,
                retention_until, created_by_employee_id)
             VALUES ($1,$2,$3,COALESCE($4,'other'),COALESCE($5,'internal'),COALESCE($6,'normal'),$7,$8)`,
            [
              documentId,
              engagementId,
              input.title,
              input.documentType ?? null,
              input.classification ?? null,
              input.sensitivity ?? null,
              input.retentionUntil ?? null,
              ctx.employeeId ?? null,
            ],
          );
          const versionId = await this.insertVersion(client, {
            documentId,
            engagementId,
            versionNo: 1,
            filename: input.filename,
            contentType,
            decoded,
            reference,
            note: null,
            uploadedBy: ctx.employeeId ?? null,
          });
          await client.query(
            `UPDATE hsdg.documents SET current_version_id = $1, current_version_no = 1 WHERE id = $2`,
            [versionId, documentId],
          );
        } catch (err) {
          throw mapDocumentError(err);
        }
        const record = await this.selectDocument(client, documentId, engagementId);
        await this.audit.recordWith(client, ctx, {
          action: 'document.created',
          objectType: 'document',
          objectId: documentId,
          after: { engagementId, title: input.title, filename: input.filename },
        });
        return record!;
      });
    } catch (err) {
      await this.storage.remove(reference).catch(() => undefined);
      throw err;
    }
  }

  async addVersion(
    ctx: RlsContext,
    engagementId: string,
    documentId: string,
    input: AddVersionInput,
  ): Promise<DocumentDetail> {
    const decoded = decodeUpload(input.contentBase64, this.config.get('DOCUMENT_MAX_BYTES'));
    const reference = this.storage.newReference(engagementId, documentId);
    const contentType = input.contentType ?? 'application/octet-stream';

    await this.storage.write(reference, decoded.buffer, contentType);
    try {
      return await this.db.withRlsContext(ctx, async (client) => {
        const existing = await this.selectDocument(client, documentId, engagementId);
        if (!existing) throw new NotFoundException('Document not found.');
        let versionId: string;
        try {
          const next = existing.currentVersionNo + 1;
          versionId = await this.insertVersion(client, {
            documentId,
            engagementId,
            versionNo: next,
            filename: input.filename,
            contentType,
            decoded,
            reference,
            note: input.note ?? null,
            uploadedBy: ctx.employeeId ?? null,
          });
          // Advancing the pointer is lead-only via RLS; bump the doc version too.
          const res = await client.query(
            `UPDATE hsdg.documents
               SET current_version_id = $1, current_version_no = $2, version = version + 1
             WHERE id = $3 AND engagement_id = $4`,
            [versionId, next, documentId, engagementId],
          );
          if ((res.rowCount ?? 0) === 0) throw new NotFoundException('Document not found.');
        } catch (err) {
          throw mapDocumentError(err);
        }
        const detail = await this.selectDetail(client, documentId, engagementId);
        await this.audit.recordWith(client, ctx, {
          action: 'document.version_added',
          objectType: 'document',
          objectId: documentId,
          after: { engagementId, versionNo: detail!.currentVersionNo, filename: input.filename },
        });
        return detail!;
      });
    } catch (err) {
      await this.storage.remove(reference).catch(() => undefined);
      throw err;
    }
  }

  async list(
    ctx: RlsContext,
    engagementId: string,
    page: PageParams,
    filter: {
      status?: DocumentStatus;
      documentType?: DocumentType;
      classification?: DocumentClassification;
      search?: string;
    },
  ): Promise<PageResult<DocumentRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.requireEngagement(client, engagementId);
      const params: unknown[] = [engagementId];
      const conds = ['d.engagement_id = $1'];
      if (filter.status) {
        params.push(filter.status);
        conds.push(`d.status = $${params.length}`);
      }
      if (filter.documentType) {
        params.push(filter.documentType);
        conds.push(`d.document_type = $${params.length}`);
      }
      if (filter.classification) {
        params.push(filter.classification);
        conds.push(`d.classification = $${params.length}`);
      }
      if (filter.search) {
        params.push(`%${filter.search}%`);
        conds.push(`d.title ILIKE $${params.length}`);
      }
      const where = `WHERE ${conds.join(' AND ')}`;
      params.push(page.limit, page.offset);
      const { rows } = await client.query<DocumentRow>(
        `${DOC_BASE} ${where}
         ORDER BY d.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const totalRes = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM hsdg.documents d ${where}`,
        params.slice(0, params.length - 2),
      );
      return { items: rows.map(mapDocument), total: Number(totalRes.rows[0]?.total ?? 0) };
    });
  }

  async getOne(ctx: RlsContext, engagementId: string, documentId: string): Promise<DocumentDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const detail = await this.selectDetail(client, documentId, engagementId);
      if (!detail) throw new NotFoundException('Document not found.');
      return detail;
    });
  }

  async update(
    ctx: RlsContext,
    engagementId: string,
    documentId: string,
    input: UpdateDocumentInput,
  ): Promise<DocumentRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectDocument(client, documentId, engagementId);
      if (!before) throw new NotFoundException('Document not found.');
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, val: unknown): void => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.title !== undefined) set('title', input.title);
      if (input.documentType !== undefined) set('document_type', input.documentType);
      if (input.classification !== undefined) set('classification', input.classification);
      if (input.sensitivity !== undefined) set('sensitivity', input.sensitivity);
      if (input.retentionUntil !== undefined) set('retention_until', input.retentionUntil);
      if (sets.length === 0) return before;

      await this.versionedUpdate(client, documentId, engagementId, sets, params, input.version);
      const after = await this.selectDocument(client, documentId, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'document.updated',
        objectType: 'document',
        objectId: documentId,
        after: { engagementId },
      });
      return after!;
    });
  }

  async archive(
    ctx: RlsContext,
    engagementId: string,
    documentId: string,
    input: ArchiveDocumentInput,
  ): Promise<DocumentRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectDocument(client, documentId, engagementId);
      if (!before) throw new NotFoundException('Document not found.');
      if (before.status === DOCUMENT_STATUS.archived) {
        throw new BadRequestException('Document is already archived.');
      }
      await this.versionedUpdate(
        client,
        documentId,
        engagementId,
        [`status = 'archived'`, `archived_at = now()`, `archived_by_employee_id = $1`],
        [ctx.employeeId ?? null],
        input.version,
      );
      const after = await this.selectDocument(client, documentId, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'document.archived',
        objectType: 'document',
        objectId: documentId,
        before: { status: before.status },
        after: { status: DOCUMENT_STATUS.archived },
        reason: input.reason,
      });
      return after!;
    });
  }

  async restore(
    ctx: RlsContext,
    engagementId: string,
    documentId: string,
    input: ArchiveDocumentInput,
  ): Promise<DocumentRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectDocument(client, documentId, engagementId);
      if (!before) throw new NotFoundException('Document not found.');
      if (before.status === DOCUMENT_STATUS.active) {
        throw new BadRequestException('Document is already active.');
      }
      await this.versionedUpdate(
        client,
        documentId,
        engagementId,
        [`status = 'active'`, `archived_at = NULL`, `archived_by_employee_id = NULL`],
        [],
        input.version,
      );
      const after = await this.selectDocument(client, documentId, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'document.restored',
        objectType: 'document',
        objectId: documentId,
        before: { status: before.status },
        after: { status: DOCUMENT_STATUS.active },
        reason: input.reason,
      });
      return after!;
    });
  }

  /**
   * Fetch the bytes of a document version, audited. If `versionId` is omitted the
   * current version is served. RLS scopes the metadata read to engagement
   * members, so a non-member gets 404 (existence not leaked) and can never reach
   * the storage reference — a document id alone cannot bypass access control.
   */
  async download(
    ctx: RlsContext,
    engagementId: string,
    documentId: string,
    versionId?: string,
  ): Promise<DocumentDownload> {
    const { reference, filename, contentType, sizeBytes } = await this.db.withRlsContext(
      ctx,
      async (client) => {
        const params: unknown[] = [documentId, engagementId];
        let where = `v.document_id = $1 AND v.engagement_id = $2`;
        if (versionId) {
          params.push(versionId);
          where += ` AND v.id = $3`;
        }
        const order = versionId ? '' : ' ORDER BY v.version_no DESC LIMIT 1';
        const { rows } = await client.query<{
          storage_reference: string;
          filename: string;
          content_type: string;
          size_bytes: string;
          version_no: number;
        }>(
          `SELECT v.storage_reference, v.filename, v.content_type, v.size_bytes, v.version_no
           FROM hsdg.document_versions v WHERE ${where}${order}`,
          params,
        );
        const row = rows[0];
        if (!row) throw new NotFoundException('Document not found.');
        await this.audit.recordWith(client, ctx, {
          action: 'document.downloaded',
          objectType: 'document',
          objectId: documentId,
          after: { engagementId, versionNo: row.version_no, filename: row.filename },
        });
        return {
          reference: row.storage_reference,
          filename: row.filename,
          contentType: row.content_type,
          sizeBytes: Number(row.size_bytes),
        };
      },
    );
    const buffer = await this.storage.read(reference);
    return { buffer, filename, contentType, sizeBytes };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async requireEngagement(client: PoolClient, engagementId: string): Promise<void> {
    const eng = await client.query(`SELECT 1 FROM hsdg.engagements WHERE id = $1`, [engagementId]);
    if (!eng.rows[0]) throw new NotFoundException('Engagement not found.');
  }

  private async insertVersion(
    client: PoolClient,
    v: {
      documentId: string;
      engagementId: string;
      versionNo: number;
      filename: string;
      contentType: string;
      decoded: { sizeBytes: number; checksumSha256: string };
      reference: string;
      note: string | null;
      uploadedBy: string | null;
    },
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO hsdg.document_versions
         (document_id, engagement_id, version_no, filename, content_type, size_bytes,
          checksum_sha256, storage_reference, note, uploaded_by_employee_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        v.documentId,
        v.engagementId,
        v.versionNo,
        v.filename,
        v.contentType,
        v.decoded.sizeBytes,
        v.decoded.checksumSha256,
        v.reference,
        v.note,
        v.uploadedBy,
      ],
    );
    return rows[0]!.id;
  }

  private async versionedUpdate(
    client: PoolClient,
    documentId: string,
    engagementId: string,
    sets: string[],
    setParams: unknown[],
    expectedVersion: number | undefined,
  ): Promise<void> {
    const params = [...setParams, documentId, engagementId];
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
        `UPDATE hsdg.documents SET ${[...sets, 'version = version + 1'].join(', ')}
         WHERE id = ${idParam} AND engagement_id = ${engParam}${versionClause}`,
        params,
      );
      updated = result.rowCount ?? 0;
    } catch (err) {
      throw mapDocumentError(err);
    }
    if (updated === 0) {
      const current = await this.selectDocument(client, documentId, engagementId);
      if (current && expectedVersion !== undefined && current.version !== expectedVersion) {
        throw new ConflictException(
          'Document was modified by someone else. Refresh and retry (stale version).',
        );
      }
      throw new NotFoundException('Document not found.');
    }
  }

  private async selectDocument(
    client: PoolClient,
    documentId: string,
    engagementId: string,
  ): Promise<DocumentRecord | null> {
    const { rows } = await client.query<DocumentRow>(
      `${DOC_BASE} WHERE d.id = $1 AND d.engagement_id = $2`,
      [documentId, engagementId],
    );
    return rows[0] ? mapDocument(rows[0]) : null;
  }

  private async selectDetail(
    client: PoolClient,
    documentId: string,
    engagementId: string,
  ): Promise<DocumentDetail | null> {
    const doc = await this.selectDocument(client, documentId, engagementId);
    if (!doc) return null;
    const { rows } = await client.query<VersionRow>(
      `${VERSION_BASE} WHERE v.document_id = $1 ORDER BY v.version_no DESC`,
      [documentId],
    );
    return { ...doc, versions: rows.map(mapVersion) };
  }
}

function mapDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    engagementId: row.engagement_id,
    title: row.title,
    documentType: row.document_type,
    classification: row.classification,
    sensitivity: row.sensitivity,
    status: row.status,
    currentVersionNo: Number(row.current_version_no),
    currentFilename: row.current_filename,
    currentContentType: row.current_content_type,
    currentSizeBytes: row.current_size_bytes === null ? null : Number(row.current_size_bytes),
    retentionUntil: row.retention_until,
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
    archivedById: row.archived_by_employee_id,
    createdById: row.created_by_employee_id,
    createdByName: row.created_by_name,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapVersion(row: VersionRow): DocumentVersionRecord {
  return {
    id: row.id,
    documentId: row.document_id,
    versionNo: Number(row.version_no),
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    note: row.note,
    uploadedById: row.uploaded_by_employee_id,
    uploadedByName: row.uploaded_by_name,
    uploadedAt: row.uploaded_at.toISOString(),
  };
}

/** Map PostgreSQL violations to clean HTTP errors (documents domain). */
export function mapDocumentError(err: unknown): Error {
  return translatePgError(err, {
    unique: [
      {
        match: 'document_versions_unique',
        message: 'A newer version already exists. Refresh and retry.',
      },
    ],
    uniqueDefault: 'A duplicate value violates a unique constraint.',
    foreignKey: 'A referenced record does not exist.',
    check: (message) =>
      message && message.length <= 200 ? message : 'A value violates a check constraint.',
    raise: (message) =>
      message && message.length <= 200 ? message : 'Invalid document operation.',
    forbidden: 'Not permitted to write this document.',
  });
}
