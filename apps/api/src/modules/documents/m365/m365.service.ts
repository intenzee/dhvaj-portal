import { BadRequestException, Injectable } from '@nestjs/common';
import { PERMISSION } from '@hsdg/contracts';
import { AppConfigService } from '../../../config/config.module';
import { DatabaseService } from '../../../database/database.service';
import { rlsContextFromPrincipal, type Principal } from '../../auth/principal';
import type { DocumentDetail } from '../documents.types';
import { DocumentsService } from '../documents.service';
import { GraphClient } from './graph-client';

/** File extensions Microsoft 365 for the web can EDIT (co-author). */
const M365_EDITABLE_EXT = new Set(['doc', 'docx', 'xls', 'xlsx', 'xlsm', 'csv', 'ppt', 'pptx']);
/** Additionally viewable (read-only) in the Microsoft surface. */
const M365_VIEWABLE_EXT = new Set([...M365_EDITABLE_EXT, 'pdf']);

export interface M365EditorSession {
  enabled: true;
  /** Embeddable Office-for-the-web URL for this document's live item. */
  editorUrl: string;
  /** The SharePoint driveItem id (opaque; useful to the web client). */
  itemId: string;
  driveId: string;
  canEdit: boolean;
}

/**
 * Microsoft 365 / SharePoint Online editor bridge — the counterpart of the
 * OnlyOffice bridge. It exposes a document for editing in Microsoft's genuine
 * Office-for-the-web surface while keeping PostgreSQL as the record of truth:
 *
 *   • buildSession — RLS-checks access, ensures a live co-authorable copy exists
 *     in the portal's locked-down SharePoint document library, mints a
 *     short-lived anonymous ("Anyone with the link") sharing link so the file
 *     opens in genuine Office 365 for the web with NO per-user Microsoft
 *     sign-in, and returns that embeddable editor/viewer URL.
 *   • commit — pulls the live copy's current bytes back and writes a NEW audited
 *     version through the normal append-only path (documents.addVersion).
 *
 * The bridge NEVER lets SharePoint become the record of truth: committed
 * versions live behind the existing StorageProvider exactly as before; the
 * SharePoint item is only the live editing surface.
 *
 * NOTE (provisioning-dependent): the edit-link shape marked `FINALIZE` in the
 * Graph client depends on the tenant's sharing policy and must be verified
 * end-to-end once the SharePoint site is provisioned.
 */
@Injectable()
export class M365Service {
  constructor(
    private readonly config: AppConfigService,
    private readonly db: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly graph: GraphClient,
  ) {}

  get enabled(): boolean {
    return this.config.get('M365_ENABLED') && this.graph.configured;
  }

  private extOf(filename: string): string {
    const dot = filename.lastIndexOf('.');
    return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
  }

  supports(filename: string | null): boolean {
    return !!filename && M365_VIEWABLE_EXT.has(this.extOf(filename));
  }

  /** Build an embedded Microsoft 365 editor session for a document the caller can access. */
  async buildSession(
    principal: Principal,
    engagementId: string,
    documentId: string,
  ): Promise<M365EditorSession> {
    if (!this.enabled) throw new BadRequestException('Microsoft 365 editing is not enabled.');

    // Runs under the caller's RLS context — a non-member gets 404 here, so we
    // never expose a live item for a document the user cannot access.
    const ctx = rlsContextFromPrincipal(principal);
    const detail = await this.documents.getOne(ctx, engagementId, documentId);
    const filename = detail.currentFilename ?? detail.title;
    if (!this.supports(filename)) {
      throw new BadRequestException('This file type is not supported by the Microsoft 365 editor.');
    }
    // Editing (co-authoring + commit) needs three things: the caller may manage
    // the engagement, the file type is editable, AND the tenant permits
    // anonymous EDIT links. Anonymous edit is often disabled by tenants (and is
    // riskier), so it is gated behind M365_ALLOW_ANON_EDIT and defaults off —
    // everyone else gets the genuine Office-for-the-web VIEWER (the primary goal:
    // familiar, no-login viewing).
    const canEdit =
      this.config.get('M365_ALLOW_ANON_EDIT') &&
      principal.permissions.includes(PERMISSION.engagementManage) &&
      M365_EDITABLE_EXT.has(this.extOf(filename));

    const { itemId, driveId } = await this.ensureLiveItem(
      ctx,
      engagementId,
      documentId,
      filename,
      detail,
    );
    // An anonymous, short-lived link opens the file in real Office 365 for the
    // web with NO per-user Microsoft sign-in. The portal already RLS-checked the
    // caller above, so the link is only handed to someone entitled to the file;
    // its short expiry limits the value of a copied URL.
    const expiryMinutes = this.config.get('M365_LINK_EXPIRY_MINUTES');
    let effectiveCanEdit = canEdit;
    let editorUrl: string;
    try {
      editorUrl = await this.graph.createShareLink(driveId, itemId, { canEdit, expiryMinutes });
    } catch (err) {
      // If the tenant/site refuses anonymous EDIT links, don't fail to
      // OnlyOffice — degrade to a VIEW link so the file still opens in Office
      // 365 for the web (read-only). Non-edit failures rethrow.
      if (!canEdit) throw err;
      editorUrl = await this.graph.createShareLink(driveId, itemId, {
        canEdit: false,
        expiryMinutes,
      });
      effectiveCanEdit = false;
    }

    return { enabled: true, editorUrl, itemId, driveId, canEdit: effectiveCanEdit };
  }

