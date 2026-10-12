import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';

/**
 * Minimal Microsoft Graph client for the Microsoft 365 / SharePoint Online
 * integration: the editor bridge (`m365.service.ts`) and the SharePoint
 * document storage provider (`storage/sharepoint-storage.provider.ts`).
 *
 * Deliberately dependency-free: it acquires an app-only token via the OAuth2
 * client-credentials flow and calls Graph over `fetch`. A richer setup can later
 * swap this for `@azure/identity` + `@microsoft/microsoft-graph-client` behind
 * the same shape.
 *
 * The token is cached until shortly before expiry. All calls run as the
 * APPLICATION identity, scoped (via `Sites.Selected`) to the single locked-down
 * SharePoint site the portal owns. Documents live in that site's document
 * library drive; end users are NOT members of the site, so they cannot browse
 * it — they only ever reach a file through an anonymous ("Anyone with the link")
 * sharing link the API mints AFTER an RLS check.
 *
 * WHY ANONYMOUS: the portal must open files in genuine Office-for-the-web
 * WITHOUT asking each user to sign into their own Microsoft account — the whole
 * feature is backed by ONE enterprise identity (this app). Office only renders
 * its web editor for a browser that is either signed into Microsoft OR opening
 * an anonymous link, so an anonymous link is the only no-login path. The portal
 * is the single gatekeeper: it RLS-checks first, then mints a SHORT-LIVED link
 * (see M365_LINK_EXPIRY_MINUTES) so a leaked URL expires quickly. Requires the
 * tenant to allow "Anyone with the link" sharing on the provisioned site.
 */
interface CachedToken {
  value: string;
  /** epoch ms after which the token must be refreshed */
  expiresAt: number;
}

export interface GraphItemMeta {
  cTag: string | null;
  lastModifiedAt: string | null;
  lastModifiedBy: string | null;
}

export interface GraphItemVersion {
  id: string;
  savedAt: string | null;
  sizeBytes: number | null;
  editedBy: string | null;
}

/** A drive item's identity and size, as returned by a path lookup. */
export interface GraphItemStat {
  id: string;
  size: number;
}

/** The SharePoint site the portal writes into, as resolved from config. */
export interface GraphSite {
  id: string;
  webUrl: string | null;
}

/**
 * A failed Graph call. Keeps the HTTP status so callers (the storage provider,
 * the `m365:check` script) can tell a missing item or a permission gap apart
 * from an outage, while still surfacing as a 503 to API clients.
 */
export class GraphRequestError extends ServiceUnavailableException {
  constructor(
    message: string,
    readonly graphStatus: number,
    readonly detail: string = '',
  ) {
    super(message);
  }
}

/** Files at or below this size go up in one PUT; larger ones use an upload session. */
export const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** Upload-session chunk size — Graph requires a multiple of 320 KiB (this is 5 MiB). */
const UPLOAD_CHUNK_BYTES = 16 * 320 * 1024;
/** Statuses worth retrying (throttling / transient gateway errors). */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

/**
 * Encode a drive-relative path for Graph's `root:/{path}:` addressing. Each
 * segment is encoded on its own so `/` stays a folder separator; empty, `.` and
 * `..` segments are refused so a path can never climb out of its root.
 */
export function encodeDrivePath(path: string): string {
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length === 0 || segments.some((s) => s === '.' || s === '..')) {
    throw new GraphRequestError('Invalid SharePoint path.', 400);
  }
  return segments.map(encodeURIComponent).join('/');
}

/** The sharing link returned by the driveItem `createLink` action. */
interface SharingLinkResponse {
  link?: { webUrl?: string };
}

@Injectable()
export class GraphClient {
  private token: CachedToken | null = null;
  /** Cached resolution of the document-library drive id (from the site). */
  private driveId: string | null = null;
  /** Cached resolution of the site (from M365_SITE_ID or M365_SITE_URL). */
  private site: GraphSite | null = null;

