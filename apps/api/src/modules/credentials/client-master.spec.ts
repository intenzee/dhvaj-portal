import { readFileSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import {
  CLIENT_MASTER_COLUMNS,
  CLIENT_MASTER_LOGIN_COLUMNS,
  CLIENT_MASTER_SAVED_PASSWORD,
  gstinCheckChar,
} from '@hsdg/contracts';
import {
  columnLetter,
  fillClientMaster,
  fillSheetXml,
  legalStatusLabel,
  parseClientMaster,
  parseDate,
  parseFinancialYear,
} from './client-master';

// These read the real template (a 4.6 MB sheet): slow when every suite runs at once.
jest.setTimeout(30_000);

const template = readFileSync(join(__dirname, 'client-master-template.xlsx'));
const gstin = (state: string, pan: string): string => {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};
const SUNRISE = 'AABCS5678D';
const BHARAT = 'AAFFB1234C';

describe('Client Master template', () => {
  const book = XLSX.read(template, { type: 'buffer' });
  const row = (sheet: string, r: number, n: number): string[] =>
    Array.from({ length: n }, (_, i) => {
      const v = book.Sheets[sheet]![`${columnLetter(i)}${r}`]?.v;
      return v === undefined ? '' : String(v);
    });

  it('has the headings the import reads, in column order', () => {
    const clients = Object.values(CLIENT_MASTER_COLUMNS);
    expect(row('Clients', 4, clients.length)).toEqual(clients);
    const logins = Object.values(CLIENT_MASTER_LOGIN_COLUMNS);
    expect(row('Logins', 3, logins.length)).toEqual(logins);
  });

  it('imports as nothing until a row is filled (the example rows are skipped)', () => {
    const parsed = parseClientMaster(template);
    expect(parsed.rows).toEqual([]);
    expect(parsed.logins).toEqual([]);
    expect(parsed.loginProblems).toEqual([]);
  });
});

describe('export → import round trip', () => {
  it('reads back what the export wrote, and skips the logins already saved', async () => {
    const main = gstin('07', SUNRISE);
    const branch = gstin('27', SUNRISE);
    const file = await fillClientMaster(
      template,
      [
        {
          code: 'CL-0001',
          legalName: 'Sunrise Foods Private Limited',
          entityType: 'Private Limited Company',
          pan: SUNRISE,
          gstin: main,
          otherGstins: branch,
          tan: 'DELS12345A',
          incorporationDate: { date: '2019-04-01' },
          legalStatus: 'Active',
          officeCode: 'DEL',
          contactName: 'Asha Mehta',
          email: 'asha@sunrise.example',
          mobile: '9876543210',
          addressLine1: '12 Ring Road',
          city: 'New Delhi',
          state: 'Delhi',
          pincode: '110001',
          financialYear: '2026-27',
          gst: 'Yes',
          gstFrequency: 'Monthly',
          tds: 'Yes',
        },
        // A client with gaps: only its name and a GSTIN.
        { code: 'CL-0002', legalName: 'Bharat Traders', gstin: gstin('09', BHARAT) },
      ],
      [
        {
          code: 'CL-0001',
          name: 'Sunrise Foods Private Limited',
          portal: 'GST',
          target: main,
          username: 'sun••••',
          password: CLIENT_MASTER_SAVED_PASSWORD,
        },
      ],
    );

    const { rows, logins, loginProblems } = parseClientMaster(file);
    expect(logins).toEqual([]);
    expect(loginProblems).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      row: 6,
      code: 'CL-0001',
      legalName: 'Sunrise Foods Private Limited',
      pan: SUNRISE,
      gstins: [main, branch],
      tan: 'DELS12345A',
      incorporationDate: '2019-04-01',
      legalStatus: 'active',
      officeCode: 'DEL',
      contact: { fullName: 'Asha Mehta', email: 'asha@sunrise.example', phone: '9876543210' },
      address: { line1: '12 Ring Road', city: 'New Delhi', state: 'Delhi', pincode: '110001' },
      financialYear: '2026-27',
      streams: ['gst', 'tds'],
      gstFrequency: 'monthly',
      error: null,
    });
    // The PAN is read out of the GSTIN when the cell is empty.
    expect(rows[1]).toMatchObject({
      row: 7,
      code: 'CL-0002',
      pan: BHARAT,
      guessedTypeSlug: 'partnership',
      contact: null,
      address: null,
      error: null,
    });
  });

  it('stops a row whose PAN is not the one in its GSTIN, and flags a GSTIN typo', async () => {
    const good = gstin('07', SUNRISE);
    const typo = good.slice(0, 14) + (good[14] === '0' ? '1' : '0');
    const file = await fillClientMaster(
      template,
      [
        { legalName: 'Mismatch Ltd', pan: BHARAT, gstin: good },
        { legalName: 'Typo Ltd', gstin: typo },
        { legalName: '', pan: SUNRISE },
      ],
      [{ name: 'Mismatch Ltd', portal: 'Nowhere', username: 'u', password: 'p' }],
    );
    const { rows, loginProblems } = parseClientMaster(file);
    expect(rows.map((r) => Boolean(r.error))).toEqual([true, true, true]);
    expect(loginProblems).toHaveLength(1);
    expect(loginProblems[0]!.message).toContain('Nowhere');
  });

  it('reads a GSTIN typed with a stray dash or dot', async () => {
    const good = gstin('07', SUNRISE);
    const file = await fillClientMaster(
      template,
      [
        {
          legalName: 'Dashed Ltd',
          gstin: `${good.slice(0, 14)}-${good[14]}`,
          otherGstins: `${gstin('27', SUNRISE).slice(0, 2)}.${gstin('27', SUNRISE).slice(2)}`,
        },
      ],
      [],
    );
    const [row] = parseClientMaster(file).rows;
    expect(row).toMatchObject({ error: null, pan: SUNRISE, gstins: [good, gstin('27', SUNRISE)] });
  });
});

describe('fillSheetXml', () => {
  it('fills a styled empty cell in place and escapes the text', () => {
    const xml =
      '<worksheet><sheetData><row r="6"><c r="A6" s="3" t="n" /><c r="B6" s="4" /></row></sheetData></worksheet>';
    const out = fillSheetXml(xml, new Map([['B6', 'A & B <Co>']]));
    expect(out).toContain('<c r="A6" s="3" t="n" />');
    expect(out).toContain(
      '<c r="B6" s="4" t="inlineStr"><is><t xml:space="preserve">A &amp; B &lt;Co&gt;</t></is></c>',
    );
  });
});

describe('cells', () => {
  it.each([
    ['2026-27', '2026-27'],
    ['FY 2026-2027', '2026-27'],
    ['1999-00', '1999-00'],
    ['2026-28', null],
    ['2026', null],
  ])('financial year %s → %s', (raw, want) => expect(parseFinancialYear(raw)).toBe(want));

  it.each<[unknown, string | null]>([
    ['01-04-2019', '2019-04-01'],
    ['1/4/2019', '2019-04-01'],
    ['2019-04-01', '2019-04-01'],
    [43556, '2019-04-01'],
    ['31-02-2019', null],
    ['soon', null],
  ])('date %s → %s', (raw, want) => expect(parseDate(raw)).toBe(want));

  it('labels legal statuses as the list does', () => {
    expect(legalStatusLabel('under_incorporation')).toBe('Under incorporation');
    expect(legalStatusLabel('cirp')).toBe('CIRP');
  });
});
