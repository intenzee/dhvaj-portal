import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { AppConfigService } from '../../config/config.module';
import type { AuthenticationProvider, VerifiedToken } from './authentication-provider';

/**
 * Microsoft Entra ID authentication provider.
 *
 * Validates access tokens against the tenant's published JWKS and expected
 * issuer/audience, then normalises the claims. MFA is taken from the token's
 * `amr` (authentication methods) claim — i.e. we trust the identity provider's
 * MFA assertion rather than re-implementing MFA ourselves.
 *
 * Selected when `AUTH_PROVIDER=entra`; requires `AUTH_ENTRA_TENANT_ID` and
 * `AUTH_ENTRA_CLIENT_ID`. This is the production authentication path; it is not
 * exercised in CI (no tenant), but the verification logic is real.
 */
@Injectable()
export class EntraAuthProvider implements AuthenticationProvider {
  readonly name = 'entra';
  private readonly logger = new Logger(EntraAuthProvider.name);
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private issuer?: string;
  private audience?: string;

  constructor(private readonly config: AppConfigService) {}

  private ensureConfigured(): void {
    if (this.jwks) return;

    const tenantId = this.config.get('AUTH_ENTRA_TENANT_ID');
    const clientId = this.config.get('AUTH_ENTRA_CLIENT_ID');
    if (!tenantId || !clientId) {
      throw new Error(
        'AUTH_PROVIDER=entra requires AUTH_ENTRA_TENANT_ID and AUTH_ENTRA_CLIENT_ID.',
      );
    }

    this.issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
    this.audience = clientId;
    this.jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
    );
    this.logger.log('Entra ID authentication provider configured.');
  }

  async verify(token: string): Promise<VerifiedToken> {
    this.ensureConfigured();

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.jwks!, {
        issuer: this.issuer!,
        audience: this.audience!,
      }));
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }

    const email =
      (payload.preferred_username as string | undefined) ??
      (payload.email as string | undefined) ??
      (payload.upn as string | undefined);
    const amr = Array.isArray(payload.amr) ? (payload.amr as string[]) : [];

    return {
      ...(email ? { email } : {}),
      ...(typeof payload.oid === 'string' ? { entraObjectId: payload.oid } : {}),
      mfaSatisfied: amr.includes('mfa'),
    };
  }
}
