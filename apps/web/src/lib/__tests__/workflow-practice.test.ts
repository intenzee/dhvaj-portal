import {
  PRACTICE_MAX_PEOPLE,
  practiceNumber,
  practiceProblem,
  practiceWindow,
} from '@/components/reports/workflow-practice';

describe('practice session', () => {
  it('turns an IST day and two times into the exact window', () => {
    const w = practiceWindow('2026-10-15', '10:00', '11:00');
    expect(w).toEqual({ from: '2026-10-15T10:00:00+05:30', to: '2026-10-15T11:00:00+05:30' });
    expect(new Date(w.from).toISOString()).toBe('2026-10-15T04:30:00.000Z');
  });

  it('needs people and a window that ends after it starts, at most 7 days', () => {
    const hour = practiceWindow('2026-10-15', '10:00', '11:00');
    expect(practiceProblem(hour, [])).toBe('Pick the people taking part');
    expect(practiceProblem(hour, ['a'])).toBeNull();
    expect(
      practiceProblem(
        hour,
        Array.from({ length: PRACTICE_MAX_PEOPLE + 1 }, (_, i) => String(i)),
      ),
    ).toMatch(/At most/);
    expect(practiceProblem(practiceWindow('2026-10-15', '11:00', '10:00'), ['a'])).toMatch(
      /end after it starts/,
    );
    expect(practiceProblem(practiceWindow('2026-10-15', '10:00', ''), ['a'])).toMatch(/Pick a day/);
    expect(
      practiceProblem({ from: '2026-10-01T00:00:00Z', to: '2026-10-09T00:00:00Z' }, ['a']),
    ).toBe('At most 7 days');
  });

  it('shows a dash for nothing to measure', () => {
    expect(practiceNumber(null)).toBe('—');
    expect(practiceNumber(1.5)).toBe('1.5');
    expect(practiceNumber(80, '%')).toBe('80%');
  });
});
