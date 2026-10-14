import {
  dscWarningText,
  resolveCinFacts,
  rocLateCharges,
  rocLateMultiple,
  rocNormalFee,
  smallCompanyTest,
} from '@hsdg/contracts';
import { applicableItems, checklistAttributes } from './compliance-checklist';
import { buildRuleContext } from './compliance-generator.service';
import { profileAttributeErrors } from './compliance-profile';
import { ROC_CHECKLISTS } from './roc-checklists';
import { CALENDAR_V2_RULES } from './calendar-v2-rules';

const CR = 10_000_000;

describe('small-company test (G12)', () => {
  it('small only when paid-up ≤ ₹10 cr and turnover ≤ ₹100 cr', () => {
    expect(smallCompanyTest({ paidUpCapital: 1 * CR, turnover: 20 * CR })).toBe('small');
    expect(smallCompanyTest({ paidUpCapital: 10 * CR, turnover: 100 * CR })).toBe('small');
    expect(smallCompanyTest({ paidUpCapital: 11 * CR, turnover: 1 * CR })).toBe('not_small');
    expect(smallCompanyTest({ paidUpCapital: 1 * CR, turnover: 101 * CR })).toBe('not_small');
  });
  it('a holding company is never small; a missing figure cannot tell', () => {
    expect(
      smallCompanyTest({ paidUpCapital: 1 * CR, turnover: 1 * CR, hasSubsidiaries: true }),
    ).toBe('not_small');
    expect(smallCompanyTest({ paidUpCapital: 1 * CR, turnover: null })).toBe('unknown');
    expect(smallCompanyTest({ paidUpCapital: undefined, turnover: 1 * CR })).toBe('unknown');
    // One figure over the limit is enough to say not small.
    expect(smallCompanyTest({ paidUpCapital: null, turnover: 200 * CR })).toBe('not_small');
  });
});

describe('resolveCinFacts', () => {
  const privateCo = { subtype: 'private', turnover: 5 * CR };
  it('a private company within the limits defaults to small (derived, Verify)', () => {
    const f = resolveCinFacts({ paidUpCapital: 0.5 * CR }, privateCo);
    expect(f).toMatchObject({ companySubtype: 'small', subtypeDerived: true });
  });
  it('a stated sub-type wins; a public company or OPC is never derived small', () => {
    expect(
      resolveCinFacts({ companySubtype: 'private', paidUpCapital: 0.5 * CR }, privateCo),
    ).toMatchObject({ companySubtype: 'private', subtypeDerived: false });
    expect(
      resolveCinFacts({ paidUpCapital: 0.5 * CR }, { subtype: 'unlisted_public', turnover: 1 }),
    ).toMatchObject({ companySubtype: null, subtypeDerived: false });
  });
  it('missing paid-up capital leaves the sub-type to the entity type', () => {
    expect(resolveCinFacts({}, privateCo).companySubtype).toBeNull();
  });
  it('XBRL and MGT-8 default from the thresholds; stated facts win', () => {
    const big = resolveCinFacts(
      { paidUpCapital: 6 * CR },
      { subtype: 'private', turnover: 60 * CR },
    );
    expect(big).toMatchObject({
      xbrlRequired: true,
      xbrlDerived: true,
      mgt8Required: true,
      mgt8Derived: true,
    });
    const stated = resolveCinFacts(
      { paidUpCapital: 6 * CR, xbrlRequired: false },
      { subtype: 'private', turnover: 1 * CR },
    );
    expect(stated).toMatchObject({ xbrlRequired: false, xbrlDerived: false, mgt8Required: false });
    expect(resolveCinFacts({}, { subtype: 'listed', turnover: null }).xbrlRequired).toBe(true);
  });
  it('the profile turnover overrides the client turnover', () => {
    expect(resolveCinFacts({ paidUpCapital: 1 * CR, turnover: 200 * CR }, privateCo)).toMatchObject(
      { turnover: 200 * CR, companySubtype: null, xbrlRequired: true },
    );
  });
});

