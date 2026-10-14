import type { BoardMeetingCadence } from '@hsdg/contracts';
import { formatDate } from '@/lib/format';
import {
  EMPTY_DETAILS,
  cadenceText,
  changeLines,
  detailsText,
  detailsToForm,
  eventDetailsPayload,
} from '../roc-events';

describe('ROC events panel', () => {
  it('sends only the event’s own details', () => {
    const f = { ...EMPTY_DETAILS, auditorAppointed: true, din: ' 01234567 ', name: 'Ravi' };
    expect(eventDetailsPayload('agm', f)).toEqual({ auditorAppointed: true });
    expect(eventDetailsPayload('director_change', f)).toEqual({
      din: '01234567',
      change: 'appointed',
      name: 'Ravi',
    });
    expect(eventDetailsPayload('agm_extension', { ...f, months: '2' })).toEqual({ months: 2 });
    expect(eventDetailsPayload('charge_creation', { ...f, amount: '' })).toEqual({});
    expect(eventDetailsPayload('incorporation', f)).toEqual({});
  });

  it('round-trips recorded details into the correction form', () => {
    const d = { din: '01234567', change: 'ceased', months: 3, privatePlacement: true };
    const f = detailsToForm(d);
    expect(f).toMatchObject({ din: '01234567', change: 'ceased', months: '3', privatePlacement: true });
    expect(eventDetailsPayload('director_change', f)).toEqual({ din: '01234567', change: 'ceased' });
  });

  it('describes details and what changed in words', () => {
    expect(detailsText('agm', { auditorAppointed: true })).toBe('Auditor appointed / re-appointed');
    expect(detailsText('director_change', { din: '01234567', name: 'Ravi', change: 'appointed' })).toBe(
      'Ravi, DIN 01234567 (appointed)',
    );
    expect(
      changeLines({
        created: [{ instanceId: 'a', label: 'ADT-1', dueDate: '2026-10-15' }],
        moved: [{ instanceId: 'b', label: 'MGT-7', from: '2026-11-24', to: '2026-11-27' }],
        flagged: [{ instanceId: 'c', label: 'AOC-4' }],
        notApplicable: [],
      }),
    ).toEqual([
      `ADT-1 created, due ${formatDate('2026-10-15')}`,
      `MGT-7 moved ${formatDate('2026-11-24')} → ${formatDate('2026-11-27')}`,
      'AOC-4 already started — flagged “Profile changed — check”',
    ]);
    expect(changeLines(undefined)).toEqual([]);
  });

  it('says when the next board meeting is due', () => {
    const b: BoardMeetingCadence = {
      registrationId: 'r',
      registrationNumber: 'U1',
      lastHeldOn: '2026-05-15',
      dueBy: '2026-09-12',
      notBefore: null,
      rule: 'every_120_days',
    };
    expect(cadenceText(b)).toBe(
      `Next board meeting by ${formatDate('2026-09-12')} (last held ${formatDate('2026-05-15')})`,
    );
    expect(cadenceText({ ...b, lastHeldOn: null, dueBy: null, rule: 'calendar_half' })).toMatch(
      /each half of the calendar year/,
    );
  });
});
