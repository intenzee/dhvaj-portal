import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import type { RlsContext } from '../../../database/rls-context';
import { AppConfigService } from '../../../config/config.module';
import { AuditService } from '../../audit/audit.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage/storage-provider';
import { decodeUpload } from '../documents.upload';

/** A magic link as staff see it (never includes the token or its hash). */
export interface ClientUploadLinkRecord {
  id: string;
  clientDependencyId: string;
  expiresAt: string;
  revokedAt: string | null;
  uploadsUsed: number;
  maxUploads: number | null;
  createdAt: string;
}

/** The one-time creation result — the raw token is returned ONLY here. */
export interface ClientUploadLinkCreated extends ClientUploadLinkRecord {
  /** The raw token to embed in the link. Not stored; shown once. */
  token: string;
}

/** Public view of a link for the client's upload page. */
export interface ClientUploadLinkInfo {
  valid: boolean;
  requestedInfo: string | null;
  outstandingItems: string | null;
  entityName: string | null;
  engagementCode: string | null;
  expiresAt: string | null;
  uploadsRemaining: number | null;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Secure magic-link client upload portal. Staff mint tokenised, expiring,
 * upload-only links for a client dependency; the client uploads without logging
 * in. Only the token HASH is stored. The public path never touches tables
 * directly — it calls the SECURITY DEFINER functions (the single trust boundary),
 * which validate the token before any write. The whole public path is inert
 * unless CLIENT_UPLOAD_ENABLED.
 */
@Injectable()
export class ClientUploadService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  get enabled(): boolean {
    return this.config.get('CLIENT_UPLOAD_ENABLED');
  }

  // ── Staff (authenticated, engagement lead) ───────────────────────────────

  async createLink(
    ctx: RlsContext,
    engagementId: string,
    dependencyId: string,
    opts: { ttlHours?: number; maxUploads?: number },
  ): Promise<ClientUploadLinkCreated> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = sha256Hex(token);
    const ttlHours = opts.ttlHours ?? this.config.get('CLIENT_UPLOAD_DEFAULT_TTL_HOURS');
    const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
    const defaultMax = this.config.get('CLIENT_UPLOAD_DEFAULT_MAX_UPLOADS');
    const rawMax = opts.maxUploads ?? defaultMax;
    const maxUploads = rawMax && rawMax > 0 ? rawMax : null;

