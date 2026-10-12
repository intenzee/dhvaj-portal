import {
  canFlags,
  checkFiledOn,
  checkReference,
  defaultReferenceKind,
  fyMonths,
  indicativeLateCharges,
  isAnnualKey,
  lastMonthOfQuarter,
  lockState,
  nextActionText,
  periodLabel,
  quarterOfMonth,
  undoAllowed,
} from './filing-rules';

describe('filing rules', () => {
  it('defaults the reference kind by stream', () => {
    expect(defaultReferenceKind('gst')).toBe('arn');
    expect(defaultReferenceKind('roc')).toBe('srn');
    expect(defaultReferenceKind('tds')).toBe('token');
    expect(defaultReferenceKind('income_tax')).toBe('ack');
    expect(defaultReferenceKind(null)).toBe('internal');
    expect(defaultReferenceKind('gst', 'outward')).toBe('arn');
    expect(defaultReferenceKind('gst', 'inward')).toBe('internal');
    expect(defaultReferenceKind('bookkeeping')).toBe('internal');
  });

  it('checks a GST ARN is 15 upper-case alphanumerics, and normalises it', () => {
    expect(checkReference('arn', ' aa19 0926 1234567 ', 'gst')).toEqual({
      value: 'AA1909261234567',
    });
    expect(checkReference('arn', 'AA19092612345', 'gst')).toHaveProperty('error');
    expect(checkReference('arn', 'AA19092612345-7', 'gst')).toHaveProperty('error');
    expect(checkReference('srn', 'F12345678', 'roc')).toEqual({ value: 'F12345678' });
    expect(checkReference('ack', 'x', 'income_tax')).toHaveProperty('error');
  });

  it('checks the filing date is not in the future nor before the period ends', () => {
    expect(checkFiledOn('2026-10-10', '2026-10-12', '2026-09-30')).toBeNull();
    expect(checkFiledOn('2026-10-13', '2026-10-12', '2026-09-30')).toMatch(/future/);
    expect(checkFiledOn('2026-09-29', '2026-10-12', '2026-09-30')).toMatch(/before the period/);
    expect(checkFiledOn('10/10/2026', '2026-10-12', null)).toMatch(/date/);
  });

  it('lets a lead undo within 24 hours, a partner any time', () => {
    const recordedAt = new Date('2026-10-10T10:00:00Z');
    expect(
      undoAllowed({
        isLead: true,
        isPartner: false,
        recordedAt,
        now: new Date('2026-10-11T09:00:00Z'),
      }).ok,
    ).toBe(true);
    expect(
      undoAllowed({
        isLead: true,
        isPartner: false,
        recordedAt,
        now: new Date('2026-10-11T11:00:00Z'),
      }).ok,
    ).toBe(false);
    expect(
      undoAllowed({
        isLead: false,
        isPartner: true,
        recordedAt,
        now: new Date('2026-12-01T00:00:00Z'),
      }).ok,
    ).toBe(true);
    expect(undoAllowed({ isLead: false, isPartner: false, recordedAt, now: recordedAt }).ok).toBe(
      false,
    );
  });

  it('locks filed / waived filings, and Outward + Inward once the month’s 3B is filed', () => {
    expect(
      lockState({ workflowStatus: 'filed', section: 'summary', summaryFiledLabel: null }).isLocked,
    ).toBe(true);
    expect(
      lockState({ workflowStatus: 'not_applicable', section: null, summaryFiledLabel: null })
        .isLocked,
    ).toBe(true);
    expect(
      lockState({
        workflowStatus: 'in_preparation',
        section: 'outward',
        summaryFiledLabel: 'GSTR-3B Oct 2026',
      }),
    ).toEqual({
      isLocked: true,
      reason: 'GSTR-3B Oct 2026 is filed for this period.',
    });
    expect(
      lockState({ workflowStatus: 'in_preparation', section: 'summary', summaryFiledLabel: 'x' })
        .isLocked,
    ).toBe(false);
  });

  it('lets the assignee lodge only when Ready to file; a lead any time; only a lead waives', () => {
    const base = {
      isLead: false,
      isPartner: false,
      isAssignee: true,
      isMember: true,
      workflowStatus: 'in_review',
      isLocked: false,
      hasLiveFiling: false,
      liveRecordedAt: null,
      now: new Date(),
    };
    expect(canFlags(base)).toEqual({ lodge: false, undo: false, waive: false, edit: true });
    expect(canFlags({ ...base, workflowStatus: 'ready_to_file' }).lodge).toBe(true);
    expect(canFlags({ ...base, isAssignee: false, isLead: true })).toMatchObject({
      lodge: true,
      waive: true,
    });
    expect(canFlags({ ...base, isLead: true, workflowStatus: 'not_applicable' }).lodge).toBe(false);
    expect(
      canFlags({
        ...base,
        isLead: true,
        hasLiveFiling: true,
        liveRecordedAt: new Date(),
        workflowStatus: 'filed',
        isLocked: true,
      }),
    ).toEqual({ lodge: false, undo: true, waive: false, edit: false });
  });

  it('lays out the financial year and its quarters', () => {
    const months = fyMonths('2026-27');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-04');
    expect(months[11]).toBe('2027-03');
    expect(quarterOfMonth('2026-04')).toBe('Q1');
    expect(quarterOfMonth('2026-12')).toBe('Q3');
    expect(quarterOfMonth('2027-03')).toBe('Q4');
    expect(lastMonthOfQuarter('2026-27', 'Q1')).toBe('2026-06');
    expect(lastMonthOfQuarter('2026-27', 'Q4')).toBe('2027-03');
  });

  it('labels periods and tells annual keys from months', () => {
    expect(periodLabel('2026-10')).toBe('Oct 2026');
    expect(periodLabel('2026-27')).toBe('FY 2026-27');
    expect(periodLabel('2026-27:Q2')).toBe('Q2 2026-27');
    expect(periodLabel('2026-27:H1')).toBe('H1 2026-27');
    expect(periodLabel('2026-27:DIN:01234567')).toBe('FY 2026-27 · DIN 01234567');
    expect(isAnnualKey('2026-27')).toBe(true);
    expect(isAnnualKey('2026-27:H2')).toBe(true);
    expect(isAnnualKey('2026-10')).toBe(false);
    expect(isAnnualKey('2026-27:Q1')).toBe(false);
  });

  it('writes the next action line', () => {
    const base = { label: 'GSTR-3B', today: '2026-10-16', workflowStatus: 'in_preparation' };
    expect(
      nextActionText({ ...base, dueDate: '2026-10-20', pendingLabel: 'ITC reconciliation' }),
    ).toBe('GSTR-3B due in 4 days — ITC reconciliation pending');
    expect(nextActionText({ ...base, dueDate: '2026-10-15', pendingLabel: null })).toBe(
      'GSTR-3B overdue by 1 day',
    );
    expect(
      nextActionText({
        ...base,
        dueDate: '2026-10-16',
        pendingLabel: null,
        workflowStatus: 'ready_to_file',
      }),
    ).toBe('GSTR-3B due today — ready to file');
  });

  it('estimates GST late fee and interest only once past due', () => {
    expect(
      indicativeLateCharges({
        dueDate: '2026-10-20',
        asOf: '2026-10-20',
        isNil: false,
        taxPayable: 1000,
      }),
    ).toBeNull();
    expect(
      indicativeLateCharges({
        dueDate: '2026-10-20',
        asOf: '2026-10-30',
        isNil: false,
        taxPayable: 36500,
      }),
    ).toEqual({
      daysLate: 10,
      lateFee: 500,
      interest: 180,
    });
    expect(
      indicativeLateCharges({
        dueDate: '2026-10-20',
        asOf: '2026-10-22',
        isNil: true,
        taxPayable: null,
      }),
    ).toEqual({
      daysLate: 2,
      lateFee: 40,
      interest: null,
    });
  });
});
