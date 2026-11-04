import { canChangeStreamLead } from './stream-lead.service';

describe('who changes a stream lead', () => {
  it('an administrator or the Managing Partner — by role or as an added role', () => {
    expect(canChangeStreamLead({ role: 'admin' })).toBe(true);
    expect(canChangeStreamLead({ role: 'managing_partner' })).toBe(true);
    expect(canChangeStreamLead({ role: 'partner', roles: ['partner', 'admin'] })).toBe(true);
  });

  it('nobody else — not the engagement partner, a manager or a senior', () => {
    for (const role of ['partner', 'manager', 'senior', 'article', 'accountant', 'hr']) {
      expect(canChangeStreamLead({ role, roles: [role] })).toBe(false);
    }
  });
});
