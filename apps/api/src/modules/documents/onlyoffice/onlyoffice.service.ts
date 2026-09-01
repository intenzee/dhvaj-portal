import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { PERMISSION } from '@hsdg/contracts';
import { AppConfigService } from '../../../config/config.module';
import type { RlsContext } from '../../../database/rls-context';
import { rlsContextFromPrincipal, type Principal } from '../../auth/principal';
import { DocumentsService } from '../documents.service';

/** OnlyOffice editor `documentType` for a file extension. */
const DOC_TYPE_BY_EXT: Record<string, 'word' | 'cell' | 'slide' | 'pdf'> = {
  doc: 'word',
  docx: 'word',
  odt: 'word',
  rtf: 'word',
  txt: 'word',
  xls: 'cell',
  xlsx: 'cell',
  xlsm: 'cell',
  ods: 'cell',
  csv: 'cell',
  ppt: 'slide',
  pptx: 'slide',
  odp: 'slide',
  pdf: 'pdf',
};

/** The compact RLS context we embed in scoped tokens so the DS callbacks can act as the user. */
interface TokenCtx {
  u: string;
  r: string;
  o?: string;
  e?: string;
}

interface ScopedClaims extends JWTPayload {
  p: 'oo-dl' | 'oo-cb';
  eng: string;
  doc: string;
  fn: string;
  ct: string;
  ctx: TokenCtx;
}

export interface EditorSession {
  enabled: true;
  dsPublicUrl: string;
  scriptUrl: string;
  config: Record<string, unknown>;
}

/**
 * Bridges the portal's audited, RLS-scoped document store to a self-hosted
 * OnlyOffice Document Server. The browser embeds the DS editor; the DS fetches
 * the file from — and saves it back to — this API over two token-scoped public
 * endpoints. The editing user's RLS context is carried in short-lived tokens
 * (signed with the app secret) so a save runs as that user, through the normal
 * append-only version path. The DS↔API exchange is additionally signed with the
 * shared DS secret, so a browser cannot forge a save.
 */
@Injectable()
export class OnlyOfficeService {
  private readonly appSecret: Uint8Array;

  constructor(
    private readonly config: AppConfigService,
    private readonly documents: DocumentsService,
  ) {
    this.appSecret = new TextEncoder().encode(this.config.get('AUTH_JWT_SECRET'));
  }

  get enabled(): boolean {
    return this.config.get('ONLYOFFICE_ENABLED');
  }

  private get dsSecret(): string {
    return this.config.get('ONLYOFFICE_JWT_SECRET');
  }

  private extOf(filename: string): string {
    const dot = filename.lastIndexOf('.');
    return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
  }

  supports(filename: string | null): boolean {
    return !!filename && this.extOf(filename) in DOC_TYPE_BY_EXT;
  }

  /** Build the embedded-editor configuration for a document the caller can access. */
  async buildSession(
    principal: Principal,
    engagementId: string,
    documentId: string,
  ): Promise<EditorSession> {
    if (!this.enabled) throw new BadRequestException('OnlyOffice editing is not enabled.');

    // getOne runs under the caller's RLS context — a non-member gets 404 here,
    // so we never mint a token for a document the user cannot access.
    const ctx = rlsContextFromPrincipal(principal);
    const detail = await this.documents.getOne(ctx, engagementId, documentId);
    const filename = detail.currentFilename ?? detail.title;
    const ext = this.extOf(filename);
    const documentType = DOC_TYPE_BY_EXT[ext];
    if (!documentType)
      throw new BadRequestException('This file type is not supported by the editor.');

    const canEdit = principal.permissions.includes(PERMISSION.engagementManage);
    const contentType = detail.currentContentType ?? 'application/octet-stream';
    const tokenCtx: TokenCtx = {
      u: ctx.userId,
      r: ctx.role,
      ...(ctx.officeId ? { o: ctx.officeId } : {}),
      ...(ctx.employeeId ? { e: ctx.employeeId } : {}),
    };

    const downloadToken = await this.signScoped(
      'oo-dl',
      engagementId,
      documentId,
      filename,
      contentType,
      tokenCtx,
      '8h',
    );
    const callbackToken = await this.signScoped(
      'oo-cb',
      engagementId,
      documentId,
      filename,
      contentType,
      tokenCtx,
      '12h',
    );

    const internal = this.config.get('ONLYOFFICE_API_INTERNAL_URL').replace(/\/$/, '');
    const documentUrl = `${internal}/api/v1/documents/onlyoffice/content?token=${encodeURIComponent(downloadToken)}`;
    const callbackUrl = `${internal}/api/v1/documents/onlyoffice/callback?token=${encodeURIComponent(callbackToken)}`;

    // The DS document `key` must change whenever the content changes, else the DS
    // serves a stale cached copy. Tie it to the current version number.
    const key = `${documentId.replace(/-/g, '')}-${detail.currentVersionNo}`;

    const config: Record<string, unknown> = {
      documentType,
      document: {
        fileType: ext,
        key,
        title: filename,
        url: documentUrl,
        permissions: { edit: canEdit, download: true, print: true },
      },
      editorConfig: {
        mode: canEdit ? 'edit' : 'view',
        lang: 'en',
        callbackUrl,
        user: { id: principal.userId, name: principal.displayName },
        customization: { autosave: true, forcesave: true, compactHeader: false },
      },
    };

    if (this.dsSecret) {
      config.token = await this.signDs(config);
    }

    const dsPublicUrl = this.config.get('ONLYOFFICE_DS_PUBLIC_URL').replace(/\/$/, '');
    return {
      enabled: true,
      dsPublicUrl,
      scriptUrl: `${dsPublicUrl}/web-apps/apps/api/documents/api.js`,
      config,
    };
  }

