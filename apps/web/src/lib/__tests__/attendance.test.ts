import type { DayEntry } from '@hsdg/contracts';
import { categoryLabel, entryTitle, minutesLabel } from '../attendance';

const row = (patch: Partial<DayEntry>): DayEntry =>
  ({
    id: 'r1',
    source: 'internal',
    engagementId: null,
    engagementCode: null,
    clientName: null,
    streamName: null,
    taskId: null,
    taskTitle: null,
    category: 'other',
    note: null,
    seconds: 3600,
    location: 'office',
    running: false,
    editable: true,
    locationOnly: false,
    billed: false,
    startedAt: '2026-11-13T05:00:00Z',
    ...patch,
  }) as DayEntry;

describe('entryTitle', () => {
  it('reads a task of your own by its name', () => {
    expect(entryTitle(row({ taskTitle: 'Firm’s bank reconciliation' }), categoryLabel)).toBe(
      'Firm’s bank reconciliation',
    );
  });

  it('reads other firm work by its kind', () => {
    expect(entryTitle(row({ category: 'training' }), categoryLabel)).toBe('Firm work · Training');
  });

  it('reads client work as client · stream · task', () => {
    expect(
      entryTitle(
        row({
          source: 'logged',
          clientName: 'Drift Logistics',
          streamName: 'GST',
          taskTitle: 'GSTR-3B Oct',
        }),
        categoryLabel,
      ),
    ).toBe('Drift Logistics · GST · GSTR-3B Oct');
  });
});

describe('minutesLabel', () => {
  it('says hours and minutes', () => {
    expect(minutesLabel(90)).toBe('1h 30m');
    expect(minutesLabel(45)).toBe('45m');
    expect(minutesLabel(120)).toBe('2h');
  });
});
