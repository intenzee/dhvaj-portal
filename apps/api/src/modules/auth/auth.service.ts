import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ROLE_PRECEDENCE, type RoleSlug } from '@hsdg/contracts';
import { IdentityService } from '../identity/identity.service';
import type { PrincipalData } from '../identity/identity.types';
import { ACTIVE_AUTH_PROVIDER, type AuthenticationProvider } from './authentication-provider';
import type { Principal } from './principal';

/**
 * Resolves a verified token into a full {@link Principal}.
 *
 * Verification (signature/issuer/audience) is delegated to the active provider;
 * this service maps the verified identity onto a user in the store, enforces
 * that the user is active, and computes the effective role and permissions.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(ACTIVE_AUTH_PROVIDER)
    private readonly provider: AuthenticationProvider,
    private readonly identity: IdentityService,
  ) {}

  async resolvePrincipal(token: string): Promise<Principal> {
    const verified = await this.provider.verify(token);

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
}

/** The highest-precedence role the user holds, or undefined if they hold none. */
export function pickEffectiveRole(roles: RoleSlug[]): RoleSlug | undefined {
  return ROLE_PRECEDENCE.find((r) => roles.includes(r));
}