  /** Read the current bytes for a download token (the DS fetches this URL). */
  async readForToken(
    token: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string; sizeBytes: number }> {
    const claims = await this.verifyScoped(token, 'oo-dl');
    const ctx = ctxFrom(claims.ctx);
    return this.documents.download(ctx, claims.eng, claims.doc);
  }

  /** Handle a DS save callback: verify, and on a save-ready status persist a new version. */
  async handleCallback(
    token: string,
    body: Record<string, unknown>,
    authHeader: string | undefined,
  ): Promise<{ error: 0 }> {
    const claims = await this.verifyScoped(token, 'oo-cb');
    const payload = await this.verifyDsCallback(body, authHeader);

    const status = Number(payload.status ?? 0);
    // 2 = ready to save (all editors closed); 6 = force-save while still editing.
    if (status === 2 || status === 6) {
      const fileUrl = typeof payload.url === 'string' ? payload.url : undefined;
      if (!fileUrl) throw new BadRequestException('Callback missing document url.');
      const buffer = await this.fetchEdited(fileUrl);
      const ctx = ctxFrom(claims.ctx);
      await this.documents.addVersion(ctx, claims.eng, claims.doc, {
        filename: claims.fn,
        contentType: claims.ct,
        contentBase64: buffer.toString('base64'),
        note: 'Edited in OnlyOffice',
      });
    }
    // 1 (editing), 4 (closed, no change), 3/7 (DS-side save error) → nothing to persist.
    return { error: 0 };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async signScoped(
    purpose: 'oo-dl' | 'oo-cb',
    eng: string,
    doc: string,
    fn: string,
    ct: string,
    ctx: TokenCtx,
    ttl: string,
  ): Promise<string> {
    return new SignJWT({ p: purpose, eng, doc, fn, ct, ctx })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('hsdg-onlyoffice')
      .setAudience('hsdg-onlyoffice')
      .setIssuedAt()
      .setExpirationTime(ttl)
      .sign(this.appSecret);
  }

  private async verifyScoped(token: string, purpose: 'oo-dl' | 'oo-cb'): Promise<ScopedClaims> {
    if (!token) throw new UnauthorizedException('Missing token.');
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.appSecret, {
        issuer: 'hsdg-onlyoffice',
        audience: 'hsdg-onlyoffice',
      }));
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }
    const c = payload as ScopedClaims;
    if (c.p !== purpose || !c.eng || !c.doc || !c.ctx?.u) {
      throw new UnauthorizedException('Malformed token.');
    }
    return c;
  }

  private async signDs(config: Record<string, unknown>): Promise<string> {
    return new SignJWT(config as JWTPayload)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .sign(new TextEncoder().encode(this.dsSecret));
  }

  /**
   * Verify the DS-signed callback. OnlyOffice puts the JWT in the request body
   * (`token`) and/or the Authorization header; either must verify against the
   * shared secret. When no secret is configured (dev), the raw body is trusted.
   */
  private async verifyDsCallback(
    body: Record<string, unknown>,
    authHeader: string | undefined,
  ): Promise<Record<string, unknown>> {
    if (!this.dsSecret) return body;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const jwt = (typeof body.token === 'string' ? body.token : undefined) ?? bearer;
    if (!jwt) throw new UnauthorizedException('Callback is not signed.');
    try {
      const { payload } = await jwtVerify(jwt, new TextEncoder().encode(this.dsSecret));
      // OnlyOffice nests the real callback fields under `payload` inside the JWT.
      const inner = (payload as { payload?: Record<string, unknown> }).payload;
      return inner && typeof inner === 'object' ? inner : (payload as Record<string, unknown>);
    } catch {
      throw new UnauthorizedException('Invalid callback signature.');
    }
  }

  private async fetchEdited(fileUrl: string): Promise<Buffer> {
    // The DS reports the saved-file URL using its own view of itself; rewrite the
    // origin to the address this API can actually reach (the published DS port).
    let target = fileUrl;
    try {
      const u = new URL(fileUrl);
      const pub = new URL(this.config.get('ONLYOFFICE_DS_PUBLIC_URL'));
      u.protocol = pub.protocol;
      u.host = pub.host;
      target = u.toString();
    } catch {
      /* leave as-is if unparseable */
    }
    const res = await fetch(target);
    if (!res.ok)
      throw new BadRequestException(`Could not fetch the edited document (${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  }
}

function ctxFrom(c: TokenCtx): RlsContext {
  return {
    userId: c.u,
    role: c.r,
    ...(c.o ? { officeId: c.o } : {}),
    ...(c.e ? { employeeId: c.e } : {}),
  };
}
