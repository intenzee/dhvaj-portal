import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { PermissionSlug } from '@hsdg/contracts';
import { REQUIRED_PERMISSIONS_KEY } from './auth.decorators';
import type { Principal } from './principal';

/**
 * Global authorisation guard. Runs after {@link AuthGuard}. If a route declares
 * required permissions via {@link RequirePermissions}, the principal must hold
 * every one of them; otherwise 403.
 *
 * This is the application-authorisation layer. It sits above — never instead of
 * — PostgreSQL RLS: even a permitted principal only sees rows RLS allows.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionSlug[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const principal = request.principal;
    if (!principal) {
      // AuthGuard should have populated this; treat absence as unauthenticated.
      throw new UnauthorizedException('Not authenticated.');
    }

    const held = new Set(principal.permissions);
    const missing = required.filter((p) => !held.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing required permission(s): ${missing.join(', ')}.`);
    }
    return true;
  }
}