describe('buildRuleContext — CIN facts (P1-7)', () => {
  const company = {
    turnover: 5 * CR,
    turnoverKnown: true,
    entityCategory: 'company',
    entityTypeSlug: 'private_limited',
  };
  const cin = (attributes: Record<string, unknown>) =>
    buildRuleContext(
      company,
      'cin',
      null,
      { gst_scheme: null, qrmp_category: null, attributes },
      null,
    );
  it('G7: deposits unknown stays null (DPT-3 kept); false drops it', () => {
    expect(cin({}).deposits).toBeNull();
    expect(cin({ depositsOrExemptedLoans: false }).deposits).toBe(false);
  });
  it('G12: small within the limits; a holding company stays private', () => {
    expect(cin({ paidUpCapital: 1 * CR }).company_subtype).toBe('small');
    expect(cin({ paidUpCapital: 1 * CR, hasSubsidiaries: true }).company_subtype).toBe('private');
    expect(
      buildRuleContext(
        { ...company, turnoverKnown: false },
        'cin',
        null,
        { gst_scheme: null, qrmp_category: null, attributes: { paidUpCapital: 1 * CR } },
        null,
      ).company_subtype,
    ).toBe('private');
  });
  it('exposes the new facts to the rules and drops the retired auditor flag', () => {
    const ctx = cin({ xbrlRequired: true, csrApplicable: true, authorisedCapital: 50 * CR });
    expect(ctx).toMatchObject({
      xbrl_required: true,
      has_subsidiaries: false,
      csr_applicable: true,
      secretarial_audit_required: false,
      authorised_capital: 50 * CR,
    });
    expect(ctx).not.toHaveProperty('auditor_appointed_at_agm');
  });
});

describe('ROC late fee (P1-8, P2-4)', () => {
  it('E16: AOC-4 due 30 Oct 2026 lodged 9 Nov 2026 — 10 days, ₹1,000', () => {
    expect(
      rocLateCharges({
        ruleCode: 'ROC_AOC4',
        dueDate: '2026-10-30',
        asOf: '2026-11-09',
        authorisedCapital: null,
      }),
    ).toEqual({ daysLate: 10, lateFee: 1000, interest: null, basis: 'per_day' });
  });
  it('MGT-7 and LLP forms run at ₹100 a day; LLP marked Verify', () => {
    expect(
      rocLateCharges({
        ruleCode: 'ROC_MGT7',
        dueDate: '2026-11-29',
        asOf: '2026-12-01',
        authorisedCapital: null,
      })!.lateFee,
    ).toBe(200);
    expect(
      rocLateCharges({
        ruleCode: 'LLP_FORM11',
        dueDate: '2026-05-30',
        asOf: '2026-06-04',
        authorisedCapital: null,
      }),
    ).toMatchObject({ lateFee: 500, verify: true });
  });
  it('not late, or a form with no estimate → null', () => {
    const base = { dueDate: '2026-10-30', authorisedCapital: null };
    expect(rocLateCharges({ ...base, ruleCode: 'ROC_AOC4', asOf: '2026-10-30' })).toBeNull();
    expect(rocLateCharges({ ...base, ruleCode: 'ROC_AGM', asOf: '2026-12-30' })).toBeNull();
    // A normal-fee form needs the authorised capital for the slab.
    expect(rocLateCharges({ ...base, ruleCode: 'ROC_ADT1', asOf: '2026-12-30' })).toBeNull();
  });
  it('the normal fee paid at lodge wins over the schedule (no Verify)', () => {
    const late = rocLateCharges({
      ruleCode: 'ROC_CHG1',
      dueDate: '2026-10-30',
      asOf: '2026-11-09',
      authorisedCapital: 50_000,
      normalFeePaid: 600,
    })!;
    expect(late).toMatchObject({ basis: 'slab', normalFee: 600 });
    expect(late.lateFee).toBe(600 * late.multiple!);
    expect(late.verify).toBeUndefined();
  });
  it('normal-fee forms: the slab multiple of the fee by authorised capital (Verify)', () => {
    expect(rocNormalFee(50_000)).toBe(200);
    expect(rocNormalFee(100_000)).toBe(300);
    expect(rocNormalFee(2_000_000)).toBe(400);
    expect(rocNormalFee(5_000_000)).toBe(500);
    expect(rocNormalFee(10_000_000)).toBe(600);
    expect([1, 30, 31, 60, 90, 91, 180, 181].map(rocLateMultiple)).toEqual([
      2, 2, 4, 4, 6, 10, 10, 12,
    ]);
    expect(
      rocLateCharges({
        ruleCode: 'ROC_ADT1',
        dueDate: '2026-10-15',
        asOf: '2026-12-01',
        authorisedCapital: 1_000_000,
      }),
    ).toEqual({
      daysLate: 47,
      lateFee: 1600,
      interest: null,
      basis: 'slab',
      normalFee: 400,
      multiple: 4,
      verify: true,
    });
  });
});

