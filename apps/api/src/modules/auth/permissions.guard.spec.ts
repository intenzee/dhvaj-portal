import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } from './auth.decorators';
import { PermissionsGuard } from './permissions.guard';
import type { Principal } from './principal';

describe('PermissionsGuard', () => {
  const principal = (permissions: string[]): Principal => ({
    userId: 'u1',
    email: 'p@dhvaj.in',
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

  const guardWith = (required: string[] | undefined, anyOf?: string[]) => {
    const byKey: Record<string, string[] | undefined> = {
      [REQUIRED_PERMISSIONS_KEY]: required,
      [REQUIRED_ANY_PERMISSIONS_KEY]: anyOf,
    };
    const reflector = { getAllAndOverride: (key: string) => byKey[key] } as unknown as Reflector;
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

  it('allows any one of an any-of list, and forbids holding none', () => {
    const guard = guardWith(undefined, ['user.manage', 'user.onboard']);
    expect(guard.canActivate(ctx(principal(['user.onboard'])))).toBe(true);
    expect(() => guard.canActivate(ctx(principal(['user.read'])))).toThrow(ForbiddenException);
  });

  it('needs both an all-of and an any-of list to pass', () => {
    const guard = guardWith(['user.read'], ['user.manage', 'user.onboard']);
    expect(guard.canActivate(ctx(principal(['user.read', 'user.manage'])))).toBe(true);
    expect(() => guard.canActivate(ctx(principal(['user.onboard'])))).toThrow(ForbiddenException);
  });

  it('treats a missing principal as unauthenticated', () => {
    const guard = guardWith(['user.read']);
    expect(() => guard.canActivate(ctx(undefined))).toThrow(UnauthorizedException);
  });
});