  constructor(private readonly config: AppConfigService) {}

  /** True only when every required Microsoft 365 setting is present. */
  get configured(): boolean {
    return Boolean(
      this.config.get('M365_TENANT_ID') &&
      this.config.get('M365_CLIENT_ID') &&
      this.config.get('M365_CLIENT_SECRET') &&
      (this.config.get('M365_DRIVE_ID') ||
        this.config.get('M365_SITE_ID') ||
        this.config.get('M365_SITE_URL')),
    );
  }

  private base(): string {
    return this.config.get('M365_GRAPH_BASE_URL').replace(/\/$/, '');
  }

  /** Acquire (and cache) an app-only Graph access token. */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const tenant = this.config.get('M365_TENANT_ID');
    const clientId = this.config.get('M365_CLIENT_ID');
    const clientSecret = this.config.get('M365_CLIENT_SECRET');
    if (!tenant || !clientId || !clientSecret) {
      throw new ServiceUnavailableException('Microsoft 365 is not fully configured.');
    }

    const loginBase = this.config.get('M365_LOGIN_BASE_URL').replace(/\/$/, '');
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
    });
    const res = await fetch(`${loginBase}/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) await this.fail(res, 'Could not authenticate with Microsoft Graph');
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return this.token.value;
  }

  /**
   * Send one request with the app token, retrying throttled/transient failures
   * (honouring `Retry-After`). `url` is either a Graph path (prefixed with the
   * Graph base) or an absolute URL. Returns the response whatever its status —
   * callers decide what a non-2xx means.
   */
  private async send(
    method: string,
    url: string,
    init: { body?: RequestInit['body']; headers?: Record<string, string>; auth?: boolean } = {},
  ): Promise<Response> {
    const target = /^https?:\/\//.test(url) ? url : `${this.base()}${url}`;
    for (let attempt = 1; ; attempt++) {
      const headers: Record<string, string> = { ...init.headers };
      if (init.auth !== false) headers.authorization = `Bearer ${await this.accessToken()}`;
      const res = await fetch(target, { method, headers, body: init.body });
      if (!RETRYABLE_STATUS.has(res.status) || attempt >= MAX_ATTEMPTS) return res;
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 30) * 1000
          : 500 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  /** Throw a {@link GraphRequestError} carrying the status and a trimmed body. */
  private async fail(res: Response, message: string): Promise<never> {
    const detail = await res.text().catch(() => '');
    throw new GraphRequestError(`${message} (${res.status}).`, res.status, detail.slice(0, 500));
  }

  /** Low-level JSON call against Graph, returning parsed JSON (or `undefined` on 204). */
  async request<T>(
    method: string,
    path: string,
    init: { body?: unknown; query?: Record<string, string> } = {},
  ): Promise<T> {
    const qs = init.query ? `?${new URLSearchParams(init.query).toString()}` : '';
    const res = await this.send(method, `${path}${qs}`, {
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : {},
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!res.ok) await this.fail(res, 'Microsoft Graph request failed');
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * Resolve the SharePoint site the portal writes into. Prefers a pinned
   * `M365_SITE_ID`; otherwise looks the site up from `M365_SITE_URL`
   * (e.g. https://contoso.sharepoint.com/sites/Portal) and caches it.
   */
  async resolveSite(): Promise<GraphSite> {
    if (this.site) return this.site;
    const pinned = this.config.get('M365_SITE_ID');
    let path: string;
    if (pinned) {
      path = `/sites/${pinned}`;
    } else {
      const raw = this.config.get('M365_SITE_URL');
      if (!raw) {
        throw new ServiceUnavailableException(
          'Microsoft 365 storage is not configured (set M365_SITE_URL, M365_SITE_ID or M365_DRIVE_ID).',
        );
      }
      const url = new URL(raw);
      const sitePath = url.pathname.replace(/\/+$/, '');
      // `/sites/{host}:/{server-relative-path}` — the root site has no path.
      path = sitePath ? `/sites/${url.hostname}:${sitePath}` : `/sites/${url.hostname}`;
    }
    const site = await this.request<{ id: string; webUrl?: string }>('GET', path, {
      query: { $select: 'id,webUrl' },
    });
    this.site = { id: site.id, webUrl: site.webUrl ?? null };
    return this.site;
  }

  /**
   * Resolve the SharePoint document-library drive id the portal writes into.
   * Prefers the pinned `M365_DRIVE_ID`; otherwise resolves the site's default
   * document library once and caches it.
   */
  async resolveDriveId(): Promise<string> {
    const pinned = this.config.get('M365_DRIVE_ID');
    if (pinned) return pinned;
    if (this.driveId) return this.driveId;

    const site = await this.resolveSite();
    const drive = await this.request<{ id: string }>('GET', `/sites/${site.id}/drive`);
    this.driveId = drive.id;
    return drive.id;
  }

  /** Upload raw bytes to a drive item path, returning the created driveItem. */
  async uploadBytes(
    driveId: string,
    parentPath: string,
    filename: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<{ id: string; name: string }> {
    return this.putByPath(driveId, `${parentPath}/${filename}`, bytes, contentType);
  }

  /**
   * Write bytes at a drive-relative path, creating missing folders and replacing
   * any existing file. Small files go up in one PUT; larger ones through a
   * resumable upload session in 5 MiB chunks.
   */
  async putByPath(
    driveId: string,
    path: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<{ id: string; name: string }> {
    const encoded = encodeDrivePath(path);
    if (bytes.length <= SIMPLE_UPLOAD_MAX_BYTES) {
      const res = await this.send('PUT', `/drives/${driveId}/root:/${encoded}:/content`, {
        headers: { 'content-type': contentType },
        body: new Uint8Array(bytes),
      });
      if (!res.ok) await this.fail(res, 'Could not upload to SharePoint');
      return (await res.json()) as { id: string; name: string };
    }

    const session = await this.request<{ uploadUrl: string }>(
      'POST',
      `/drives/${driveId}/root:/${encoded}:/createUploadSession`,
      { body: { item: { '@microsoft.graph.conflictBehavior': 'replace' } } },
    );
    for (let start = 0; start < bytes.length; start += UPLOAD_CHUNK_BYTES) {
      const end = Math.min(start + UPLOAD_CHUNK_BYTES, bytes.length);
      // The upload URL is pre-authenticated — Graph rejects a bearer token on it.
      const res = await this.send('PUT', session.uploadUrl, {
        auth: false,
        headers: { 'content-range': `bytes ${start}-${end - 1}/${bytes.length}` },
        body: new Uint8Array(bytes.subarray(start, end)),
      });
      if (!res.ok) await this.fail(res, 'Could not upload to SharePoint');
      if (end === bytes.length) return (await res.json()) as { id: string; name: string };
    }
    throw new GraphRequestError('SharePoint upload session ended early.', 500);
  }

  /** Read a file's bytes by drive-relative path; `null` when it does not exist. */
  async getByPath(driveId: string, path: string): Promise<Buffer | null> {
    const res = await this.send(
      'GET',
      `/drives/${driveId}/root:/${encodeDrivePath(path)}:/content`,
    );
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res, 'Could not read from SharePoint');
    return Buffer.from(await res.arrayBuffer());
  }

  /** A file's id and size by drive-relative path; `null` when it does not exist. */
  async statByPath(driveId: string, path: string): Promise<GraphItemStat | null> {
    const res = await this.send(
      'GET',
      `/drives/${driveId}/root:/${encodeDrivePath(path)}?$select=id,size`,
    );
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res, 'Could not look up a SharePoint file');
    const item = (await res.json()) as { id: string; size?: number };
    return { id: item.id, size: item.size ?? 0 };
  }

  /** Delete a file by drive-relative path. Already-absent files are not an error. */
  async deleteByPath(driveId: string, path: string): Promise<void> {
    const res = await this.send('DELETE', `/drives/${driveId}/root:/${encodeDrivePath(path)}`);
    if (res.status === 404 || res.ok) return;
    await this.fail(res, 'Could not delete from SharePoint');
  }

  /**
   * Mint an anonymous ("Anyone with the link") sharing link for a drive item and
   * return the Office-for-the-web URL that opens it — with NO Microsoft sign-in.
   *
   * The portal is the single gatekeeper: this is only ever called after the API
   * has RLS-checked the caller's access to the document, so an anonymous link is
   * only ever handed to someone already entitled to the file. To keep a
   * copied/leaked URL from being useful for long, the link is minted SHORT-LIVED
   * (`expirationDateTime`, from M365_LINK_EXPIRY_MINUTES) and, for viewers, as
   * `view` (read-only) — `edit` is used only when the caller may edit AND the
   * tenant permits anonymous editing.
   *
   * Requires the tenant's external-sharing policy to allow anonymous links on
   * the provisioned site. If the tenant forbids anonymous sharing, Graph rejects
   * this call; switch the site's sharing to "Anyone" (or, if that is not
   * acceptable, the no-login model is not possible and users must sign in).
   */
  async createShareLink(
    driveId: string,
    itemId: string,
    opts: { canEdit: boolean; expiryMinutes: number },
  ): Promise<string> {
    const body: Record<string, unknown> = {
      type: opts.canEdit ? 'edit' : 'view',
      scope: 'anonymous',
      retainInheritedPermissions: false,
    };
    if (opts.expiryMinutes > 0) {
      body.expirationDateTime = new Date(Date.now() + opts.expiryMinutes * 60_000).toISOString();
    }
    const res = await this.request<SharingLinkResponse>(
      'POST',
      `/drives/${driveId}/items/${itemId}/createLink`,
      { body },
    );
    const url = res.link?.webUrl;
    if (!url) {
      throw new ServiceUnavailableException('Microsoft 365 did not return an editor link.');
    }
    return url;
  }

  /**
   * A drive item's change tag and last edit. The cTag changes whenever the
   * file's CONTENT changes, so comparing it with the last synced tag tells the
   * portal whether there are edits to pull back.
   */
  async getItemMeta(driveId: string, itemId: string): Promise<GraphItemMeta> {
    const item = await this.request<{
      cTag?: string;
      lastModifiedDateTime?: string;
      lastModifiedBy?: { user?: { displayName?: string } };
    }>('GET', `/drives/${driveId}/items/${itemId}`, {
      query: { $select: 'cTag,lastModifiedDateTime,lastModifiedBy' },
    });
    return {
      cTag: item.cTag ?? null,
      lastModifiedAt: item.lastModifiedDateTime ?? null,
      lastModifiedBy: item.lastModifiedBy?.user?.displayName ?? null,
    };
  }

  /** SharePoint's own version history of a drive item, newest first. */
  async listVersions(driveId: string, itemId: string): Promise<GraphItemVersion[]> {
    const res = await this.request<{
      value?: Array<{
        id: string;
        lastModifiedDateTime?: string;
        size?: number;
        lastModifiedBy?: { user?: { displayName?: string } };
      }>;
    }>('GET', `/drives/${driveId}/items/${itemId}/versions`);
    return (res.value ?? []).map((v) => ({
      id: v.id,
      savedAt: v.lastModifiedDateTime ?? null,
      sizeBytes: v.size ?? null,
      editedBy: v.lastModifiedBy?.user?.displayName ?? null,
    }));
  }

  /** Download a drive item's current bytes. */
  async downloadItem(driveId: string, itemId: string): Promise<Buffer> {
    const res = await this.send('GET', `/drives/${driveId}/items/${itemId}/content`);
    if (!res.ok) await this.fail(res, 'Could not read the edited document');
    return Buffer.from(await res.arrayBuffer());
  }
}
