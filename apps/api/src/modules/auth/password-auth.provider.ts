import { createHmac } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SignJWT, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import { AppConfigService } from '../../config/config.module';
import type { AuthenticationProvider, VerifiedToken } from './authentication-provider';

/**
 * Sessions for email + password sign-in. The API signs them itself (HS256)
 * with a key derived from AUTH_JWT_SECRET for this purpose only, under its own
 * issuer — so a dev token is never a password session, nor the reverse.
 *
 * A token carries the user id and the password version it was issued under;
 * the auth layer refuses it once the password is reset or changed.
 */
@Injectable()
export class PasswordAuthProvider implements AuthenticationProvider {
  readonly name = 'password';
  private readonly key: Uint8Array;

  constructor(private readonly config: AppConfigService) {
    this.key = createHmac('sha256', config.get('AUTH_JWT_SECRET'))
      .update('dhvaj-password-sessions')
      .digest();
  }

  private get issuer(): string {
    return `${this.config.get('AUTH_JWT_ISSUER')}/password`;
  }

  /** True when a token claims to be a password session (not verified). */
  claims(token: string): boolean {
    try {
      return decodeJwt(token).iss === this.issuer;
    } catch {
      return false;
    }
  }

  async issue(
    userId: string,
    email: string,
    passwordVersion: number,
  ): Promise<{ token: string; expiresIn: number }> {
    const ttl = this.config.get('AUTH_ACCESS_TTL_SECONDS');
    const token = await new SignJWT({ email, pwv: passwordVersion, amr: ['pwd'] })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(this.issuer)
      .setAudience(this.config.get('AUTH_JWT_AUDIENCE'))
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`)
      .sign(this.key);
    return { token, expiresIn: ttl };
  }

  async verify(token: string): Promise<VerifiedToken> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.key, {
        issuer: this.issuer,
        audience: this.config.get('AUTH_JWT_AUDIENCE'),
        algorithms: ['HS256'],
      }));
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }
    if (!payload.sub || typeof payload.email !== 'string' || typeof payload.pwv !== 'number') {
      throw new UnauthorizedException('Invalid or expired token.');
    }
    return {
      email: payload.email,
      userId: payload.sub,
      passwordVersion: payload.pwv,
      method: 'password',
      mfaSatisfied: false,
    };
  }
}
