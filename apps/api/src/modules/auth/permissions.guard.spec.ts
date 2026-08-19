import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import type { Principal } from './principal';

describe('PermissionsGuard', () => {
  const principal = (permissions: string[]): Principal => ({
    userId: 'u1',
    email: 'p@hsdg.in',
    displayName: 'P',
    officeId: 'o1',
    officeCode: 'NORTH',
    employeeId: null,
    roles: ['manager'],
    effectiveRole: 'manager',
    permissions,
    mfaRequired: false,
    mfaSatisfied: true,
  });

  const guardWith = (required: string[] | undefined) => {
    const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
    return new PermissionsGuard(reflector);
  };

  const ctx = (p?: Principal) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ principal: p }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as unknown as ExecutionContext;

  it('allows when no permissions are required', () => {
    expect(guardWith([]).canActivate(ctx(principal([])))).toBe(true);
    expect(guardWith(undefined).canActivate(ctx(principal([])))).toBe(true);
  });

  it('allows when the principal holds every required permission', () => {
    const guard = guardWith(['user.read']);
    expect(guard.canActivate(ctx(principal(['user.read', 'office.read'])))).toBe(true);
  });

  it('forbids when a required permission is missing', () => {
    const guard = guardWith(['user.read']);
    expect(() => guard.canActivate(ctx(principal(['office.read'])))).toThrow(ForbiddenException);
  });

  it('treats a missing principal as unauthenticated', () => {
    const guard = guardWith(['user.read']);
    expect(() => guard.canActivate(ctx(undefined))).toThrow(UnauthorizedException);
  });
});