    return this.db.withRlsContext(ctx, async (client) => {
      // The dependency must belong to this engagement (and be visible via RLS).
      const dep = await client.query(
        `SELECT 1 FROM hsdg.client_dependencies WHERE id = $1 AND engagement_id = $2`,
        [dependencyId, engagementId],
      );
      if (!dep.rows[0]) throw new NotFoundException('Client dependency not found.');

      const { rows } = await client.query<LinkRow>(
        `INSERT INTO hsdg.client_upload_links
           (engagement_id, client_dependency_id, token_hash, created_by_employee_id,
            expires_at, max_uploads)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, client_dependency_id, expires_at, revoked_at, uploads_used,
                   max_uploads, created_at`,
        [engagementId, dependencyId, tokenHash, ctx.employeeId ?? null, expiresAt, maxUploads],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'client_upload_link.created',
        objectType: 'client_upload_link',
        objectId: rows[0]!.id,
        after: { engagementId, clientDependencyId: dependencyId, expiresAt },
      });
      return { ...mapLink(rows[0]!), token };
    });
  }

  async listLinks(
    ctx: RlsContext,
    engagementId: string,
    dependencyId: string,
  ): Promise<ClientUploadLinkRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<LinkRow>(
        `SELECT id, client_dependency_id, expires_at, revoked_at, uploads_used,
                max_uploads, created_at
           FROM hsdg.client_upload_links
          WHERE engagement_id = $1 AND client_dependency_id = $2
          ORDER BY created_at DESC`,
        [engagementId, dependencyId],
      );
      return rows.map(mapLink);
    });
  }

  async revokeLink(ctx: RlsContext, engagementId: string, linkId: string): Promise<void> {
    await this.db.withRlsContext(ctx, async (client) => {
      const result = await client.query(
        `UPDATE hsdg.client_upload_links SET revoked_at = now()
          WHERE id = $1 AND engagement_id = $2 AND revoked_at IS NULL`,
        [linkId, engagementId],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new NotFoundException('Link not found or already revoked.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'client_upload_link.revoked',
        objectType: 'client_upload_link',
        objectId: linkId,
      });
    });
  }

  // ── Public (unauthenticated; token is the authorisation) ─────────────────

  private ensureEnabled(): void {
    if (!this.enabled) throw new NotFoundException();
  }

  async publicInfo(token: string): Promise<ClientUploadLinkInfo> {
    this.ensureEnabled();
    const { rows } = await this.db.query<InfoRow>(
      `SELECT * FROM hsdg.client_upload_link_info($1)`,
      [sha256Hex(token)],
    );
    const row = rows[0];
    if (!row || !row.valid) {
      return {
        valid: false,
        requestedInfo: null,
        outstandingItems: null,
        entityName: null,
        engagementCode: null,
        expiresAt: null,
        uploadsRemaining: null,
      };
    }
    return {
      valid: true,
      requestedInfo: row.requested_info,
      outstandingItems: row.outstanding_items,
      entityName: row.entity_name,
      engagementCode: row.engagement_code,
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
      uploadsRemaining: row.uploads_remaining,
    };
  }

  async publicUpload(
    token: string,
    input: { title?: string; filename: string; contentType?: string; contentBase64: string },
  ): Promise<{ ok: true }> {
    this.ensureEnabled();
    const tokenHash = sha256Hex(token);
    // Resolve the (valid) link to get its engagement for a tidy storage path.
    const info = await this.db.query<InfoRow>(`SELECT * FROM hsdg.client_upload_link_info($1)`, [
      tokenHash,
    ]);
    const row = info.rows[0];
    if (!row || !row.valid || !row.engagement_id) {
      throw new BadRequestException('This upload link is invalid or has expired.');
    }
    const decoded = decodeUpload(input.contentBase64, this.config.get('DOCUMENT_MAX_BYTES'));
    const contentType = input.contentType || 'application/octet-stream';
    const reference = this.storage.newReference(row.engagement_id, randomUUID());
    await this.storage.write(reference, decoded.buffer, contentType);
    try {
      await this.db.query(`SELECT hsdg.create_client_document($1,$2,$3,$4,$5,$6,$7) AS id`, [
        tokenHash,
        (input.title?.trim() || input.filename).slice(0, 300),
        input.filename,
        contentType,
        decoded.sizeBytes,
        decoded.checksumSha256,
        reference,
      ]);
    } catch {
      // Compensate the orphan blob if the metadata write is rejected (e.g. the
      // link expired between info-check and write, or hit its cap).
      await this.storage.remove(reference).catch(() => undefined);
      throw new BadRequestException('This upload link is invalid or has expired.');
    }
    return { ok: true };
  }
}

interface LinkRow {
  id: string;
  client_dependency_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  uploads_used: number;
  max_uploads: number | null;
  created_at: Date;
}

interface InfoRow {
  valid: boolean;
  engagement_id: string | null;
  requested_info: string | null;
  outstanding_items: string | null;
  entity_name: string | null;
  engagement_code: string | null;
  expires_at: Date | null;
  uploads_remaining: number | null;
}

function mapLink(row: LinkRow): ClientUploadLinkRecord {
  return {
    id: row.id,
    clientDependencyId: row.client_dependency_id,
    expiresAt: row.expires_at.toISOString(),
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    uploadsUsed: Number(row.uploads_used),
    maxUploads: row.max_uploads === null ? null : Number(row.max_uploads),
    createdAt: row.created_at.toISOString(),
  };
}
