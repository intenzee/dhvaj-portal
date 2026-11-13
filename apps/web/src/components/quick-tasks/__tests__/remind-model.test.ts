import { allottedLabel, reminderText } from '@hsdg/contracts';
import { mayRemind, remindMinutes } from '../remind-model';

describe('mayRemind', () => {
  it('is for a Partner, the Managing Partner or an Admin with an employee record', () => {
    for (const r of ['partner', 'managing_partner', 'admin'] as const) {
      expect(mayRemind({ effectiveRole: r, employeeId: 'e' })).toBe(true);
    }
    for (const r of ['manager', 'senior', 'article', 'hr', 'accountant'] as const) {
      expect(mayRemind({ effectiveRole: r, employeeId: 'e' })).toBe(false);
    }
    expect(mayRemind({ effectiveRole: 'partner', employeeId: null })).toBe(false);
    expect(mayRemind(null)).toBe(false);
  });
});

describe('remindMinutes', () => {
  it('reads minutes and hours, decimals included', () => {
    expect(remindMinutes('45', 'min')).toBe(45);
    expect(remindMinutes('2', 'h')).toBe(120);
    expect(remindMinutes('1.5', 'h')).toBe(90);
    expect(remindMinutes('1,5', 'h')).toBe(90);
  });

  it('refuses nothing, zero, nonsense and more than a week', () => {
    expect(remindMinutes('', 'min')).toBeNull();
    expect(remindMinutes('0', 'h')).toBeNull();
    expect(remindMinutes('abc', 'min')).toBeNull();
    expect(remindMinutes('169', 'h')).toBeNull();
    expect(remindMinutes('168', 'h')).toBe(10080);
  });
});

describe('the reminder as a quick task', () => {
  it('labels the time allotted', () => {
    expect(allottedLabel(45)).toBe('45 min');
    expect(allottedLabel(60)).toBe('1 h');
    expect(allottedLabel(90)).toBe('1 h 30 min');
    expect(allottedLabel(2880)).toBe('2 days');
  });

  it('titles it with the note', () => {
    expect(reminderText(30, '  call   the client ')).toEqual({
      title: 'Reminder: call the client',
      details: 'Time allotted: 30 min.',
    });
    expect(reminderText(60, null).title).toBe('Reminder');
  });
});
