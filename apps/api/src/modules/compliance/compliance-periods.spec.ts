import {
  CALENDAR_V2_RULES,
  FIRM_POLICY_RULES,
  seedVersion,
  type SeedRule,
} from './calendar-v2-rules';
import {
  applyVariants,
  conditionHolds,
  dueBand,
  dueForPeriod,
  financialYearOf,
  isTriennialDue,
  legacyPeriodDue,
  passesPeriodFilter,
  periodContaining,
  periodsForFrequency,
  type Period,
} from './compliance-periods';

const NO_HOLIDAYS = new Set<string>();

function rule(code: string): SeedRule {
  const r = [...CALENDAR_V2_RULES, ...FIRM_POLICY_RULES].find((x) => x.code === code);
  if (!r) throw new Error(`no seed rule ${code}`);
  return r;
}

/** The statutory due date of `code` for the period whose key is `key`. */
function due(
  code: string,
  fy: string,
  key: string,
  ctx: Record<string, unknown> = {},
  eventDate?: string,
) {
  const r = rule(code);
  const period = periodsForFrequency(r.frequency, fy).find((p) => p.key === key);
  if (!period) throw new Error(`no period ${key}`);
  const version = applyVariants(seedVersion(r, period.end), ctx);
  return dueForPeriod(version, period, NO_HOLIDAYS, eventDate);
}

