import { notLinkedToEmployee, notOnEngagementTeam, notOnTeamReason } from './staff-link.messages';

describe('staff-link messages', () => {
  it('tells an unlinked login where an administrator links it', () => {
    const m = notLinkedToEmployee('lodge this filing');
    expect(m).toMatch(/can't lodge this filing/);
    expect(m).toMatch(/Administration → People/);
    expect(m).toMatch(/Portal login/);
  });

  it('tells a linked non-member who can add them to the team', () => {
    const m = notOnEngagementTeam('work on this filing');
    expect(m).toMatch(/not on this engagement's team/);
    expect(m).toMatch(/engagement partner or manager/);
  });

  it('picks the reason from whether the login has an employee record', () => {
    expect(notOnTeamReason(null, 'x')).toBe(notLinkedToEmployee('x'));
    expect(notOnTeamReason(undefined, 'x')).toBe(notLinkedToEmployee('x'));
    expect(notOnTeamReason('emp-1', 'x')).toBe(notOnEngagementTeam('x'));
  });
});
