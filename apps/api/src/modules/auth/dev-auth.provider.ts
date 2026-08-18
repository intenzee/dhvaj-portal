import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { AppConfigService } from '../../config/config.module';
import type { AuthenticationProvider, VerifiedToken } from './authentication-provider';

/**
 * Development/test authentication provider.
 *
 * Issues and verifies locally-signed HS256 JWTs. It exists so the system is
 * fully exercisable (and testable) without a live Microsoft Entra tenant. It is
 * only selected when `AUTH_PROVIDER=dev`, and token issuance is further gated to
 * non-production by {@link AuthController}.
 */
@Injectable()
export class DevAuthProvider implements AuthenticationProvider {
  readonly name = 'dev';
  private readonly secret: Uint8Array;

  constructor(private readonly config: AppConfigService) {
    this.secret = new TextEncoder().encode(config.get('AUTH_JWT_SECRET'));
  }

  /** Mint a token for a known user email. `mfa` reflects an MFA-satisfied login. */
  async issue(email: string, mfa: boolean): Promise<{ token: string; expiresIn: number }> {
    const ttl = this.config.get('AUTH_ACCESS_TTL_SECONDS');
    const token = await new SignJWT({ mfa })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(email)
      .setIssuer(this.config.get('AUTH_JWT_ISSUER'))
      .setAudience(this.config.get('AUTH_JWT_AUDIENCE'))
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`)
      .sign(this.secret);
    return { token, expiresIn: ttl };
  }

  async verify(token: string): Promise<VerifiedToken> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.secret, {
        issuer: this.config.get('AUTH_JWT_ISSUER'),
        audience: this.config.get('AUTH_JWT_AUDIENCE'),
      }));
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }

    if (!payload.sub) {
      throw new UnauthorizedException('Token is missing a subject.');
    }
    return { email: payload.sub, mfaSatisfied: payload.mfa === true };
  }
}
