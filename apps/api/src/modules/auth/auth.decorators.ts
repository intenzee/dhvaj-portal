import {
  applyDecorators,
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import type { PermissionSlug } from '@hsdg/contracts';
import type { Principal } from './principal';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const REQUIRED_PERMISSIONS_KEY = 'auth:permissions';

/** Marks a route as not requiring authentication (e.g. health, dev token). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Requires the principal to hold ALL of the given permissions. Also annotates
 * the OpenAPI operation as bearer-protected.
 */
export const RequirePermissions = (...permissions: PermissionSlug[]) =>
  applyDecorators(SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions), ApiBearerAuth('bearer'));

/** Injects the authenticated {@link Principal} into a controller handler. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
    return request.principal;
  },
);
