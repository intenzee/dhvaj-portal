import type { ComplianceCalendarRow } from '@hsdg/contracts';
import {
  compactAttributes,
  dayBefore,
  istToday,
  profileAttributeErrors,
} from './compliance-profile';
import { buildRuleContext, eventFinancialYear } from './compliance-generator.service';
import { calendarSheetRows, defaultCalendarWindow } from './compliance-calendar-v2.service';

describe('profile attribute validation', () => {
  it('accepts a well-formed GSTIN profile', () => {
    expect(profileAttributeErrors('gstin', { exporter: true, annualTurnover: 30_000_000 })).toEqual(
      [],
    );
  });

  it('rejects unknown keys and wrong types', () => {
    expect(profileAttributeErrors('tan', { employer: 'yes', exporter: true })).toEqual([
      'employer must be true or false',
      'exporter is not a TAN profile attribute',
    ]);
  });

  it('null clears an attribute and is compacted away', () => {
    expect(profileAttributeErrors('pan', { auditCase: null })).toEqual([]);
    expect(compactAttributes({ auditCase: null, tpTransactions: true })).toEqual({
      tpTransactions: true,
    });
  });

  it('checks company sub-type and directors', () => {
    expect(profileAttributeErrors('cin', { companySubtype: 'llp' })[0]).toMatch(/must be one of/);
    expect(
      profileAttributeErrors('cin', {
        directors: [{ din: '01234567', name: 'A Director', kycCycleStartFy: '2025-26' }],
      }),
    ).toEqual([]);
    expect(
      profileAttributeErrors('cin', {
        directors: [{ din: '123', name: 'A', kycCycleStartFy: '2025-26' }],
      })[0],
    ).toMatch(/DIN must be 8 digits/);
    expect(
      profileAttributeErrors('cin', {
        directors: [{ din: '01234567', name: 'A', kycCycleStartFy: '2025-27' }],
      })[0],
    ).toMatch(/KYC cycle start/);
    const twice = { din: '01234567', name: 'A', kycCycleStartFy: '2025-26' };
    expect(profileAttributeErrors('cin', { directors: [twice, twice] })[0]).toMatch(/listed twice/);
  });

  it('an LLPIN profile takes no attributes', () => {
    expect(profileAttributeErrors('llpin', { anything: true })).toHaveLength(1);
  });
});

describe('dates', () => {
  it('dayBefore crosses month and year ends', () => {
    expect(dayBefore('2026-10-01')).toBe('2026-09-30');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
    expect(dayBefore('2028-03-01')).toBe('2028-02-29');
  });

  it('istToday is the Indian date (UTC+5:30)', () => {
    expect(istToday(new Date('2026-10-12T18:29:00Z'))).toBe('2026-10-12');
    expect(istToday(new Date('2026-10-12T18:31:00Z'))).toBe('2026-10-13');
  });

  it('the default calendar window is this month and the next 11', () => {
    expect(defaultCalendarWindow('2026-10-12')).toEqual({ from: '2026-10-01', to: '2027-09-30' });
    expect(defaultCalendarWindow('2027-01-31')).toEqual({ from: '2027-01-01', to: '2027-12-31' });
  });

  it('an AGM belongs to the previous financial year', () => {
    expect(eventFinancialYear('agm', '2027-09-25')).toBe('2026-27');
    expect(eventFinancialYear('allotment', '2027-09-25')).toBe('2027-28');
    expect(eventFinancialYear('agm', '2027-03-20')).toBe('2025-26');
  });
});

