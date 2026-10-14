import {
  boardMeetingCadence,
  chargeFilingWindow,
  eventContext,
  rocEmptyMessage,
  validateEventDetails,
  withAgmExtension,
} from './compliance-events';
import { applicableItems } from './compliance-checklist';
import { mergeSummaries, eventFinancialYear } from './compliance-generator.service';
import { applyDirectorChange } from './compliance-calendar-v2.service';
import { checkFiledOn, meetingReference } from '../filing-workspace/filing-rules';
import type { PeriodRuleVersion } from './compliance-periods';

const version = (over: Partial<PeriodRuleVersion> = {}): PeriodRuleVersion => ({
  calculationBasis: 'period_end',
  frequency: 'annual',
  offsetMonths: 0,
  offsetDays: 0,
  fixedMonth: null,
  fixedDay: null,
  workingDayAdjustment: 'none',
  internalSlaOffsetDays: 0,
  schedule: null,
  periodOverrides: null,
  periodFilter: null,
  provisionalEventRule: null,
  eventType: null,
  formLabel: null,
  section: null,
  isOptional: false,
  condition: null,
  variants: null,
  ...over,
});

describe('event details (spec §6.2)', () => {
  it('keeps the AGM auditor flag and the allotment placement flag', () => {
    expect(validateEventDetails('agm', { auditorAppointed: true, junk: 1 })).toEqual({
      details: { auditorAppointed: true },
    });
    expect(validateEventDetails('allotment', { privatePlacement: false })).toEqual({
      details: { privatePlacement: false },
    });
  });

  it('an AGM extension is 1–3 whole months', () => {
    expect(validateEventDetails('agm_extension', { months: 3, approvalRef: ' GNL-1/22 ' })).toEqual({
      details: { months: 3, approvalRef: 'GNL-1/22' },
    });
    expect(validateEventDetails('agm_extension', { months: 4 })).toHaveProperty('error');
    expect(validateEventDetails('agm_extension', { months: 1.5 })).toHaveProperty('error');
    expect(validateEventDetails('agm_extension', {})).toHaveProperty('error');
  });

  it('a director change needs an 8-digit DIN and appointed / ceased', () => {
    expect(
      validateEventDetails('director_change', { din: '01234567', change: 'appointed', name: ' A ' }),
    ).toEqual({ details: { din: '01234567', change: 'appointed', name: 'A' } });
    expect(validateEventDetails('director_change', { din: '1234', change: 'appointed' })).toEqual({
      error: expect.stringContaining('DIN'),
    });
    expect(validateEventDetails('director_change', { din: '01234567', change: 'left' })).toHaveProperty(
      'error',
    );
  });

  it('a charge amount cannot be negative; other events take no details', () => {
    expect(validateEventDetails('charge_creation', { amount: -1 })).toHaveProperty('error');
    expect(validateEventDetails('charge_creation', { chargeHolder: 'SBI', amount: 5e6 })).toEqual({
      details: { chargeHolder: 'SBI', amount: 5e6 },
    });
    expect(validateEventDetails('incorporation', { anything: true })).toEqual({ details: {} });
    expect(validateEventDetails('agm', null)).toEqual({ details: {} });
  });
});

describe('event context for the rules', () => {
  it('prefixes each scalar detail with the event type, snake_case', () => {
    expect(
      eventContext({ event_type: 'agm', details: { auditorAppointed: true } }),
    ).toEqual({ agm_auditor_appointed: true });
    expect(
      eventContext({ event_type: 'allotment', details: { privatePlacement: false, x: { a: 1 } } }),
    ).toEqual({ allotment_private_placement: false });
    expect(eventContext(null)).toEqual({});
  });

  it('an AGM (and its extension) belongs to the year before the meeting', () => {
    expect(eventFinancialYear('agm', '2026-09-30')).toBe('2025-26');
    expect(eventFinancialYear('agm_extension', '2026-08-15')).toBe('2025-26');
    expect(eventFinancialYear('allotment', '2026-11-10')).toBe('2026-27');
  });
});

