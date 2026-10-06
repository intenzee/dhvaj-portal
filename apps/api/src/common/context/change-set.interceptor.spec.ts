import { of } from 'rxjs';
import type { ClsService } from 'nestjs-cls';
import type { Reflector } from '@nestjs/core';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import {
  CLS_CHANGE_LABEL,
  CLS_CHANGE_SET,
  ChangeSetInterceptor,
  changeLabelFromSummary,
} from './change-set.interceptor';

describe('changeLabelFromSummary', () => {
  it('keeps the action and drops spec references and explanations', () => {
    expect(
      changeLabelFromSummary('Update a completion / reporting checklist item (§27.07/§27.08)'),
    ).toBe('Update a completion / reporting checklist item');
    expect(
      changeLabelFromSummary('Approve Completion — freeze the phase and unlock Reporting (§28)'),
    ).toBe('Approve Completion');
    expect(changeLabelFromSummary(undefined)).toBeUndefined();
  });
});

describe('ChangeSetInterceptor', () => {
  const run = (method: string, path: string): Map<string, unknown> => {
    const store = new Map<string, unknown>();
    const cls = {
      isActive: () => true,
      set: (k: string, v: unknown) => store.set(k, v),
    } as unknown as ClsService;
    const reflector = {
      get: () => ({ summary: 'Delete a PBC request (§16)' }),
    } as unknown as Reflector;
    const ctx = {
      getType: () => 'http',
      getHandler: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ method, path }) }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of(null) };
    new ChangeSetInterceptor(cls, reflector).intercept(ctx, next);
    return store;
  };
  const eng = '/api/v1/engagements/11111111-1111-1111-1111-111111111111';

  it('stamps an audit-file write with a change set and label', () => {
    const store = run('DELETE', `${eng}/statutory-audit/pbc/abc`);
    expect(store.get(CLS_CHANGE_SET)).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.get(CLS_CHANGE_LABEL)).toBe('Delete a PBC request');
  });

  it('leaves reads, other areas, sign-off and archive out of undo', () => {
    expect(run('GET', `${eng}/statutory-audit/pbc`).size).toBe(0);
    expect(run('POST', `${eng}/services`).size).toBe(0);
    expect(run('POST', '/api/v1/entities/abc').size).toBe(0);
    expect(run('POST', `${eng}/statutory-audit/wf-1/sign-off`).size).toBe(0);
    expect(run('POST', `${eng}/statutory-audit/wf-1/archive`).size).toBe(0);
  });
});
