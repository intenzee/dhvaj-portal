import { initials, teamCountLine } from '../teams';

describe('CM-8 team helpers', () => {
  it('takes first and last initials', () => {
    expect(initials('Rakesh Kumar Jain')).toBe('RJ');
    expect(initials('  priya ')).toBe('P');
  });

  it('counts a new team for the window footer', () => {
    expect(teamCountLine(true, 4, 12)).toBe('1 partner, 4 associates, 12 clients');
    expect(teamCountLine(false, 1, 1)).toBe('0 partners, 1 associate, 1 client');
  });
});