  /**
   * Snapshot the live SharePoint copy into a new audited portal version. Called
   * by an explicit "Commit version" action and best-effort on editor close. Runs
   * the write through documents.addVersion, so RLS (lead-only) + audit +
   * append-only semantics are unchanged.
   */
  async commit(
    principal: Principal,
    engagementId: string,
    documentId: string,
  ): Promise<DocumentDetail> {
    if (!this.enabled) throw new BadRequestException('Microsoft 365 editing is not enabled.');
    const ctx = rlsContextFromPrincipal(principal);
    const detail = await this.documents.getOne(ctx, engagementId, documentId);

    const link = await this.readLiveLink(ctx, engagementId, documentId);
    if (!link.itemId || !link.driveId) {
      throw new BadRequestException('This document has no live Microsoft 365 copy to commit.');
    }
    const filename = detail.currentFilename ?? detail.title;
    const contentType = detail.currentContentType ?? 'application/octet-stream';
    const buffer = await this.graph.downloadItem(link.driveId, link.itemId);
    return this.documents.addVersion(ctx, engagementId, documentId, {
      filename,
      contentType,
      contentBase64: buffer.toString('base64'),
      note: 'Edited in Microsoft 365',
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** Ensure a live, co-authorable copy of the current version exists in the library. */
  private async ensureLiveItem(
    ctx: ReturnType<typeof rlsContextFromPrincipal>,
    engagementId: string,
    documentId: string,
    filename: string,
    detail: DocumentDetail,
  ): Promise<{ itemId: string; driveId: string }> {
    const existing = await this.readLiveLink(ctx, engagementId, documentId);
    if (existing.itemId && existing.driveId) return existing as { itemId: string; driveId: string };

    // Seed the live item from the current version bytes (audited download).
    const driveId = await this.graph.resolveDriveId();
    const file = await this.documents.download(ctx, engagementId, documentId);
    const created = await this.graph.uploadBytes(
      driveId,
      // Namespace by engagement/document so the library layout is auditable.
      `portal/${engagementId}/${documentId}/v${detail.currentVersionNo}`,
      filename,
      file.buffer,
      file.contentType,
    );

    await this.writeLiveLink(ctx, engagementId, documentId, driveId, created.id);
    return { itemId: created.id, driveId };
  }

  private async readLiveLink(
    ctx: ReturnType<typeof rlsContextFromPrincipal>,
    engagementId: string,
    documentId: string,
  ): Promise<{ itemId: string | null; driveId: string | null }> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        m365_live_item_id: string | null;
        m365_drive_id: string | null;
      }>(
        `SELECT m365_live_item_id, m365_drive_id
           FROM hsdg.documents WHERE id = $1 AND engagement_id = $2`,
        [documentId, engagementId],
      );
      const row = rows[0];
      return { itemId: row?.m365_live_item_id ?? null, driveId: row?.m365_drive_id ?? null };
    });
  }

  private async writeLiveLink(
    ctx: ReturnType<typeof rlsContextFromPrincipal>,
    engagementId: string,
    documentId: string,
    driveId: string,
    itemId: string,
  ): Promise<void> {
    await this.db.withRlsContext(ctx, async (client) => {
      await client.query(
        `UPDATE hsdg.documents SET m365_drive_id = $1, m365_live_item_id = $2
           WHERE id = $3 AND engagement_id = $4`,
        [driveId, itemId, documentId, engagementId],
      );
    });
  }
}
