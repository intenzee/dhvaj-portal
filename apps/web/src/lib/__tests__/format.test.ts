import { humanize, formatCount, daysUntil, deadlineLabel } from '../format';

describe('format helpers', () => {
  it('humanizes snake/kebab enum values', () => {
    expect(humanize('in_progress')).toBe('In Progress');
    expect(humanize('ep_signoff_pending')).toBe('Ep Signoff Pending');
    expect(humanize(null)).toBe('—');
  });

  it('formats counts and handles nullish', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(null)).toBe('0');
    expect(formatCount(1234)).toMatch(/1[,.]?234/);
  });

  it('computes signed days until a date', () => {
    const iso = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(daysUntil(iso)).toBe(3);
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(daysUntil(past)).toBe(-2);
    expect(daysUntil(null)).toBeNull();
  });

  it('labels deadlines relative to today', () => {
    const future = new Date(Date.now() + 1 * 86_400_000).toISOString();
    expect(deadlineLabel(future)).toBe('in 1 day');
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString();
    expect(deadlineLabel(past)).toBe('5 days overdue');
  });
});