describe('buildRuleContext', () => {
  const company = {
    turnover: 5_000_000,
    entityCategory: 'company',
    entityTypeSlug: 'private_limited',
  };
  const firm = {
    turnover: 5_000_000,
    entityCategory: 'partnership',
    entityTypeSlug: 'partnership',
  };

  it('a company is an audit case and liable to advance tax by default', () => {
    const ctx = buildRuleContext(company, 'pan', null, null, null);
    expect(ctx).toMatchObject({ is_company: true, audit_case: true, advance_tax_liable: true });
  });

  it('a small firm is not an audit case unless its PAN profile says so', () => {
    expect(buildRuleContext(firm, 'pan', null, null, null).audit_case).toBe(false);
    expect(
      buildRuleContext(firm, 'pan', null, null, { attributes: { auditCase: true } }).audit_case,
    ).toBe(true);
    expect(
      buildRuleContext({ ...firm, turnover: 20_000_000 }, 'pan', null, null, null).audit_case,
    ).toBe(true);
  });

  it('tax audit turns on turnover, not on being a company', () => {
    const small = buildRuleContext({ ...company, turnover: 5_000_000 }, 'pan', null, null, null);
    expect(small).toMatchObject({ audit_case: true, tax_audit: false });
    const large = buildRuleContext({ ...firm, turnover: 30_000_000 }, 'pan', null, null, null);
    expect(large).toMatchObject({ audit_case: true, tax_audit: true });
    const optedOut = buildRuleContext({ ...firm, turnover: 30_000_000 }, 'pan', null, null, {
      attributes: { taxAudit: false },
    });
    expect(optedOut).toMatchObject({ audit_case: false, tax_audit: false });
  });

  it('derives the QRMP category from the GSTIN state unless the profile overrides it', () => {
    const mh = { registration_number: '27AAAAA0000A1Z5', state_code: '27' };
    const dl = { registration_number: '07AAAAA0000A1Z5', state_code: '07' };
    expect(buildRuleContext(company, 'gstin', mh, null, null)).toMatchObject({
      gst_scheme: 'regular',
      qrmp_category: 'X',
    });
    expect(buildRuleContext(company, 'gstin', dl, null, null).qrmp_category).toBe('Y');
    expect(
      buildRuleContext(
        company,
        'gstin',
        dl,
        { gst_scheme: 'qrmp', qrmp_category: 'X', attributes: { exporter: true } },
        null,
      ),
    ).toMatchObject({ gst_scheme: 'qrmp', qrmp_category: 'X', exporter: true });
  });

  it('GST turnover falls back to the client turnover', () => {
    const ctx = buildRuleContext(company, 'gstin', null, null, null);
    expect(ctx.gst_turnover).toBe(5_000_000);
  });

  it('maps TAN attributes and leaves GST keys out', () => {
    const ctx = buildRuleContext(
      company,
      'tan',
      null,
      { gst_scheme: null, qrmp_category: null, attributes: { employer: true } },
      null,
    );
    expect(ctx).toMatchObject({ employer: true, pays_non_residents: false, tcs_collector: false });
    expect(ctx).not.toHaveProperty('gst_scheme');
  });

  it('company sub-type defaults from the entity type', () => {
    expect(
      buildRuleContext({ ...company, entityTypeSlug: 'opc' }, 'cin', null, null, null)
        .company_subtype,
    ).toBe('opc');
    expect(
      buildRuleContext({ ...company, entityTypeSlug: 'public_limited' }, 'cin', null, null, null)
        .company_subtype,
    ).toBe('unlisted_public');
    expect(
      buildRuleContext(
        company,
        'cin',
        null,
        { gst_scheme: null, qrmp_category: null, attributes: { companySubtype: 'small' } },
        null,
      ).company_subtype,
    ).toBe('small');
  });
});

describe('calendar export sheet', () => {
  const row = (over: Partial<ComplianceCalendarRow>): ComplianceCalendarRow => ({
    id: 'i',
    engagementId: 'e',
    engagementCode: 'CR-1',
    entityId: 'n',
    entityName: 'Acme Pvt Ltd',
    officeCode: 'DEL',
    stream: 'gst',
    ruleCode: 'GST_GSTR3B_M',
    ruleName: 'GSTR-3B monthly',
    formLabel: 'GSTR-3B',
    registrationId: 'r',
    registrationType: 'gstin',
    registrationNumber: '07AAAAA0000A1Z5',
    financialYear: '2026-27',
    periodKey: '2026-09',
    periodLabel: 'Sep 2026',
    dueDate: '2026-10-20',
    originalDueDate: null,
    extensionReference: null,
    internalDate: '2026-10-17',
    workflowStatus: 'in_preparation',
    daysLeft: 8,
    band: 'amber',
    isProvisional: false,
    isOptional: false,
    needsVerification: false,
    profileChanged: false,
    assigneeId: null,
    assigneeName: 'A Manager',
    partnerName: null,
    managerName: null,
    section: null,
    link: { engagementId: 'e', engagementKind: 'compliance', instanceId: 'i' },
    ...over,
  });

  it('has the sheet columns in order', () => {
    const [header, first] = calendarSheetRows([row({})]);
    expect(header).toEqual([
      'Due date',
      'Day',
      'Client',
      'Registration',
      'Form',
      'Period',
      'Status',
      'Days left',
      'Assignee',
      'Stream',
      'Flag',
    ]);
    expect(first).toEqual([
      '2026-10-20',
      'Tue',
      'Acme Pvt Ltd',
      '07AAAAA0000A1Z5',
      'GSTR-3B',
      'Sep 2026',
      'In preparation',
      8,
      'A Manager',
      'gst',
      '',
    ]);
  });

  it('collects the flags', () => {
    const [, r] = calendarSheetRows([
      row({
        band: 'red',
        daysLeft: -3,
        isProvisional: true,
        extensionReference: 'CBDT Circular (28 Sep 2026)',
        needsVerification: true,
        profileChanged: true,
      }),
    ]);
    expect(r![10]).toBe(
      'Overdue 3 days; Provisional date; Extended (CBDT Circular (28 Sep 2026)); Verify; Profile changed — check',
    );
  });
});
