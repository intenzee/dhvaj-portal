import { ForbiddenException } from '@nestjs/common';
import { areaCapabilities, assertAreaCapability } from './area-review-access';

describe('03.5 role matrix (§27)', () => {
  it('the Engagement Manager prepares, completes, answers and manages grants — but does not review as EP', () => {
    expect(areaCapabilities('manager', false, null)).toEqual({
      prepare: true,
      complete: true,
      respond: true,
      manageGrants: true,
      partnerReview: false,
      requestArea: true,
    });
  });

  it('the EP reviews; acting as Manager (no EM assigned) the EP also prepares and completes', () => {
    const ep = areaCapabilities('partner', false, null);
    expect(ep.partnerReview).toBe(true);
    expect(ep.prepare || ep.complete || ep.respond || ep.manageGrants).toBe(false);
    const acting = areaCapabilities('partner', true, null);
    expect(acting.prepare && acting.complete && acting.partnerReview && acting.manageGrants).toBe(true);
  });

  it('a Senior / Article prepares only with a grant and completes only as manager-equivalent', () => {
    const none = areaCapabilities('team', false, null);
    expect(none.prepare).toBe(false);
    expect(none.requestArea).toBe(true);
    const prep = areaCapabilities('team', false, 'prepare');
    expect(prep.prepare).toBe(true);
    expect(prep.complete).toBe(false);
    const eq = areaCapabilities('team', false, 'manager_equivalent');
    expect(eq.complete && eq.respond).toBe(true);
    expect(eq.manageGrants).toBe(false);
  });

  it('oversight and non-members get nothing; a refusal names what is missing', () => {
    expect(Object.values(areaCapabilities('oversight', false, null)).some(Boolean)).toBe(false);
    expect(Object.values(areaCapabilities('none', false, null)).some(Boolean)).toBe(false);
    const access = {
      role: 'team' as const,
      roleLabel: 'Team',
      actingAsManager: false,
      employeeId: 'e1',
      grant: null,
      capabilities: areaCapabilities('team', false, null),
    };
    expect(() => assertAreaCapability(access, 'prepare')).toThrow(ForbiddenException);
    expect(() => assertAreaCapability(access, 'requestArea')).not.toThrow();
  });
});
