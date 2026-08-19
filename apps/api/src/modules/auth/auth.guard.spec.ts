import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard, extractBearerToken } from './auth.guard';
import type { AuthService } from './auth.service';
import type { Principal } from './principal';

describe('extractBearerToken', () => {
  it('extracts a valid bearer token (scheme case-insensitive)', () => {
    expect(extractBearerToken('Bearer abc.def')).toBe('abc.def');
    expect(extractBearerToken('bearer xyz')).toBe('xyz');
  });
  it('returns null for missing/malformed headers', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('')).toBeNull();
    expect(extractBearerToken('Basic abc')).toBeNull();
    expect(extractBearerToken('Bearer ')).toBeNull();
  });
});

describe('AuthGuard', () => {
  const principal = (over: Partial<Principal> = {}): Principal => ({
    userId: 'u1',
    email: 'p@hsdg.in',
    displayName: 'P',
    officeId: 'o1',
    officeCode: 'NORTH',
    employeeId: null,
    roles: ['partner'],
    effectiveRole: 'partner',
    permissions: ['user.read'],
    mfaRequired: false,
    mfaSatisfied: false,
    ...over,
  });

  const context = (headers: Record<string, string>, req: Record<string, unknown> = {}) => {
    const request = { headers, ...req };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
      _request: request,
    } as unknown as ExecutionContext & { _request: Record<string, unknown> };
  };

  const guardWith = (svc: Partial<AuthService>, isPublic = false) => {
    const reflector = { getAllAndOverride: () => isPublic } as unknown as Reflector;
    return new AuthGuard(reflector, svc as AuthService);
  };

  it('allows public routes without a token', async () => {
    const guard = guardWith({}, true);
    await expect(guard.canActivate(context({}))).resolves.toBe(true);
  });

  it('rejects a protected route with no token', async () => {
    const guard = guardWith({ resolvePrincipal: jest.fn() });
    await expect(guard.canActivate(context({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the principal on success', async () => {
    const p = principal();
    const guard = guardWith({ resolvePrincipal: jest.fn().mockResolvedValue(p) });
    const ctx = context({ authorization: 'Bearer good' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx._request.principal).toBe(p);
  });

  it('blocks when MFA is required but not satisfied', async () => {
    const p = principal({ mfaRequired: true, mfaSatisfied: false });
    const guard = guardWith({ resolvePrincipal: jest.fn().mockResolvedValue(p) });
    await expect(guard.canActivate(context({ authorization: 'Bearer good' }))).rejects.toThrow(
      /multi-factor/i,
    );
  });

  it('passes when MFA is required and satisfied', async () => {
    const p = principal({ mfaRequired: true, mfaSatisfied: true });
    const guard = guardWith({ resolvePrincipal: jest.fn().mockResolvedValue(p) });
    await expect(guard.canActivate(context({ authorization: 'Bearer good' }))).resolves.toBe(true);
  });
});
