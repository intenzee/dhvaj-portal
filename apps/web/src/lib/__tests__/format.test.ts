import {
  humanize,
  formatCount,
  daysUntil,
  deadlineLabel,
  formatDuration,
  formatClock,
  secondsSince,
} from '../format';

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

  it('formats durations compactly from seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(90)).toBe('1m');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(3600 + 23 * 60)).toBe('1h 23m');
    expect(formatDuration(null)).toBe('0s');
    expect(formatDuration(-10)).toBe('0s');
  });

  it('formats a ticking clock from seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(3600 + 2 * 60 + 3)).toBe('1:02:03');
  });

  it('computes elapsed seconds since a timestamp', () => {
    const tenAgo = new Date(Date.now() - 10_000).toISOString();
    expect(secondsSince(tenAgo)).toBeGreaterThanOrEqual(9);
    expect(secondsSince(null)).toBe(0);
    // A future timestamp never goes negative.
    expect(secondsSince(new Date(Date.now() + 5000).toISOString())).toBe(0);
  });
});