describe('AGM extension (P2-2)', () => {
  it('moves the AGM itself by the months granted, keeping the day (30 Sep → 30 Dec)', () => {
    const v = withAgmExtension(version({ offsetMonths: 6 }), 'ROC_AGM', 3);
    expect(v.periodOverrides).toEqual({ '03': { month: 12, day: 30, year_offset: 0 } });
    expect(v.offsetMonths).toBe(9);
  });

  it('moves the provisional AGM date the AGM-linked forms run from', () => {
    const aoc4 = version({
      eventType: 'agm',
      provisionalEventRule: { month: 9, day: 30, year_offset: 1 },
    });
    expect(withAgmExtension(aoc4, 'ROC_AOC4', 3).provisionalEventRule).toEqual({
      month: 12,
      day: 30,
      year_offset: 1,
    });
    // across the year end, clamped to the month
    const late = version({ eventType: 'agm', provisionalEventRule: { month: 11, day: 30 } });
    expect(withAgmExtension(late, 'ROC_MGT7', 3).provisionalEventRule).toEqual({
      month: 2,
      day: 28,
      year_offset: 1,
    });
  });

  it('leaves other rules (and no extension) alone', () => {
    const v = version({ offsetMonths: 1 });
    expect(withAgmExtension(v, 'ROC_DPT3', 3)).toBe(v);
    expect(withAgmExtension(v, 'ROC_AGM', 0)).toBe(v);
  });
});

describe('CHG-1 window (P2-3)', () => {
  it('on time to day 30, fee window to day 90, then beyond', () => {
    expect(chargeFilingWindow('2026-12-01', '2026-12-31')).toEqual({
      status: 'on_time',
      feeWindowEnds: '2027-03-01',
      day: 30,
    });
    expect(chargeFilingWindow('2026-12-01', '2027-01-01').status).toBe('fee_window');
    expect(chargeFilingWindow('2026-12-01', '2027-03-01').status).toBe('fee_window');
    expect(chargeFilingWindow('2026-12-01', '2027-03-02').status).toBe('beyond_window');
  });
});

describe('next board meeting (P2-6)', () => {
  const reg = { id: 'r1', number: 'U12345MH2020PTC123456' };

  it('general rule: within 120 days of the last meeting', () => {
    expect(boardMeetingCadence(reg, ['2026-05-15', '2026-09-14'], 'private')).toMatchObject({
      lastHeldOn: '2026-09-14',
      dueBy: '2027-01-12',
      notBefore: null,
      rule: 'every_120_days',
    });
  });

  it('small company / OPC: the next calendar half, at least 90 days apart', () => {
    expect(boardMeetingCadence(reg, ['2026-05-15'], 'small')).toMatchObject({
      dueBy: '2026-12-31',
      notBefore: '2026-08-13',
      rule: 'calendar_half',
    });
    expect(boardMeetingCadence(reg, ['2026-10-01'], 'opc').dueBy).toBe('2027-06-30');
  });

  it('no meetings yet: no date, just the rule', () => {
    expect(boardMeetingCadence(reg, [], null)).toMatchObject({ lastHeldOn: null, dueBy: null });
  });
});

describe('ROC tab empty state (G13)', () => {
  it('asks for the CIN on a company, explains for a firm', () => {
    expect(rocEmptyMessage('company', 0)).toMatch(/Add the CIN/);
    expect(rocEmptyMessage('llp', 0)).toMatch(/LLPIN/);
    expect(rocEmptyMessage('partnership_firm', 0)).toMatch(/not registered with the MCA/);
    expect(rocEmptyMessage('company', 1)).toBeNull();
  });
});

