import * as XLSX from 'xlsx';
import { gstinCheckChar } from '@hsdg/contracts';
import {
  clientsOfWorkbook,
  entityTypeFromName,
  parseClientWorkbook,
  parseFrequency,
  parseMark,
  parseMonth,
  parseQuarter,
  periodKeysOfMark,
  periodKeysOfMonth,
  roleOfHeading,
  sourceLabel,
  splitStateFromName,
} from './client-workbook';

const gstin = (state: string, pan: string): string => {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};
/** The same GSTIN with a wrong check digit. */
const typo = (g: string): string => g.slice(0, 14) + (g[14] === '0' ? '1' : '0');
const BHARAT = 'AAFFB1234C';
const SUNRISE = 'AABCS5678D';

/** The firm's workbook, laid out as the format file is: GST Login from row 3, TDS Login, ITR. */
function firmWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();

  const gst = XLSX.utils.aoa_to_sheet([[]]);
  // Row 3: the months over their return columns; row 4: the headings.
  const months = [
    '',
    '',
    '',
    '',
    '',
    '',
    'Apr-26',
    '',
    'May-26',
    '',
    'Jun-26',
    '',
    'Jul-26',
    '',
    '',
    'Aug-26',
  ];
  const headings = [
    'S No',
    'Particular',
    'Frequency',
    'ID',
    'Pwd',
    'GSTIN',
    'GSTR-1',
    'GSTR-3',
    'GSTR-1',
    'GSTR-3',
    'GSTR-1',
    'GSTR-3',
    'GSTR-1',
    'GSTR-3',
    'Fees',
    'GSTR-1',
    'GSTR-3',
    'GSTR 7',
  ];
  XLSX.utils.sheet_add_aoa(
    gst,
    [
      months,
      headings,
      [
        1,
        'Bharat Traders (Delhi)',
        'Monthly',
        'bharat_dl',
        'Pw-Dl-1',
        gstin('07', BHARAT),
        'filed',
        'Filed',
        'filed',
        'NA',
        '',
        '',
        '',
        '',
        1500,
        '',
        '',
        'NA',
      ],
      [2, 'Bharat Traders (Maharashtra)', 'Quarterly', 'bharat_mh', 'Pw-Mh-2', ''],
      [
        3,
        'Sunrise Foods Pvt Ltd',
        'Q',
        'sunrise',
        'Pw-Sun-3',
        gstin('27', SUNRISE),
        '',
        'NA',
        '',
        '',
        'filed',
        'filed',
        '',
        '',
        '',
        '',
        '',
        '',
      ],
      ['', 'Quarterly clients'],
      [4, 'Typo Enterprises', 'M', 'typo', 'pw', typo(gstin('07', 'AAAPT1111A'))],
      [5, 'Half Login (Delhi)', 'Monthly', 'only_id', ''],
      [6, 'Mohan Stores (Pune)', 'Monthly', 'mohan', 'Pw-Mo-6', '', 'pending'],
    ],
    { origin: 'A3' },
  );
  gst['!merges'] = [
    { s: { r: 2, c: 6 }, e: { r: 2, c: 7 } },
    { s: { r: 2, c: 8 }, e: { r: 2, c: 9 } },
    { s: { r: 2, c: 10 }, e: { r: 2, c: 11 } },
    { s: { r: 2, c: 12 }, e: { r: 2, c: 13 } },
    { s: { r: 2, c: 15 }, e: { r: 2, c: 17 } },
  ];
  gst['!ref'] = 'A3:R11';
  XLSX.utils.book_append_sheet(wb, gst, 'GST Login');

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['TDS & Income Tax ID , Passwords'],
      [
        'S.No',
        'Client name',
        'mail',
        'IT- PAN',
        'PWD',
        'IT-TAN',
        'Pwd',
        'Traces ID (Deductor)',
        'Pwd',
        'Traces ID (Tax Payer)',
        'Pwd',
        'DOI',
        'Return filing Status',
        'Ack. No',
      ],
      [
        1,
        'Bharat Traders',
        'accounts@bharat.in',
        BHARAT,
        'Pw-It-B',
        'DELB12345C',
        'Pw-Tan-B',
        'bharat_ded',
        'Pw-Ded-B',
        'bharat_tp',
        'Pw-Tp-B',
        '01/04/2010',
        'Filed',
        '1234567',
      ],
      [2, 'Kiran Sharma', 'not-an-email', 'KIRPS1234K', 'Pw-It-K', '', '', '', '', '', ''],
    ]),
    'TDS Login',
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['S.No', 'Client name', 'Quater1', '', '', 'Quater2'],
      [1, 'Bharat Traders', 'x', '', '', 'y'],
    ]),
    'ITR ',
  );
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('the firm login workbook (ADR-0035)', () => {
  it('reads month headings, filed / NA cells and the frequency', () => {
    expect(parseMonth('Apr-26')).toBe('2026-04');
    expect(parseMonth('April 2026')).toBe('2026-04');
    expect(parseMonth("Mar'27")).toBe('2027-03');
    expect(parseMonth('1-Oct-26')).toBe('2026-10');
    expect(parseMonth('04/2026')).toBe('2026-04');
    expect(parseMonth('', 46143)).toBe('2026-05');
    expect(parseMonth('GSTR-1')).toBeNull();
    expect(parseMark('filed')).toBe('filed');
    expect(parseMark('FILED ')).toBe('filed');
    expect(parseMark('12/05/2026')).toBe('filed');
    expect(parseMark('NA')).toBe('not_applicable');
    expect(parseMark('N/A')).toBe('not_applicable');
    expect(parseMark('pending')).toBe('other');
    expect(parseMark('')).toBeNull();
    expect(parseFrequency('Monthly')).toBe('monthly');
    expect(parseFrequency('M')).toBe('monthly');
    expect(parseFrequency('QRMP')).toBe('quarterly');
    expect(parseFrequency('Quarterly')).toBe('quarterly');
    expect(parseFrequency('yearly')).toBeNull();
  });

  it('takes the state out of "Name (Delhi)" but not other brackets', () => {
    expect(splitStateFromName('Bharat Traders (Delhi)')).toEqual({
      name: 'Bharat Traders',
      state: '07',
    });
    expect(splitStateFromName('Bharat Traders ( Maharashtra )')).toEqual({
      name: 'Bharat Traders',
      state: '27',
    });
    expect(splitStateFromName('Mohan Stores - Mumbai')).toEqual({
      name: 'Mohan Stores',
      state: '27',
    });
    expect(splitStateFromName('Ram Kumar (HUF)')).toEqual({ name: 'Ram Kumar (HUF)', state: null });
  });

  it("knows the format's headings and ignores Fees, DOI, filing status and Ack. No", () => {
    expect(roleOfHeading('Particular')).toEqual({ kind: 'name' });
    expect(roleOfHeading('ID')).toEqual({ kind: 'login', portal: null, account: 'main' });
    expect(roleOfHeading('Pwd')).toEqual({ kind: 'password' });
    expect(roleOfHeading('GSTR-3')).toEqual({ kind: 'return', form: 'GSTR3B' });
    expect(roleOfHeading('GSTR 7')).toEqual({ kind: 'return', form: 'GSTR7' });
    expect(roleOfHeading('GST-1')).toEqual({ kind: 'return', form: 'GSTR1' });
    expect(roleOfHeading('GSTR-3B')).toEqual({ kind: 'return', form: 'GSTR3B' });
    expect(roleOfHeading('GSTIN')).toEqual({ kind: 'gstin' });
    expect(roleOfHeading('IT- PAN')).toEqual({ kind: 'pan' });
    expect(roleOfHeading('IT-TAN')).toEqual({ kind: 'tan' });
    expect(roleOfHeading('Traces ID (Tax Payer)')).toEqual({
      kind: 'login',
      portal: 'traces',
      account: 'taxpayer',
    });
    for (const h of ['Fees', 'DOI', 'Return filing Status', 'Ack. No', 'Quater1'])
      expect(roleOfHeading(h)).toBeNull();
  });

  it('reads the GST and TDS sheets and skips the ITR sheet', () => {
    const book = parseClientWorkbook(firmWorkbook());
    expect(book.sheets.map((s) => [s.name, s.kind, s.rows])).toEqual([
      ['GST Login', 'gst', 6],
      ['TDS Login', 'tds', 2],
      ['ITR ', 'skipped', 0],
    ]);
    expect(book.sheets[0]!.note).toMatch(/1 return cell/);
    expect(book.months).toEqual(['2026-04', '2026-05', '2026-06', '2026-08']);
    const bharat = book.gst[0]!;
    expect(bharat).toMatchObject({
      row: 5,
      name: 'Bharat Traders',
      nameState: '07',
      frequency: 'monthly',
    });
    expect(bharat.logins).toEqual([
      { portal: 'gst', account: 'main', username: 'bharat_dl', password: 'Pw-Dl-1' },
    ]);
    // Fees (column O) is not a return; Aug's merge covers GSTR-1, 3 and 7.
    expect(bharat.marks).toEqual([
      { period: '2026-04', form: 'GSTR1', mark: 'filed' },
      { period: '2026-04', form: 'GSTR3B', mark: 'filed' },
      { period: '2026-05', form: 'GSTR1', mark: 'filed' },
      { period: '2026-05', form: 'GSTR3B', mark: 'not_applicable' },
      { period: '2026-08', form: 'GSTR7', mark: 'not_applicable' },
    ]);
    expect(book.tds[0]!.logins.map((l) => [l.portal, l.account, l.username])).toEqual([
      ['income_tax', 'main', BHARAT],
      ['income_tax', 'tan', 'DELB12345C'],
      ['traces', 'deductor', 'bharat_ded'],
      ['traces', 'taxpayer', 'bharat_tp'],
    ]);
  });

  it('joins rows into clients: by PAN, "Name (State)" rows into one client, TDS by name', () => {
    const clients = clientsOfWorkbook(parseClientWorkbook(firmWorkbook()), 'proprietorship');
    const by = (name: string) => clients.find((c) => c.name === name)!;
    expect(clients.map((c) => c.name)).toEqual([
      'Bharat Traders',
      'Sunrise Foods Pvt Ltd',
      'Typo Enterprises',
      'Half Login',
      'Mohan Stores',
      'Kiran Sharma',
    ]);

    const bharat = by('Bharat Traders');
    expect(bharat).toMatchObject({
      pan: BHARAT,
      tan: 'DELB12345C',
      email: 'accounts@bharat.in',
      typeSlug: 'partnership',
      typeGuessed: false,
      error: null,
    });
    expect(bharat.gst.map((g) => [g.gstin, g.stateCode, g.frequency])).toEqual([
      [gstin('07', BHARAT), '07', 'monthly'],
      [null, '27', 'quarterly'],
    ]);
    expect(bharat.logins.map((l) => [l.portal, l.account, l.target, l.frequency])).toEqual([
      ['gst', 'main', `GSTIN ${gstin('07', BHARAT)}`, null],
      ['gst', 'main', 'Maharashtra (GSTIN to come)', 'quarterly'],
      ['income_tax', 'main', 'PAN', null],
      ['income_tax', 'tan', 'Income-tax (TAN) · TAN DELB12345C', null],
      ['traces', 'deductor', 'TRACES deductor · TAN DELB12345C', null],
      ['traces', 'taxpayer', 'TRACES taxpayer', null],
    ]);
    expect(sourceLabel(bharat.sources)).toBe('GST Login 5, 6 · TDS Login 3');

    expect(by('Sunrise Foods Pvt Ltd')).toMatchObject({
      pan: SUNRISE,
      typeSlug: 'private_limited',
    });
    expect(by('Typo Enterprises').error).toMatch(/not a valid GSTIN/);
    expect(by('Half Login').warnings.join()).toMatch(/GST has only one of user ID and password/);
    expect(by('Half Login').logins).toEqual([]);
    expect(by('Mohan Stores')).toMatchObject({ typeSlug: 'proprietorship', typeGuessed: true });
    expect(by('Mohan Stores').gst[0]!.stateCode).toBe('27');
    expect(by('Kiran Sharma')).toMatchObject({
      pan: 'KIRPS1234K',
      typeSlug: 'proprietorship',
      email: null,
    });
    expect(by('Kiran Sharma').warnings.join()).toMatch(/not an address/);
  });

  it('needs a type for clients the PAN and name do not settle', () => {
    const clients = clientsOfWorkbook(parseClientWorkbook(firmWorkbook()), null);
    expect(clients.find((c) => c.name === 'Mohan Stores')!.typeSlug).toBeNull();
    expect(entityTypeFromName('Acme Industries Limited')).toBe('public_limited');
    expect(entityTypeFromName('Acme Pvt. Ltd.')).toBe('private_limited');
    expect(entityTypeFromName('Ram Kumar HUF')).toBe('huf');
    expect(entityTypeFromName('Acme Trading Company')).toBeNull();
  });

  it('refuses two rows for one state with no GSTIN', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['S No', 'Particular', 'Frequency', 'ID', 'Pwd', 'GSTIN'],
        [1, 'Acme (Delhi)', 'Monthly', 'a', 'b', ''],
        [2, 'Acme (New Delhi)', 'Monthly', 'c', 'd', ''],
      ]),
      'GST Login',
    );
    const [acme] = clientsOfWorkbook(
      parseClientWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer),
      'proprietorship',
    );
    expect(acme!.error).toMatch(/Rows 2 and 3 are both Delhi with no GSTIN/);
  });

  it('reads quarter headings', () => {
    expect(parseQuarter('QTR-1')).toBe('?:Q1');
    expect(parseQuarter('Q2')).toBe('?:Q2');
    expect(parseQuarter('Quarter 3')).toBe('?:Q3');
    expect(parseQuarter('Quater4')).toBe('?:Q4');
    expect(parseQuarter('Q1 2026-27')).toBe('2026-27:Q1');
    expect(parseQuarter('Q5')).toBeNull();
    expect(parseQuarter('GSTR-1')).toBeNull();
    expect(periodKeysOfMark('2026-27:Q2')).toEqual(['2026-27:Q2']);
    expect(periodKeysOfMark('2026-06')).toEqual(['2026-06', '2026-27:Q1']);
  });

  it('reads the firm sheet as it is: a monthly block, then a quarterly block under it', () => {
    const wb = XLSX.utils.book_new();
    const filed = (n: number) => Array.from({ length: n }, () => 'filed');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Monthly Return', '', '', '', 'Apr-26', '', 'May-26', '', 'Jun-26', ''],
        [
          'Particular',
          'ID',
          'Pwd',
          'GSTIN',
          'GSTR-1',
          'GSTR-3',
          'GSTR-1',
          'GSTR-3',
          'GST-1',
          'GSTR-3',
        ],
        ['Khatri Roadlines', 'kh', 'pw-1', gstin('07', BHARAT), ...filed(6)],
        ['Gensync', 'gs', 'pw-2', '', 'NA', 'NA', ...filed(4)],
        [],
        ['Quarterly Return', '', '', '', 'GSTR-1', 'GSTR-3', 'GSTR-1', 'GSTR-3'],
        ['Particular', 'ID', 'Pwd', 'GSTIN', 'QTR-1', '', 'QTR-2', ''],
        ['Gopal Eng Works', 'gp', 'pw-3', '', 'filed', '', 'filed'],
      ]),
      'GST Login',
    );
    const book = parseClientWorkbook(
      XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    );
    // The quarterly block's band and headings are not clients.
    expect(book.gst.map((g) => g.name)).toEqual(['Khatri Roadlines', 'Gensync', 'Gopal Eng Works']);
    expect(book.sheets[0]).toMatchObject({ kind: 'gst', rows: 3, note: null });
    expect(book.months).toEqual(['2026-04', '2026-05', '2026-06']);
    // "GST-1" is June's GSTR-1.
    expect(book.gst[0]!.marks.filter((m) => m.period === '2026-06')).toEqual([
      { period: '2026-06', form: 'GSTR1', mark: 'filed' },
      { period: '2026-06', form: 'GSTR3B', mark: 'filed' },
    ]);
    expect(book.gst[1]!.marks.slice(0, 2)).toEqual([
      { period: '2026-04', form: 'GSTR1', mark: 'not_applicable' },
      { period: '2026-04', form: 'GSTR3B', mark: 'not_applicable' },
    ]);
    // QTR-1 / QTR-2 under GSTR-1, in the year of the sheet's months.
    expect(book.gst[2]!.marks).toEqual([
      { period: '2026-27:Q1', form: 'GSTR1', mark: 'filed' },
      { period: '2026-27:Q2', form: 'GSTR1', mark: 'filed' },
    ]);
    expect(book.gst[2]!.logins).toEqual([
      { portal: 'gst', account: 'main', username: 'gp', password: 'pw-3' },
    ]);

    // Marks stay on a client the sheet gives no GSTIN, without a warning.
    const clients = clientsOfWorkbook(book, 'proprietorship');
    const gensync = clients.find((c) => c.name === 'Gensync')!;
    expect(gensync.gst[0]!.marks).toHaveLength(6);
    expect(gensync.warnings).toEqual([]);
  });

  it('gives a quarter without months the current financial year', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['', '', '', '', 'GSTR-1', 'GSTR-3'],
        ['Particular', 'ID', 'Pwd', 'GSTIN', 'Q4', ''],
        ['Hasol', 'h', 'p', '', 'filed', 'NA'],
      ]),
      'GST Login',
    );
    const book = parseClientWorkbook(
      XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
      new Date('2027-02-10T00:00:00Z'),
    );
    expect(book.gst[0]!.marks).toEqual([
      { period: '2026-27:Q4', form: 'GSTR1', mark: 'filed' },
      { period: '2026-27:Q4', form: 'GSTR3B', mark: 'not_applicable' },
    ]);
  });

  it('turns a month into the filing periods it can close', () => {
    expect(periodKeysOfMonth('2026-05')).toEqual(['2026-05']);
    expect(periodKeysOfMonth('2026-06')).toEqual(['2026-06', '2026-27:Q1']);
    expect(periodKeysOfMonth('2026-12')).toEqual(['2026-12', '2026-27:Q3']);
    expect(periodKeysOfMonth('2027-03')).toEqual(['2027-03', '2026-27:Q4']);
  });

  it('says what it expected when the file has no login sheet', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['a', 'b'],
        [1, 2],
      ]),
      'S',
    );
    expect(() =>
      parseClientWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer),
    ).toThrow(/expected a GST sheet/);
  });
});
