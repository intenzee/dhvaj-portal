import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '../../../config/config.module';

/**
 * Minimal Microsoft Graph client for the Microsoft 365 / SharePoint Online
 * editor bridge.
 *
 * Deliberately dependency-free: it acquires an app-only token via the OAuth2
 * client-credentials flow and calls Graph over `fetch`. That keeps the scaffold
 * compiling with zero new packages; a richer setup can later swap this for
 * `@azure/identity` + `@microsoft/microsoft-graph-client` behind the same shape.
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

/** The sharing link returned by the driveItem `createLink` action. */
interface SharingLinkResponse {
  link?: { webUrl?: string };
}

@Injectable()
export class GraphClient {
  private token: CachedToken | null = null;
  /** Cached resolution of the document-library drive id (from the site id). */
  private driveId: string | null = null;

  constructor(private readonly config: AppConfigService) {}

  /** True only when every required Microsoft 365 setting is present. */
  get configured(): boolean {
    return Boolean(
      this.config.get('M365_TENANT_ID') &&
      this.config.get('M365_CLIENT_ID') &&
      this.config.get('M365_CLIENT_SECRET') &&
      (this.config.get('M365_DRIVE_ID') || this.config.get('M365_SITE_ID')),
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
      throw new ServiceUnavailableException('Microsoft 365 editing is not fully configured.');
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
    if (!res.ok) {
      throw new ServiceUnavailableException('Could not authenticate with Microsoft Graph.');
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return this.token.value;
  }

  /** Low-level JSON call against Graph, returning parsed JSON (or `undefined` on 204). */
  async request<T>(
    method: string,
    path: string,
    init: { body?: unknown; query?: Record<string, string> } = {},
  ): Promise<T> {
    const token = await this.accessToken();
    const qs = init.query ? `?${new URLSearchParams(init.query).toString()}` : '';
    const res = await fetch(`${this.base()}${path}${qs}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ServiceUnavailableException(
        `Microsoft Graph request failed (${res.status}). ${detail.slice(0, 200)}`,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * Resolve the SharePoint document-library drive id the portal writes into.
   * Prefers the pinned `M365_DRIVE_ID`; otherwise resolves the given site's
   * default document library once and caches it.
   */
  async resolveDriveId(): Promise<string> {
    const pinned = this.config.get('M365_DRIVE_ID');
    if (pinned) return pinned;
    if (this.driveId) return this.driveId;

    const siteId = this.config.get('M365_SITE_ID');
    if (!siteId) {
      throw new ServiceUnavailableException(
        'Microsoft 365 storage is not configured (set M365_DRIVE_ID or M365_SITE_ID).',
      );
    }
    const drive = await this.request<{ id: string }>('GET', `/sites/${siteId}/drive`);
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
    const token = await this.accessToken();
    // Simple PUT upload (fine for the portal's 10 MiB ceiling; larger files
    // would use an upload session).
    const safe = encodeURIComponent(`${parentPath.replace(/^\/|\/$/g, '')}/${filename}`);
    const res = await fetch(`${this.base()}/drives/${driveId}/root:/${safe}:/content`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
      body: new Uint8Array(bytes),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`Could not upload to SharePoint (${res.status}).`);
    }
    return (await res.json()) as { id: string; name: string };
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

  /** Download a drive item's current bytes. */
  async downloadItem(driveId: string, itemId: string): Promise<Buffer> {
    const token = await this.accessToken();
    const res = await fetch(`${this.base()}/drives/${driveId}/items/${itemId}/content`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`Could not read the edited document (${res.status}).`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