describe('compliance-periods', () => {
  describe('periodsForFrequency', () => {
    it('monthly: 12 calendar months Apr → Mar keyed YYYY-MM, tagged by position in the quarter', () => {
      const p = periodsForFrequency('monthly', '2026-27');
      expect(p).toHaveLength(12);
      expect(p[0]).toMatchObject({
        key: '2026-04',
        start: '2026-04-01',
        end: '2026-04-30',
        tags: ['04', 'M1'],
      });
      expect(p[11]).toMatchObject({
        key: '2027-03',
        start: '2027-03-01',
        end: '2027-03-31',
        tags: ['03', 'M3'],
      });
      expect(p[10]!.end).toBe('2027-02-28');
      expect(p[7]!.tags).toContain('M2'); // November
    });
    it('quarterly and half-yearly are keyed on the FY', () => {
      const q = periodsForFrequency('quarterly', '2026-27');
      expect(q.map((x) => x.key)).toEqual(['2026-27:Q1', '2026-27:Q2', '2026-27:Q3', '2026-27:Q4']);
      expect(q[3]).toMatchObject({ start: '2027-01-01', end: '2027-03-31' });
      const h = periodsForFrequency('half_yearly', '2026-27');
      expect(h.map((x) => [x.key, x.end])).toEqual([
        ['2026-27:H1', '2026-09-30'],
        ['2026-27:H2', '2027-03-31'],
      ]);
    });
    it('annual / triennial run on the year; event and on-demand rules have no periods', () => {
      expect(periodsForFrequency('annual', '2026-27')).toEqual([
        expect.objectContaining({
          key: '2026-27',
          start: '2026-04-01',
          end: '2027-03-31',
          tags: ['FY'],
        }),
      ]);
      expect(periodsForFrequency('triennial', '2026-27')).toHaveLength(1);
      expect(periodsForFrequency('event', '2026-27')).toEqual([]);
      expect(periodsForFrequency('on_demand', '2026-27')).toEqual([]);
    });
    it('periodContaining / financialYearOf', () => {
      expect(financialYearOf('2027-03-31')).toBe('2026-27');
      expect(financialYearOf('2026-04-01')).toBe('2026-27');
      expect(periodContaining('quarterly', '2026-11-05')!.key).toBe('2026-27:Q3');
    });
  });

  describe('spec test plan', () => {
    it('TDS deposit: March 2027 → 30 April 2027 (override); October → 7 November', () => {
      expect(due('TDS_CHALLAN', '2026-27', '2027-03')!.statutoryDeadline).toBe('2027-04-30');
      expect(due('TDS_CHALLAN', '2026-27', '2026-10')!.statutoryDeadline).toBe('2026-11-07');
    });
    it('Q4 Form 140 → 31 May 2027; Q1 → 31 July', () => {
      expect(due('TDS_F140', '2026-27', '2026-27:Q4')!.statutoryDeadline).toBe('2027-05-31');
      expect(due('TDS_F140', '2026-27', '2026-27:Q1')!.statutoryDeadline).toBe('2026-07-31');
    });
    it('Form 131 Q4 → 15 June 2027', () => {
      expect(due('TDS_F131', '2026-27', '2026-27:Q4')!.statutoryDeadline).toBe('2027-06-15');
    });
    it('form label follows the version in force at the period end (26Q until Q4 FY 2025-26)', () => {
      const r = rule('TDS_F140');
      expect(seedVersion(r, '2026-03-31').formLabel).toBe('26Q');
      expect(seedVersion(r, '2026-06-30').formLabel).toBe('Form 140');
    });
    it('TCS statement: 15th before the 2026 Rules, 31st after', () => {
      expect(due('TCS_F143', '2025-26', '2025-26:Q2')!.statutoryDeadline).toBe('2025-10-15');
      expect(due('TCS_F143', '2026-27', '2026-27:Q2')!.statutoryDeadline).toBe('2026-10-31');
    });
    it('QRMP Category Y, Q3 FY 2026-27: GSTR-1 13 Jan, GSTR-3B 24 Jan; IFF / PMT-06 only in Oct and Nov', () => {
      const y = { gst_scheme: 'qrmp', qrmp_category: 'Y' };
      expect(due('GST_GSTR1_Q', '2026-27', '2026-27:Q3', y)!.statutoryDeadline).toBe('2027-01-13');
      expect(due('GST_GSTR3B_Q', '2026-27', '2026-27:Q3', y)!.statutoryDeadline).toBe('2027-01-24');
      expect(due('GST_IFF', '2026-27', '2026-10', y)!.statutoryDeadline).toBe('2026-11-13');
      expect(due('GST_PMT06', '2026-27', '2026-11', y)!.statutoryDeadline).toBe('2026-12-25');
      const iff = seedVersion(rule('GST_IFF'), '2026-12-31');
      const months = periodsForFrequency('monthly', '2026-27').filter((p) =>
        passesPeriodFilter(iff.periodFilter, p),
      );
      expect(months.map((p) => p.key)).not.toContain('2026-12');
      expect(months).toHaveLength(8);
    });
    it('QRMP Category X: GSTR-3B on the 22nd', () => {
      expect(
        due('GST_GSTR3B_Q', '2026-27', '2026-27:Q3', { gst_scheme: 'qrmp', qrmp_category: 'X' })!
          .statutoryDeadline,
      ).toBe('2027-01-22');
    });
    it('AOC-4 provisional on a 30 Sep AGM (30 Oct 2027), moves to 25 Oct after AGM on 25 Sep 2027; MGT-7 → 24 Nov', () => {
      const provisional = due('ROC_AOC4', '2026-27', '2026-27', { company_subtype: 'private' });
      expect(provisional).toMatchObject({ statutoryDeadline: '2027-10-30', isProvisional: true });
      const actual = due(
        'ROC_AOC4',
        '2026-27',
        '2026-27',
        { company_subtype: 'private' },
        '2027-09-25',
      );
      expect(actual).toMatchObject({ statutoryDeadline: '2027-10-25', isProvisional: false });
      expect(
        due('ROC_MGT7', '2026-27', '2026-27', { company_subtype: 'private' }, '2027-09-25')!
          .statutoryDeadline,
      ).toBe('2027-11-24');
    });
    it('OPC: AOC-4 180 days from FY end, MGT-7A 60 days after the deemed AGM date', () => {
      const opc = { company_subtype: 'opc' };
      expect(due('ROC_AOC4', '2026-27', '2026-27', opc)).toMatchObject({
        statutoryDeadline: '2027-09-27',
        isProvisional: false,
      });
      expect(due('ROC_MGT7', '2026-27', '2026-27', opc)!.statutoryDeadline).toBe('2027-11-29');
      const v = applyVariants(seedVersion(rule('ROC_MGT7'), '2027-03-31'), opc);
      expect(v.formLabel).toBe('MGT-7A');
    });
    it('LLP Form 11 within 60 days of the FY end (30 May); Form 8 six months + 30 days (30 Oct)', () => {
      expect(due('LLP_FORM11', '2025-26', '2025-26')!.statutoryDeadline).toBe('2026-05-30');
      expect(due('LLP_FORM8', '2025-26', '2025-26')!.statutoryDeadline).toBe('2026-10-30');
      expect(due('LLP_FORM11', '2026-27', '2026-27')!.statutoryDeadline).toBe('2027-05-30');
      expect(due('LLP_FORM8', '2026-27', '2026-27')!.statutoryDeadline).toBe('2027-10-30');
    });
    it('annual returns sit under their FY even when due in the next one', () => {
      expect(due('GST_GSTR9', '2026-27', '2026-27')!.statutoryDeadline).toBe('2027-12-31');
      expect(due('IT_ITR_AUDIT', '2025-26', '2025-26')!.statutoryDeadline).toBe('2026-10-31');
      expect(due('IT_TAX_AUDIT', '2025-26', '2025-26')!.statutoryDeadline).toBe('2026-09-30');
      expect(due('TDS_F130', '2026-27', '2026-27')!.statutoryDeadline).toBe('2027-06-15');
      expect(due('GST_GSTR4', '2026-27', '2026-27')!.statutoryDeadline).toBe('2027-04-30');
      expect(due('IT_ITR_TP', '2026-27', '2026-27')!.statutoryDeadline).toBe('2027-11-30');
    });
    it('half-yearly schedules: ITC-04, MSME-1, PAS-6', () => {
      expect(due('GST_ITC04', '2026-27', '2026-27:H1')!.statutoryDeadline).toBe('2026-10-25');
      expect(due('GST_ITC04', '2026-27', '2026-27:H2')!.statutoryDeadline).toBe('2027-04-25');
      expect(due('ROC_MSME1', '2026-27', '2026-27:H2')!.statutoryDeadline).toBe('2027-04-30');
      expect(due('ROC_PAS6', '2026-27', '2026-27:H1')!.statutoryDeadline).toBe('2026-11-29');
    });
    it('advance tax: 15 Jun, 15 Sep, 15 Dec, 15 Mar', () => {
      expect(
        ['Q1', 'Q2', 'Q3', 'Q4'].map(
          (q) => due('IT_ADVANCE_TAX', '2026-27', `2026-27:${q}`)!.statutoryDeadline,
        ),
      ).toEqual(['2026-06-15', '2026-09-15', '2026-12-15', '2027-03-15']);
    });
    it('LUT for FY 2026-27 by 31 March 2026; DIR-3 KYC 30 June after the cycle year', () => {
      expect(due('GST_LUT', '2026-27', '2026-27')!.statutoryDeadline).toBe('2026-03-31');
      expect(due('ROC_DIR3_KYC', '2026-27', '2026-27')!.statutoryDeadline).toBe('2027-06-30');
    });
    it('board meetings: each quarter end; small / OPC only Q2 and Q4', () => {
      const base = seedVersion(rule('ROC_BOARD_MEETING'), '2026-06-30');
      const quarters = periodsForFrequency('quarterly', '2026-27');
      const keep = (ctx: Record<string, unknown>) =>
        quarters
          .filter((p) => passesPeriodFilter(applyVariants(base, ctx).periodFilter, p))
          .map((p) => p.key);
      expect(keep({ company_subtype: 'private' })).toHaveLength(4);
      expect(keep({ company_subtype: 'small' })).toEqual(['2026-27:Q2', '2026-27:Q4']);
      expect(due('ROC_BOARD_MEETING', '2026-27', '2026-27:Q1')!.statutoryDeadline).toBe(
        '2026-06-30',
      );
    });
    it('event rules have no date until the event is recorded', () => {
      const r = rule('ROC_DIR12');
      const p: Period = periodContaining('annual', '2026-11-03')!;
      expect(dueForPeriod(seedVersion(r, p.end), p, NO_HOLIDAYS, null)).toBeNull();
      expect(
        dueForPeriod(seedVersion(r, p.end), p, NO_HOLIDAYS, '2026-11-03')!.statutoryDeadline,
      ).toBe('2026-12-03');
    });
  });

  describe('dates and holidays', () => {
    it('never shifts the statutory date; pulls the internal date back to a working day', () => {
      // 31 Jan 2027 is a Sunday. Q3 Form 140 stays on the 31st; the 5-day SLA
      // (26 Jan, a holiday) moves back to Monday 25 Jan.
      const r = rule('TDS_F140');
      const q3 = periodsForFrequency('quarterly', '2026-27')[2]!;
      const d = dueForPeriod(seedVersion(r, q3.end), q3, new Set(['2027-01-26']));
      expect(d).toMatchObject({ statutoryDeadline: '2027-01-31', internalSlaDate: '2027-01-25' });
    });
  });

  describe('triennial and conditions', () => {
    it('isTriennialDue', () => {
      expect(isTriennialDue('2025-26', '2025-26')).toBe(true);
      expect(isTriennialDue('2025-26', '2026-27')).toBe(false);
      expect(isTriennialDue('2025-26', '2028-29')).toBe(true);
      expect(isTriennialDue('2025-26', '2024-25')).toBe(false);
    });
    it('conditionHolds reads a missing field as not applicable', () => {
      expect(conditionHolds({ field: 'employer', op: '==', value: true }, {})).toBe(false);
      expect(conditionHolds(null, {})).toBe(true);
    });
    it('ITR variants are mutually exclusive across audit / TP profiles', () => {
      const applies = (code: string, ctx: Record<string, unknown>) =>
        conditionHolds(rule(code).condition, ctx);
      const nonAudit = { audit_case: false, tp_transactions: false };
      const audit = { audit_case: true, tp_transactions: false };
      const tp = { audit_case: true, tp_transactions: true };
      expect(['IT_ITR', 'IT_ITR_AUDIT', 'IT_ITR_TP'].filter((c) => applies(c, nonAudit))).toEqual([
        'IT_ITR',
      ]);
      expect(['IT_ITR', 'IT_ITR_AUDIT', 'IT_ITR_TP'].filter((c) => applies(c, audit))).toEqual([
        'IT_ITR_AUDIT',
      ]);
      expect(['IT_ITR', 'IT_ITR_AUDIT', 'IT_ITR_TP'].filter((c) => applies(c, tp))).toEqual([
        'IT_ITR_TP',
      ]);
    });
  });

  describe('dueBand (sheet colours)', () => {
    it('red within 7 days or overdue, amber within 30, grey when filed', () => {
      expect(dueBand('2026-10-19', '2026-10-12', 'not_started')).toEqual({
        band: 'red',
        daysLeft: 7,
      });
      expect(dueBand('2026-10-01', '2026-10-12', 'in_preparation')).toEqual({
        band: 'red',
        daysLeft: -11,
      });
      expect(dueBand('2026-11-11', '2026-10-12', 'not_started').band).toBe('amber');
      expect(dueBand('2026-12-31', '2026-10-12', 'not_started').band).toBe('none');
      expect(dueBand('2026-10-13', '2026-10-12', 'filed').band).toBe('grey');
    });
  });

  describe('catalogue integrity', () => {
    it('46 recurring + 13 event rules, unique codes, valid encodings', () => {
      const codes = CALENDAR_V2_RULES.map((r) => r.code);
      expect(new Set(codes).size).toBe(codes.length);
      const events = CALENDAR_V2_RULES.filter((r) => r.frequency === 'event');
      // TDS_F141 is a recurring sheet row encoded as an event; the 13 are the Event-Based tab.
      expect(events.filter((r) => r.code !== 'TDS_F141')).toHaveLength(13);
      expect(CALENDAR_V2_RULES.length - events.length + 1).toBe(46);
      for (const r of CALENDAR_V2_RULES) {
        expect(r.code).toMatch(/^[A-Z0-9_]{2,50}$/);
        expect((r.basis === 'schedule') === Boolean(r.schedule)).toBe(true);
        if (r.basis === 'event_date' && r.frequency !== 'annual') expect(r.eventType).toBeTruthy();
        expect(r.versions.length).toBeGreaterThan(0);
      }
    });
  });

  describe('legacyPeriodDue (single-instance generation)', () => {
    it('a schedule rule uses the period containing the reference date', () => {
      const v = seedVersion(rule('TDS_F140'), '2026-12-31');
      expect(
        legacyPeriodDue(v, '2026-27', { referenceDate: '2026-12-31' }, NO_HOLIDAYS)!
          .statutoryDeadline,
      ).toBe('2027-01-31');
      // No date: the year's last period (Q4 → 31 May).
      expect(legacyPeriodDue(v, '2026-27', {}, NO_HOLIDAYS)!.statutoryDeadline).toBe('2027-05-31');
    });

    it('a month override applies (TDS challan for March → 30 Apr)', () => {
      const v = seedVersion(rule('TDS_CHALLAN'), '2027-03-31');
      expect(
        legacyPeriodDue(v, '2026-27', { referenceDate: '2027-03-31' }, NO_HOLIDAYS)!
          .statutoryDeadline,
      ).toBe('2027-04-30');
    });

    it('a plain offset rule stays on the classic path', () => {
      const v = seedVersion(rule('GST_GSTR3B_M'), '2026-10-31');
      expect(
        legacyPeriodDue(v, '2026-27', { referenceDate: '2026-10-31' }, NO_HOLIDAYS),
      ).toBeNull();
    });
  });

  describe('firm-policy rules (Inward reconciliation, Bookkeeping, MIS)', () => {
    it('a regular GSTIN reconciles inward supplies every month, by the 18th', () => {
      const r = rule('GST_ITC_RECON_M');
      expect(periodsForFrequency(r.frequency, '2026-27')).toHaveLength(12);
      expect(due('GST_ITC_RECON_M', '2026-27', '2026-09')).toMatchObject({
        statutoryDeadline: '2026-10-18',
        internalSlaDate: '2026-10-16',
      });
      expect(due('GST_ITC_RECON_M', '2026-27', '2027-02')!.statutoryDeadline).toBe('2027-03-18');
      expect(conditionHolds(r.condition, { gst_scheme: 'regular' })).toBe(true);
      expect(conditionHolds(r.condition, { gst_scheme: 'qrmp' })).toBe(false);
    });

    it('a QRMP GSTIN reconciles once a quarter instead', () => {
      const r = rule('GST_ITC_RECON_Q');
      expect(periodsForFrequency(r.frequency, '2026-27')).toHaveLength(4);
      expect(due('GST_ITC_RECON_Q', '2026-27', '2026-27:Q2')!.statutoryDeadline).toBe('2026-10-18');
      expect(conditionHolds(r.condition, { gst_scheme: 'qrmp' })).toBe(true);
      expect(conditionHolds(r.condition, { gst_scheme: 'regular' })).toBe(false);
    });

    it('books close by the 15th and the MIS pack goes out by the 20th of the next month', () => {
      expect(due('BK_MONTH_CLOSE', '2026-27', '2026-10')!.statutoryDeadline).toBe('2026-11-15');
      expect(due('BK_MONTH_CLOSE', '2026-27', '2027-03')!.statutoryDeadline).toBe('2027-04-15');
      expect(due('MIS_MONTHLY_PACK', '2026-27', '2026-09')!.statutoryDeadline).toBe('2026-10-20');
    });

    it("are the firm's own dates, kept apart from the statutory catalogue", () => {
      for (const r of FIRM_POLICY_RULES) {
        expect(r.dueDateCategory).toBe('HSDG_RECURRING');
        expect(CALENDAR_V2_RULES.some((x) => x.code === r.code)).toBe(false);
      }
    });
  });
});