describe('DIR-12 keeps the directors list current', () => {
  const asha = { din: '11111111', name: 'Asha', kycCycleStartFy: '2024-25' };
  const fb = { kycFy: '2026-27' };

  it('adds an appointed director (KYC cycle from the year of appointment) and removes a ceased one', () => {
    expect(
      applyDirectorChange([asha], { din: '22222222', name: 'Ravi', change: 'appointed' }, false, fb),
    ).toEqual([asha, { din: '22222222', name: 'Ravi', kycCycleStartFy: '2026-27' }]);
    expect(applyDirectorChange([asha], { din: '11111111', change: 'ceased' }, false, fb)).toEqual([]);
  });

  it('undo reverses it, restoring the director as last recorded', () => {
    const added = applyDirectorChange([asha], { din: '22222222', name: 'R', change: 'appointed' }, false, fb);
    expect(applyDirectorChange(added, { din: '22222222', change: 'appointed' }, true, fb)).toEqual([asha]);
    expect(
      applyDirectorChange([], { din: '11111111', change: 'ceased' }, true, { ...fb, known: asha }),
    ).toEqual([asha]);
  });

  it('an appointment needs the director’s name', () => {
    expect(validateEventDetails('director_change', { din: '22222222', change: 'appointed' })).toEqual({
      error: expect.stringContaining('name'),
    });
    expect(validateEventDetails('director_change', { din: '22222222', change: 'ceased' })).toEqual({
      details: { din: '22222222', change: 'ceased' },
    });
  });
});

describe('checklist onlyIf reads event details', () => {
  const items = [
    { code: 'CONSENT', label: 'DIR-2', onlyIf: 'director_change_change=appointed' },
    { code: 'RESIGNATION', label: 'Resignation', onlyIf: 'director_change_change=ceased' },
    { code: 'PAS4', label: 'PAS-4', onlyIf: 'allotment_private_placement' },
    { code: 'ALWAYS', label: 'Resolution' },
  ];

  it('key=value matches a text detail; a bare key needs true', () => {
    expect(
      applicableItems(items, { director_change_change: 'ceased' }).map((i) => i.code),
    ).toEqual(['RESIGNATION', 'ALWAYS']);
    expect(
      applicableItems(items, { allotment_private_placement: true }).map((i) => i.code),
    ).toEqual(['PAS4', 'ALWAYS']);
  });
});

describe('meetings close as meetings (P1-2)', () => {
  it('a board meeting held on 15 May records against Apr–Jun (E7)', () => {
    expect(checkFiledOn('2026-05-15', '2026-10-14', '2026-06-30', { periodStart: '2026-04-01' })).toBeNull();
    expect(checkFiledOn('2026-05-15', '2026-10-14', '2026-06-30')).toMatch(/before the period ends/);
  });

  it('but not before the period starts, nor in the future', () => {
    expect(checkFiledOn('2026-03-31', '2026-10-14', '2026-06-30', { periodStart: '2026-04-01' })).toMatch(
      /before the period starts/,
    );
    expect(checkFiledOn('2026-10-20', '2026-10-14', null, { periodStart: null })).toMatch(/future/);
  });

  it('defaults to an internal reference', () => {
    expect(meetingReference('2026-09-30')).toBe('MTG-2026-09-30');
    expect(/^[A-Z0-9/-]{3,40}$/.test(meetingReference('2026-09-30'))).toBe(true);
  });
});

describe('generator summaries merge', () => {
  it('adds the counts and concatenates the ids', () => {
    const a = {
      created: 1,
      moved: 1,
      flagged: 0,
      notApplicable: 0,
      createdIds: ['a'],
      movedItems: [{ id: 'm', from: '2026-10-30', to: '2026-10-25' }],
      flaggedIds: [],
      notApplicableIds: [],
    };
    const b = { ...a, created: 0, createdIds: [], moved: 0, movedItems: [], flagged: 1, flaggedIds: ['f'] };
    expect(mergeSummaries(a, b)).toMatchObject({
      created: 1,
      moved: 1,
      flagged: 1,
      createdIds: ['a'],
      flaggedIds: ['f'],
    });
  });
});
