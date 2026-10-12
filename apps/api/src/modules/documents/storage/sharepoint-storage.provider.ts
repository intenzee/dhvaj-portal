import { randomUUID } from 'node:crypto';
import { Logger, NotFoundException } from '@nestjs/common';
import type { GraphClient, GraphItemStat } from '../m365/graph-client';
import type { StorageProvider } from './storage-provider';

/**
 * SharePoint Online storage provider — the firm's own Microsoft 365 tenant
 * holds every document version.
 *
 * The bytes live in the portal's locked-down SharePoint site (the same one the
 * Microsoft 365 editor bridge uses), under a dedicated root folder:
 *
 *   {root}/{engagementId}/{documentId}/{uuid}
 *
 * so the library mirrors the opaque reference exactly. Access is app-only
 * through `Sites.Selected`; no end user is a member of the site, so the portal
 * (and its RLS) stays the only way to reach a file. Committed versions are
 * immutable — each version gets a fresh reference — while the editor bridge's
 * live co-authoring copies live under a separate folder.
 *
 * Throttling and transient Graph errors are retried inside {@link GraphClient}.
 */
export class SharePointStorageProvider implements StorageProvider {
  readonly name = 'sharepoint';
  private readonly logger = new Logger(SharePointStorageProvider.name);
  private readonly root: string;

  constructor(
    private readonly graph: GraphClient,
    rootFolder: string,
  ) {
    if (!graph.configured) {
      throw new Error(
        'STORAGE_PROVIDER=sharepoint requires M365_TENANT_ID, M365_CLIENT_ID, M365_CLIENT_SECRET ' +
          'and one of M365_SITE_URL / M365_SITE_ID / M365_DRIVE_ID.',
      );
    }
    this.root = rootFolder.replace(/^\/+|\/+$/g, '') || 'vault';
    this.logger.log(`SharePoint document storage under "/${this.root}".`);
  }

  newReference(engagementId: string, documentId: string): string {
    return `${engagementId}/${documentId}/${randomUUID()}`;
  }

  async write(reference: string, data: Buffer, contentType: string): Promise<void> {
    const path = this.pathOf(reference);
    await this.graph.putByPath(await this.graph.resolveDriveId(), path, data, contentType);
  }

  async read(reference: string): Promise<Buffer> {
    const path = this.pathOf(reference);
    const bytes = await this.graph.getByPath(await this.graph.resolveDriveId(), path);
    if (!bytes) throw new NotFoundException('Document content is no longer available in storage.');
    return bytes;
  }

  async remove(reference: string): Promise<void> {
    const path = this.pathOf(reference);
    await this.graph.deleteByPath(await this.graph.resolveDriveId(), path);
  }

  /** Size/id of a stored reference, or `null` if absent (used by the migration script). */
  async stat(reference: string): Promise<GraphItemStat | null> {
    const path = this.pathOf(reference);
    return this.graph.statByPath(await this.graph.resolveDriveId(), path);
  }

  /** Map a reference to its drive path, refusing anything that could escape the root. */
  private pathOf(reference: string): string {
    const segments = reference.split('/');
    if (segments.some((s) => s === '' || s === '.' || s === '..' || s.includes('\\'))) {
      throw new NotFoundException('Invalid storage reference.');
    }
    return `${this.root}/${reference}`;
  }
}
