import type { TaxAuditSubItem } from '@hsdg/contracts';
import {
  assessmentYear,
  draftFor,
  draftSourceOf,
  type DraftFiling,
  type DraftSources,
} from './tax-audit-drafts';

const T = (key: string, kind: TaxAuditSubItem['kind'] = 'text'): TaxAuditSubItem => ({
  key,
  label: key,
  kind,
});

const base: DraftSources = {
  financialYear: '2025-26',
  master: {
    legalName: 'Acme Traders Private Limited',
    pan: 'AAACA1234B',
    typeSlug: 'private_limited',
    typeName: 'Private Limited Company',
    typeCategory: 'company',
    incorporationDate: '2010-05-01',
    address: '1 Mall Road, Jalandhar, Punjab, 144001',
  },
  registrations: [
    { type: 'gstin', number: '03AAACA1234B1Z5', state: '03' },
    { type: 'tan', number: 'JLDA12345B', state: null },
  ],
  applicability: { applicable: true, clause: '44AB(a)' },
  filings: [],
  lastYear: null,
  msme: null,
};

const filing = (p: Partial<DraftFiling>): DraftFiling => ({
  stream: 'tds',
  form: '26Q',
  registration: null,
  periodKey: 'Q1',
  periodStart: '2025-04-01',
  periodEnd: '2025-06-30',
  dueDate: '2025-07-31',
  filedOn: '2025-07-20',
  isNil: false,
  figures: null,
  lateFee: null,
  interest: null,
  ...p,
});

describe('draftSourceOf', () => {
  it('keeps the library source and drafts clause 8 from the client master', () => {
    expect(draftSourceOf('34', 'tds_filings')).toBe('tds_filings');
    expect(draftSourceOf('8', null)).toBe('client_master');
    expect(draftSourceOf('8a', null)).toBeNull();
  });
});

describe('client master (clauses 1–8)', () => {
  it('fills name, address, PAN, status, year and assessment year', () => {
    expect(draftFor('1', 'client_master', [T('name')], base)?.answer).toEqual({
      name: 'Acme Traders Private Limited',
    });
    expect(draftFor('2', 'client_master', [T('address')], base)?.answer.address).toContain(
      'Jalandhar',
    );
    expect(draftFor('3', 'client_master', [T('pan')], base)?.answer).toEqual({ pan: 'AAACA1234B' });
    expect(draftFor('5', 'client_master', [T('status')], base)?.answer).toEqual({
      status: 'Company',
    });
    expect(
      draftFor('6', 'client_master', [T('from', 'date'), T('to', 'date')], base)?.answer,
    ).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    expect(draftFor('7', 'client_master', [T('ay')], base)?.answer).toEqual({ ay: '2026-27' });
    expect(assessmentYear('2099-00')).toBe('2100-01');
  });

  it('starts the previous year at incorporation inside the year', () => {
    const s = { ...base, master: { ...base.master!, incorporationDate: '2025-09-15' } };
    const d = draftFor('6', 'client_master', [T('from', 'date'), T('to', 'date')], s)!;
    expect(d.answer.from).toBe('2025-09-15');
    expect(d.note).toMatch(/incorporation/);
  });

  it('lists indirect tax registrations only, and says liable', () => {
    const d = draftFor(
      '4',
      'client_master',
      [T('liable', 'yes_no'), T('registrations', 'table')],
      base,
    )!;
    expect(d.answer).toEqual({ liable: true, registrations: 'GSTIN\t03AAACA1234B1Z5\t03' });
    const none = draftFor(
      '4',
      'client_master',
      [T('liable', 'yes_no'), T('registrations', 'table')],
      { ...base, registrations: [] },
    )!;
    expect(none.answer).toEqual({ liable: false });
  });

  it('takes clause 8 from the applicability decision, and leaves it when not applicable', () => {
    expect(draftFor('8', 'client_master', [T('clause')], base)?.answer).toEqual({
      clause: '44AB(a)',
    });
    expect(
      draftFor('8', 'client_master', [T('clause')], {
        ...base,
        applicability: { applicable: false, clause: '44AB(a)' },
      }),
    ).toBeNull();
    expect(draftFor('8', 'client_master', [T('clause')], { ...base, applicability: null })).toBe(
      null,
    );
  });

  it('gives no draft for what the master does not hold', () => {
    const s = { ...base, master: { ...base.master!, pan: null, address: null } };
    expect(draftFor('2', 'client_master', [T('address')], s)).toBeNull();
    expect(draftFor('3', 'client_master', [T('pan')], s)).toBeNull();
    expect(draftFor('1', 'client_master', [T('name')], { ...base, master: null })).toBeNull();
  });
});