describe('DSC expiry (P2-5)', () => {
  const directors = [
    { din: '01234567', name: 'A Kumar', kycCycleStartFy: '2025-26', dscExpiresOn: '2026-11-12' },
    { din: '07654321', name: 'B Rao', kycCycleStartFy: '2025-26', dscExpiresOn: '2026-10-01' },
    { din: '01111111', name: 'C Shah', kycCycleStartFy: '2025-26' },
  ];
  it('names each DSC that lapses by the due date', () => {
    expect(dscWarningText(directors, '2026-11-29', '2026-10-14')).toBe(
      'DSC of A Kumar expires 12 Nov 2026; DSC of B Rao expired 1 Oct 2026',
    );
    expect(dscWarningText(directors, '2026-10-30', '2026-09-01')).toBe(
      'DSC of B Rao expires 1 Oct 2026',
    );
    expect(dscWarningText(directors, '2026-09-30', '2026-09-01')).toBeNull();
  });
  it('the profile accepts a DSC expiry date per director', () => {
    expect(profileAttributeErrors('cin', { directors: [directors[0]] })).toEqual([]);
    expect(
      profileAttributeErrors('cin', {
        directors: [{ ...directors[0], dscExpiresOn: '12/11/2026' }],
      })[0],
    ).toMatch(/DSC/);
  });
});

describe('CIN profile facts validation (P1-7)', () => {
  it('accepts the new facts', () => {
    expect(
      profileAttributeErrors('cin', {
        xbrlRequired: true,
        hasSubsidiaries: false,
        mgt8Required: true,
        csrApplicable: false,
        secretarialAuditRequired: true,
        paidUpCapital: 10_00_000,
        authorisedCapital: 25_00_000,
        turnover: 3 * CR,
      }),
    ).toEqual([]);
  });
  it('rejects wrong types', () => {
    expect(profileAttributeErrors('cin', { paidUpCapital: 'ten lakh' })).toHaveLength(1);
    expect(profileAttributeErrors('cin', { csrApplicable: 'yes' })).toHaveLength(1);
  });
});

describe('ROC checklists (P1-4)', () => {
  const rocRules = new Set(CALENDAR_V2_RULES.map((r) => r.code));
  const byCode = new Map(ROC_CHECKLISTS.map((c) => [c.code, c.body.items]));

  it('one per recurring ROC / LLP item, each for a real rule', () => {
    expect(ROC_CHECKLISTS).toHaveLength(11);
    for (const c of ROC_CHECKLISTS) {
      expect(c.code).toMatch(/^FILING_/);
      expect(rocRules.has(c.code.replace(/^FILING_/, ''))).toBe(true);
      const codes = c.body.items.map((i) => i.code);
      expect(new Set(codes).size).toBe(codes.length);
      expect(c.body.items.map((i) => i.sequence)).toEqual(codes.map((_, i) => i + 1));
      // Every form ends lodged (meetings end recorded as held).
      expect(c.body.items.at(-1)!.autoTick).toBe('lodge');
    }
  });

  it('certification lines are ticked by a partner', () => {
    const partnerLines = ROC_CHECKLISTS.flatMap((c) =>
      c.body.items.filter((i) => i.tickedBy === 'partner').map((i) => `${c.code}:${i.code}`),
    );
    expect(partnerLines).toEqual(['FILING_ROC_AOC4:CERT', 'FILING_LLP_FORM8:CERT']);
  });

  it('AOC-4 lines follow the CIN profile (onlyIf)', () => {
    const items = byCode.get('FILING_ROC_AOC4')!;
    const lines = (attrs: Record<string, unknown>, slug = 'private_limited') =>
      applicableItems(items, checklistAttributes('cin', attrs, { slug, turnover: null })).map(
        (i) => i.code,
      );
    const plain = lines({});
    expect(plain).toContain('AGM_HELD');
    expect(plain).not.toEqual(expect.arrayContaining(['CFS', 'CSR', 'MR3', 'ADOPTED']));
    expect(
      lines({ hasSubsidiaries: true, csrApplicable: true, secretarialAuditRequired: true }),
    ).toEqual(expect.arrayContaining(['CFS', 'CSR', 'MR3']));
    // An OPC holds no AGM: the member adopts the accounts instead.
    const opc = lines({}, 'opc');
    expect(opc).toContain('ADOPTED');
    expect(opc).not.toContain('AGM_HELD');
    expect(items.find((i) => i.code === 'AGM_HELD')!.autoTick).toBe('event');
  });

  it('MGT-8 appears on MGT-7 when the thresholds are met', () => {
    const items = byCode.get('FILING_ROC_MGT7')!;
    const lines = (attrs: Record<string, unknown>, turnover: number | null) =>
      applicableItems(
        items,
        checklistAttributes('cin', attrs, { slug: 'private_limited', turnover }),
      ).map((i) => i.code);
    expect(lines({ paidUpCapital: 1 * CR }, 1 * CR)).not.toContain('MGT8');
    expect(lines({ paidUpCapital: 1 * CR }, 60 * CR)).toContain('MGT8');
    expect(lines({ mgt8Required: true }, null)).toContain('MGT8');
  });

  it('non-CIN registrations pass their attributes through', () => {
    expect(
      checklistAttributes('gstin', { exporter: true }, { slug: null, turnover: null }),
    ).toEqual({ exporter: true });
  });
});
