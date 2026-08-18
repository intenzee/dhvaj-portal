import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './auth.decorators';
import type { Principal } from './principal';

/**
 * Global authentication guard.
 *
 * Runs on every route except those marked {@link Public}. It extracts the bearer
 * token, resolves a {@link Principal}, enforces MFA when the user requires it,
 * and attaches the principal to the request for downstream guards/handlers.
 *
 * Fail-closed: any missing/invalid token, unknown/inactive user, or unsatisfied
 * MFA requirement results in 401 — never a silent pass.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { principal?: Principal }>();

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    const principal = await this.authService.resolvePrincipal(token);

    if (principal.mfaRequired && !principal.mfaSatisfied) {
      throw new UnauthorizedException('Multi-factor authentication required.');
    }

    request.principal = principal;
    return true;
  }
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || !value || scheme.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
}