describe('TDS returns (clause 34)', () => {
  const items = [T('a', 'table'), T('b', 'table'), T('c', 'table')];

  it('has no draft when the firm filed no TDS return for the year', () => {
    expect(draftFor('34', 'tds_filings', items, base)).toBeNull();
  });

  it('lists each return, whether in time, the amounts and any interest', () => {
    const s = {
      ...base,
      filings: [
        filing({ figures: { tax_deducted: 12000, tax_deposited: 12000 } }),
        filing({
          periodKey: 'Q2',
          dueDate: '2025-10-31',
          filedOn: '2025-11-05',
          interest: '450.00',
        }),
      ],
    };
    const d = draftFor('34', 'tds_filings', items, s)!;
    expect(d.source).toBe('tds_filings');
    expect(d.answer.a).toBe('26Q\tQ1\t12000\t12000');
    expect(d.answer.b).toBe(
      '26Q\tQ1\t2025-07-31\t2025-07-20\tYes\n26Q\tQ2\t2025-10-31\t2025-11-05\tNo',
    );
    expect(d.answer.c).toBe('26Q\tQ2\t450');
    expect(d.note).toMatch(
      /2 TDS\/TCS returns the firm filed for FY 2025-26, 1 after the due date/,
    );
  });
});

describe('GST returns (clauses 27 and 44)', () => {
  const gst = (p: Partial<DraftFiling>): DraftFiling =>
    filing({ stream: 'gst', form: 'GSTR-3B', registration: '03AAACA1234B1Z5', ...p });

  it('drafts ITC used per return for 27, only where figures were recorded', () => {
    const s = {
      ...base,
      filings: [
        gst({ periodKey: '2025-04', figures: { itc_igst: 100, itc_cgst: 50, itc_sgst: 50 } }),
        gst({ periodKey: '2025-05', form: 'GSTR-1', figures: { taxable_value: 9000 } }),
      ],
    };
    const d = draftFor('27', 'gst_filings', [T('a', 'table'), T('b', 'table')], s)!;
    expect(d.answer).toEqual({ a: '03AAACA1234B1Z5\tGSTR-3B\t2025-04\t100\t50\t50\t' });
    expect(
      draftFor('27', 'gst_filings', [T('a', 'table')], { ...base, filings: [s.filings[1]!] }),
    ).toBeNull();
  });

  it('gives 44 check figures per GSTIN', () => {
    const s = {
      ...base,
      filings: [
        gst({ periodKey: '2025-04', figures: { itc_igst: 100, itc_cgst: 50 } }),
        gst({ periodKey: '2025-05', figures: { itc_igst: 25 } }),
      ],
    };
    const d = draftFor('44', 'gst_filings', [T('breakup', 'table')], s)!;
    expect(d.answer).toEqual({ breakup: '03AAACA1234B1Z5\t2\t175' });
    expect(draftFor('44', 'gst_filings', [T('breakup', 'table')], base)).toBeNull();
  });
});

