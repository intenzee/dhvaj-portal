import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { HrDocument, HrDocumentKind, UploadHrDocumentInput } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AppConfigService } from '../../config/config.module';
import { AuditService } from '../audit/audit.service';
import { decodeUpload } from '../documents/documents.upload';
import { STORAGE_PROVIDER, type StorageProvider } from '../documents/storage/storage-provider';

const HR_DOCUMENT_SELECT = `
  SELECT d.id, d.employee_id, e.employee_code, e.full_name AS employee_name, d.kind, d.title,
         d.filename, d.content_type, d.size_bytes::text AS size_bytes, d.note,
         u.display_name AS uploaded_by_name, d.created_at, d.archived_at
    FROM hsdg.hr_documents d
    JOIN hsdg.employees e ON e.id = d.employee_id
    LEFT JOIN hsdg.users u ON u.id = d.uploaded_by_user_id`;

interface HrDocumentRow {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  kind: HrDocumentKind;
  title: string;
  filename: string;
  content_type: string;
  size_bytes: string;
  note: string | null;
  uploaded_by_name: string | null;
  created_at: Date;
  archived_at: Date | null;
}

/**
 * The HR documents vault (spec §4.7): offer and appointment letters, the
 * articleship deed, NDA, ID and tax proofs. HR and the Managing Partner only —
 * the database refuses everyone else (RLS), so a hidden row and a missing row
 * look the same. The bytes go to the firm's document storage under "hr/…";
 * nothing is deleted, a mistaken file is archived, and downloads are audited.
 */
@Injectable()
export class HrDocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async list(ctx: RlsContext, employeeId: string, includeArchived = false): Promise<HrDocument[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<HrDocumentRow>(
        `${HR_DOCUMENT_SELECT}
          WHERE d.employee_id = $1 AND ($2::boolean OR d.archived_at IS NULL)
          ORDER BY d.archived_at IS NOT NULL, d.created_at DESC`,
        [employeeId, includeArchived],
      );
      return rows.map(mapHrDocument);
    });
  }

  async upload(
    ctx: RlsContext,
    employeeId: string,
    input: UploadHrDocumentInput,
  ): Promise<HrDocument> {
    const decoded = decodeUpload(input.contentBase64, this.config.get('DOCUMENT_MAX_BYTES'));
    const id = randomUUID();
    const reference = this.storage.newReference(`hr/${employeeId}`, id);
    const contentType = input.contentType ?? 'application/octet-stream';

    // Bytes first, then the row; if the row is refused, remove the orphan.
    await this.storage.write(reference, decoded.buffer, contentType);
    try {
      return await this.db.withRlsContext(ctx, async (client) => {
        await this.requireEmployee(client, employeeId);
        try {
          await client.query(
            `INSERT INTO hsdg.hr_documents
               (id, employee_id, kind, title, filename, content_type, size_bytes,
                checksum_sha256, storage_reference, note, uploaded_by_user_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              id,
              employeeId,
              input.kind,
              input.title.trim(),
              input.filename,
              contentType,
              decoded.sizeBytes,
              decoded.checksumSha256,
              reference,
              input.note?.trim() || null,
              ctx.userId || null,
            ],
          );
        } catch (err) {
          throw translate(err);
        }
        await this.audit.recordWith(client, ctx, {
          action: 'hr_document.uploaded',
          objectType: 'employee',
          objectId: employeeId,
          after: { documentId: id, kind: input.kind, title: input.title, filename: input.filename },
        });
        return this.select(client, id);
      });
    } catch (err) {
      await this.storage.remove(reference).catch(() => undefined);
      throw err;
    }
  }

  async setArchived(
    ctx: RlsContext,
    employeeId: string,
    documentId: string,
    archived: boolean,
  ): Promise<HrDocument> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE hsdg.hr_documents
            SET archived_at = CASE WHEN $3 THEN now() END,
                archived_by_user_id = CASE WHEN $3 THEN $4::uuid END
          WHERE id = $1 AND employee_id = $2 AND (archived_at IS NOT NULL) <> $3`,
        [documentId, employeeId, archived, ctx.userId || null],
      );
      const doc = await this.select(client, documentId, employeeId);
      if (rowCount) {
        await this.audit.recordWith(client, ctx, {
          action: archived ? 'hr_document.archived' : 'hr_document.restored',
          objectType: 'employee',
          objectId: employeeId,
          after: { documentId, title: doc.title },
        });
      }
      return doc;
    });
  }

  async download(
    ctx: RlsContext,
    employeeId: string,
    documentId: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string; sizeBytes: number }> {
    const meta = await this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        filename: string;
        content_type: string;
        storage_reference: string;
        title: string;
      }>(
        `SELECT filename, content_type, storage_reference, title
           FROM hsdg.hr_documents WHERE id = $1 AND employee_id = $2`,
        [documentId, employeeId],
      );
      if (!rows[0]) throw new NotFoundException('Document not found.');
      await this.audit.recordWith(client, ctx, {
        action: 'hr_document.downloaded',
        objectType: 'employee',
        objectId: employeeId,
        after: { documentId, title: rows[0].title },
      });
      return rows[0];
    });
    const buffer = await this.storage.read(meta.storage_reference);
    return {
      buffer,
      filename: meta.filename,
      contentType: meta.content_type,
      sizeBytes: buffer.length,
    };
  }

  private async requireEmployee(client: PoolClient, employeeId: string): Promise<void> {
    const { rows } = await client.query(`SELECT 1 FROM hsdg.employees WHERE id = $1`, [employeeId]);
    if (!rows[0]) throw new NotFoundException('Employee not found.');
  }

  private async select(client: PoolClient, id: string, employeeId?: string): Promise<HrDocument> {
    const { rows } = await client.query<HrDocumentRow>(
      `${HR_DOCUMENT_SELECT} WHERE d.id = $1 AND ($2::uuid IS NULL OR d.employee_id = $2)`,
      [id, employeeId ?? null],
    );
    if (!rows[0]) throw new NotFoundException('Document not found.');
    return mapHrDocument(rows[0]);
  }
}

function translate(err: unknown): unknown {
  const e = err as { code?: string; constraint?: string };
  if (e.code === '42501') return new ForbiddenException('Only HR can add to the vault.');
  if (e.code === '23514')
    return new UnprocessableEntityException('The document details are not valid.');
  return err;
}

function mapHrDocument(r: HrDocumentRow): HrDocument {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    employeeName: r.employee_name,
    kind: r.kind,
    title: r.title,
    filename: r.filename,
    contentType: r.content_type,
    sizeBytes: Number(r.size_bytes),
    note: r.note,
    uploadedByName: r.uploaded_by_name,
    createdAt: r.created_at.toISOString(),
    archivedAt: r.archived_at?.toISOString() ?? null,
  };
}
