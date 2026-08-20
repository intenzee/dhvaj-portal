import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ROLE_PRECEDENCE, type RoleSlug } from '@hsdg/contracts';
import { AppConfigService } from '../../config/config.module';
import { IdentityService } from '../identity/identity.service';
import type { PrincipalData } from '../identity/identity.types';
import {
  ACTIVE_AUTH_PROVIDER,
  type AuthenticationProvider,
  type VerifiedToken,
} from './authentication-provider';
import { DevAuthProvider } from './dev-auth.provider';
import type { Principal } from './principal';

/**
 * Resolves a verified token into a full {@link Principal}.
 *
 * Verification (signature/issuer/audience) is delegated to the active provider;
 * this service maps the verified identity onto a user in the store, enforces
 * that the user is active, and computes the effective role and permissions.
 *
 * Non-production only: when the dev fallback is enabled and the active provider
 * rejects a token, the dev provider is tried too, so a local build can accept
 * both real Entra tokens and the seeded persona logins.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(ACTIVE_AUTH_PROVIDER)
    private readonly provider: AuthenticationProvider,
    private readonly devProvider: DevAuthProvider,
    private readonly config: AppConfigService,
    private readonly identity: IdentityService,
  ) {}

  async resolvePrincipal(token: string): Promise<Principal> {
    const verified = await this.verifyToken(token);

    let data: PrincipalData | null = null;
    if (verified.entraObjectId) {
      data = await this.identity.loadPrincipalByEntraId(verified.entraObjectId);
    }
    if (!data && verified.email) {
      data = await this.identity.loadPrincipalByEmail(verified.email);
    }

    if (!data) {
      throw new UnauthorizedException('Authenticated identity is not a known user.');
    }
    if (!data.isActive) {
      throw new UnauthorizedException('User account is inactive.');
    }

    return {
      userId: data.userId,
      email: data.email,
      displayName: data.displayName,
      officeId: data.officeId,
      officeCode: data.officeCode,
      employeeId: data.employeeId,
      roles: data.roles,
      effectiveRole: pickEffectiveRole(data.roles),
      permissions: data.permissions,
      mfaRequired: data.mfaRequired,
      mfaSatisfied: verified.mfaSatisfied,
    };
  }

  /**
   * Verify with the active provider; if it rejects and the non-production dev
   * fallback is on, try the dev provider too. When the active provider already
   * IS dev, there is nothing to fall back to.
   */
  private async verifyToken(token: string): Promise<VerifiedToken> {
    try {
      return await this.provider.verify(token);
    } catch (err) {
      if (this.config.devFallbackEnabled && this.provider.name !== this.devProvider.name) {
        try {
          return await this.devProvider.verify(token);
        } catch {
          /* fall through to the original error */
        }
      }
      throw err;
    }
  }
}

/** The highest-precedence role the user holds, or undefined if they hold none. */
export function pickEffectiveRole(roles: RoleSlug[]): RoleSlug | undefined {
  return ROLE_PRECEDENCE.find((r) => roles.includes(r));
}
