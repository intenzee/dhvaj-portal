import type { BoardMeetingCadence, ComplianceEventRecord } from '@hsdg/contracts';
import { formatDate } from '@/lib/format';
import {
  EMPTY_DETAILS,
  cadenceText,
  changeLines,
  defaultEventFy,
  detailsText,
  detailsToForm,
  eventDetailsPayload,
  eventFyOptions,
  eventsForFy,
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

  it('defaults the FY like the API — the previous FY for an AGM', () => {
    expect(defaultEventFy('agm', '2026-09-25')).toBe('2025-26');
    expect(defaultEventFy('agm_extension', '2026-08-01')).toBe('2025-26');
    expect(defaultEventFy('allotment', '2026-09-25')).toBe('2026-27');
    expect(defaultEventFy('allotment', '2027-03-31')).toBe('2026-27');
    expect(defaultEventFy('director_change', '2027-04-01')).toBe('2027-28');
    expect(defaultEventFy('agm', '2027-01-10')).toBe('2025-26');
  });

  it('offers the date’s FY and the two before it', () => {
    expect(eventFyOptions('2026-09-25')).toEqual(['2026-27', '2025-26', '2024-25']);
    expect(eventFyOptions('2000-02-01')).toEqual(['1999-00', '1998-99', '1997-98']);
  });

  it('lists the tab FY’s ROC events and counts the rest', () => {
    const ev = (id: string, eventType: string, financialYear: string | null) =>
      ({ id, eventType, financialYear }) as ComplianceEventRecord;
    const all = [
      ev('a', 'agm', '2025-26'),
      ev('b', 'allotment', '2026-27'),
      ev('c', 'director_change', null),
      ev('d', 'gst_registration', '2025-26'),
    ];
    const r = eventsForFy(all, '2025-26');
    expect(r.shown.map((e) => e.id)).toEqual(['a', 'c']);
    expect(r.otherYears).toBe(1);
    expect(eventsForFy(all, null).shown.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});
