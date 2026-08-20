import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import { AppConfigService } from '../../config/config.module';
import type { AuthenticationProvider, VerifiedToken } from './authentication-provider';

/**
 * Microsoft Entra ID authentication provider.
 *
 * Validates access tokens against the tenant's published JWKS and normalises the
 * claims. MFA is taken from the token's `amr` claim — we trust the identity
 * provider's MFA assertion rather than re-implementing MFA.
 *
 * Robust to token format: Azure issues either **v2** tokens (issuer
 * `…/v2.0`, audience = the app's client id) or **v1** tokens (issuer
 * `sts.windows.net/<tenant>/`, audience = the `api://<client-id>` URI) depending
 * on the app registration's `accessTokenAcceptedVersion`. We accept both so the
 * caller doesn't have to tune the manifest, picking the matching signing keys by
 * the token's own issuer.
 *
 * Selected when `AUTH_PROVIDER=entra`; requires `AUTH_ENTRA_TENANT_ID` and
 * `AUTH_ENTRA_CLIENT_ID`.
 */
@Injectable()
export class EntraAuthProvider implements AuthenticationProvider {
  readonly name = 'entra';
  private readonly logger = new Logger(EntraAuthProvider.name);
  private jwksV1?: ReturnType<typeof createRemoteJWKSet>;
  private jwksV2?: ReturnType<typeof createRemoteJWKSet>;
  private issuers?: string[];
  private audiences?: string[];

  constructor(private readonly config: AppConfigService) {}

  private ensureConfigured(): void {
    if (this.jwksV2) return;

    const tenantId = this.config.get('AUTH_ENTRA_TENANT_ID');
    const clientId = this.config.get('AUTH_ENTRA_CLIENT_ID');
    if (!tenantId || !clientId) {
      throw new Error(
        'AUTH_PROVIDER=entra requires AUTH_ENTRA_TENANT_ID and AUTH_ENTRA_CLIENT_ID.',
      );
    }

    this.issuers = [
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
      `https://sts.windows.net/${tenantId}/`,
    ];
    this.audiences = [clientId, `api://${clientId}`];
    this.jwksV2 = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
    );
    this.jwksV1 = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/keys`),
    );
    this.logger.log('Entra ID authentication provider configured.');
  }

  async verify(token: string): Promise<VerifiedToken> {
    this.ensureConfigured();

    // Read the claims (unverified) to select the right signing keys and to give
    // an actionable diagnostic if verification fails.
    let unverified: JWTPayload;
    try {
      unverified = decodeJwt(token);
    } catch {
      throw new UnauthorizedException('Malformed token.');
    }
    const isV1 = typeof unverified.iss === 'string' && unverified.iss.includes('sts.windows.net');
    const jwks = isV1 ? this.jwksV1! : this.jwksV2!;

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer: this.issuers!,
        audience: this.audiences!,
      }));
    } catch (err) {
      // Log the mismatch (claims only, never the raw token) so setup issues are
      // diagnosable: token version, issuer, audience.
      this.logger.warn(
        `Entra token rejected: ${err instanceof Error ? err.message : String(err)} ` +
          `[iss=${unverified.iss} aud=${JSON.stringify(unverified.aud)} ` +
          `ver=${unverified.ver as string | undefined} appid=${
            (unverified.appid as string | undefined) ?? (unverified.azp as string | undefined)
          }]`,
      );
      throw new UnauthorizedException('Invalid or expired token.');
    }

    const email =
      (payload.preferred_username as string | undefined) ??
      (payload.email as string | undefined) ??
      (payload.upn as string | undefined) ??
      (payload.unique_name as string | undefined);
    const amr = Array.isArray(payload.amr) ? (payload.amr as string[]) : [];

    return {
      ...(email ? { email } : {}),
      ...(typeof payload.oid === 'string' ? { entraObjectId: payload.oid } : {}),
      mfaSatisfied: amr.includes('mfa'),
    };
  }
}
