import { ROLE, type RoleSlug } from '@hsdg/contracts';
import { pickEffectiveRole } from './auth.service';

describe('pickEffectiveRole (role precedence)', () => {
  it('returns the single role when only one is held', () => {
    expect(pickEffectiveRole([ROLE.manager])).toBe(ROLE.manager);
  });

  it('returns the highest-precedence role when several are held', () => {
    expect(pickEffectiveRole([ROLE.article, ROLE.partner, ROLE.senior])).toBe(ROLE.partner);
    expect(pickEffectiveRole([ROLE.manager, ROLE.managingPartner])).toBe(ROLE.managingPartner);
  });

  it('treats managing_partner as highest', () => {
    const all: RoleSlug[] = [
      ROLE.article,
      ROLE.senior,
      ROLE.manager,
      ROLE.partner,
      ROLE.admin,
      ROLE.managingPartner,
    ];
    expect(pickEffectiveRole(all)).toBe(ROLE.managingPartner);
  });

  it('returns undefined when no roles are held', () => {
    expect(pickEffectiveRole([])).toBeUndefined();
  });
});