describe('last year (clauses 18, 32, 40)', () => {
  const s: DraftSources = {
    ...base,
    lastYear: {
      auditId: 'a0',
      financialYear: '2024-25',
      libraryVersionId: null,
      answers: {
        '18': { blocks: 'Plant\t15\t1000\t0\t0\t150\t850\nFurniture\t10\t500\t0\t0\t50\t450' },
        '32': { a: '2022-23\tBusiness loss\t40000', b: 'No change', c: 0 },
        '40': { ratios: 'GP / turnover\t21.5%\t20.1%' },
      },
    },
  };

  it('opens 18 at last year’s closing WDV', () => {
    const d = draftFor('18', 'last_year', [T('blocks', 'table')], s)!;
    expect(d.answer).toEqual({ blocks: 'Plant\t15\t850\nFurniture\t10\t450' });
    expect(d.note).toMatch(/FY 2024-25's closing/);
  });

  it('moves 40’s ratios to the previous-year column', () => {
    expect(draftFor('40', 'last_year', [T('ratios', 'table')], s)?.answer).toEqual({
      ratios: 'GP / turnover\t\t21.5%',
    });
  });

  it('carries 32 as it was, dropping what the clause cannot hold', () => {
    const d = draftFor('32', 'last_year', [T('a', 'table'), T('b'), T('c', 'amount')], s)!;
    expect(d.answer).toEqual({ a: '2022-23\tBusiness loss\t40000', b: 'No change', c: 0 });
    const wrong = draftFor('32', 'last_year', [T('a', 'table'), T('b'), T('c', 'text')], s)!;
    expect(wrong.answer.c).toBeUndefined();
  });

  it('has no draft without last year’s done answer', () => {
    expect(draftFor('18', 'last_year', [T('blocks', 'table')], base)).toBeNull();
    expect(
      draftFor('18', 'last_year', [T('blocks', 'table')], {
        ...s,
        lastYear: { ...s.lastYear!, answers: {} },
      }),
    ).toBeNull();
  });
});

describe('last year carried (F-10)', () => {
  const ly: DraftSources['lastYear'] = {
    auditId: 'a0',
    financialYear: '2024-25',
    libraryVersionId: 'v1',
    answers: {
      '21': { items: 'Penalty\t5000' },
      '34': { a: '26Q\t194C\t120000', b: 'All in time' },
      '10': {},
    },
  };

  it('carries last year’s answer onto a clause with no source of its own', () => {
    const d = draftFor('21', null, [T('items', 'table')], { ...base, lastYear: ly })!;
    expect(d).toMatchObject({ source: 'last_year', answer: { items: 'Penalty\t5000' } });
    expect(d.note).toMatch(/FY 2024-25 tax audit/);
    expect(draftFor('10', null, [T('a', 'table')], { ...base, lastYear: ly })).toBeNull();
  });

  it('prefers this year’s own source, and carries when that source is empty', () => {
    const items = [T('a', 'table'), T('b', 'table'), T('c', 'table')];
    const withTds = { ...base, lastYear: ly, filings: [filing({})] };
    expect(draftFor('34', 'tds_filings', items, withTds)?.source).toBe('tds_filings');
    expect(draftFor('34', 'tds_filings', items, { ...base, lastYear: ly })).toMatchObject({
      source: 'last_year',
      answer: { a: '26Q\t194C\t120000', b: 'All in time' },
    });
  });
});

describe('MSME list (clauses 22 and 26)', () => {
  it('drafts only once the client has sent the list', () => {
    expect(draftFor('22', 'msme_list', [T('amount', 'amount')], base)).toBeNull();
    expect(
      draftFor('22', 'msme_list', [T('amount', 'amount')], {
        ...base,
        msme: { status: 'pending', receivedDate: null },
      }),
    ).toBeNull();
    const d = draftFor('26', 'msme_list', [T('in_pl', 'yes_no')], {
      ...base,
      msme: { status: 'received', receivedDate: '2026-05-02' },
    })!;
    expect(d.source).toBe('msme_list');
    expect(d.answer).toEqual({});
    expect(d.note).toMatch(/on 2026-05-02.*s\.43B\(h\)/);
  });
});
