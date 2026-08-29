import {
  ESCALATION_LADDER,
  ESCALATION_LEVELS,
  escalationAction,
  type EscalationLevel,
} from '@hsdg/contracts';

/**
 * The §24 escalation LADDER: each band takes a DISTINCT action addressed to a
 * distinct accountability tier. These assertions pin the policy so the calendar
 * legend, the API records, and the notification engine can never silently drift.
 */
describe('escalationAction (§24 distinct escalation actions)', () => {
  it('maps every escalation level to a descriptor', () => {
    for (const level of ESCALATION_LEVELS) {
      const d = escalationAction(level as EscalationLevel);
      expect(d.level).toBe(level);
      expect(typeof d.action).toBe('string');
      expect(Array.isArray(d.recipients)).toBe(true);
    }
  });

  it('closed / far-out bands take no notifying action and reach no one', () => {
    expect(escalationAction('none').action).toBe('none');
    expect(escalationAction('none').recipients).toEqual([]);
    expect(escalationAction('upcoming').action).toBe('monitor');
    expect(escalationAction('upcoming').recipients).toEqual([]);
  });

  it('each open band takes a DISTINCT action and widens the audience', () => {
    const open = ['due_soon', 'due_today', 'overdue', 'critical'] as const;
    const actions = open.map((l) => escalationAction(l).action);
    // Distinct action per band — the point of §24.
    expect(new Set(actions).size).toBe(open.length);
    // The audience only ever grows as urgency rises.
    const sizes = open.map((l) => escalationAction(l).recipients.length);
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i]!).toBeGreaterThanOrEqual(sizes[i - 1]!);
    }
  });

  it('escalates from owner → manager → partner → firm as the band worsens', () => {
    expect(escalationAction('due_soon').recipients).toContain('Owner');
    expect(escalationAction('due_today').recipients).toContain('Manager');
    expect(escalationAction('overdue').recipients).toContain('Engagement partner');
    expect(escalationAction('critical').recipients).toContain('Firm (Managing Partner)');
  });

  it('the legend ladder is the five OPEN bands in ascending urgency', () => {
    expect(ESCALATION_LADDER.map((d) => d.level)).toEqual([
      'upcoming',
      'due_soon',
      'due_today',
      'overdue',
      'critical',
    ]);
    // The closed band is never part of the escalation ladder.
    expect(ESCALATION_LADDER.some((d) => d.level === 'none')).toBe(false);
  });
});
