import * as XLSX from 'xlsx';
import { gstinCheckChar } from '@hsdg/contracts';
import { checkGstRows, detectMapping, fieldForHeader, parseGstWorkbook } from './gst-import';

/** A valid GSTIN from its first 14 characters. */
const g = (first14: string): string => first14 + gstinCheckChar(first14);
const book = (sheets: Record<string, unknown[][]>): Buffer => {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

const A = g('27AAPFU0939F1Z'); // F → partnership
const B = g('07AABCB1234C1Z'); // C → private company
const B2 = g('27AABCB1234C1Z'); // same PAN, another state

describe('GST import parsing (ADR-0035)', () => {
  it('maps the usual headers', () => {
    expect(fieldForHeader('GSTIN No.')).toBe('gstin');
    expect(fieldForHeader('GST User ID')).toBe('username');
    expect(fieldForHeader('User Name')).toBe('username');
    expect(fieldForHeader('Password')).toBe('password');
    expect(fieldForHeader('Name of Client')).toBe('legalName');
    expect(fieldForHeader('Trade Name')).toBe('tradeName');
    expect(fieldForHeader('Mobile No')).toBe('phone');
    expect(fieldForHeader('E-mail ID')).toBe('email');
    expect(fieldForHeader('Sr. No.')).toBeNull();
    const m = detectMapping(['S.No', 'Client Name', 'GSTIN', 'User ID', 'Password']);
    expect(m).toMatchObject({
      gstin: 'GSTIN',
      legalName: 'Client Name',
      username: 'User ID',
      password: 'Password',
      email: null,
    });
  });

  it('finds the header row under a title, skips blank rows and keeps logins in memory only', () => {
    const parsed = parseGstWorkbook(
      book({
        Notes: [['nothing here']],
        Clients: [
          ['Client GST Login Details'],
          [],
          ['S.No', 'Name', 'GSTIN', 'User ID', 'Password', 'Mobile'],
          [1, 'Bharat Traders', A, 'bharat_tr', 'pw-1', '98765 43210'],
          [],
          [2, 'Acme Pvt Ltd', B.toLowerCase(), '', '', ''],
        ],
      }),
    );
    expect(parsed.sheet).toBe('Clients');
    expect(parsed.rows.map((r) => r.row)).toEqual([4, 6]);
    expect(parsed.rows[0]!.login).toEqual({ username: 'bharat_tr', password: 'pw-1' });
    expect(parsed.rows[1]!.login).toBeNull();
  });

  it('honours a mapping override and rejects a header that is not there', () => {
    const bytes = book({
      S: [
        ['GSTIN', 'Party', 'Login'],
        [A, 'Bharat', 'u1'],
      ],
    });
    expect(parseGstWorkbook(bytes).mapping.legalName).toBeNull();
    expect(parseGstWorkbook(bytes, { legalName: 'Party' }).rows[0]!.values.legalName).toBe(
      'Bharat',
    );
    expect(() => parseGstWorkbook(bytes, { password: 'Nope' })).toThrow(/not in the sheet/);
  });

  it('reads a sheet with no header row by finding the GSTINs', () => {
    const parsed = parseGstWorkbook(
      book({
        S: [
          ['Bharat', A],
          ['Acme', B],
        ],
      }),
    );
    expect(parsed.mapping.gstin).toBe('GSTIN');
    expect(parsed.rows).toHaveLength(2);
  });

  it('refuses a file without GSTINs', () => {
    expect(() => parseGstWorkbook(book({ S: [['Name'], ['x']] }))).toThrow(/GSTIN column/);
    expect(() => parseGstWorkbook(Buffer.from('not a spreadsheet at all'))).toThrow();
  });

  it('checks each row: GSTIN digit, repeats, names, type, contact details, half logins', () => {
    const bad = `${A.slice(0, 14)}${A[14] === 'A' ? 'B' : 'A'}`;
    const rows = checkGstRows(
      parseGstWorkbook(
        book({
          S: [
            ['GSTIN', 'Name', 'Trade name', 'User', 'Password', 'Email', 'Mobile', 'Constitution'],
            [A, 'Bharat Traders', 'Bharat', 'bharat_tr', 'pw', 'a@b.in', '9876543210', ''],
            [B, 'Acme', '', 'acme', '', 'not-mail', '123', 'Public Limited Company'],
            [B2, 'Acme', '', '', '', '', '', ''],
            [bad, 'Typo', '', '', '', '', '', ''],
            [A, 'Again', '', '', '', '', '', ''],
            [g('07AAAGM0289C1Z'), '', '', '', '', '', '', ''],
          ],
        }),
      ).rows,
    );
    expect(rows[0]).toMatchObject({
      gstin: A,
      pan: 'AAPFU0939F',
      stateCode: '27',
      typeSlug: 'partnership',
      tradeName: 'Bharat',
      usernameHint: 'bh•••tr',
      email: 'a@b.in',
      phone: '9876543210',
      error: null,
    });
    expect(rows[1]).toMatchObject({ typeSlug: 'public_limited', email: null, phone: null });
    expect(rows[1]!.login).toBeNull();
    expect(rows[1]!.warning).toMatch(/E-mail.*Mobile.*one of the user name/);
    expect(rows[2]).toMatchObject({ pan: 'AABCB1234C', typeSlug: 'private_limited', error: null });
    expect(rows[3]!.error).toMatch(/not a valid GSTIN/);
    expect(rows[4]!.error).toBe('Same GSTIN as row 2.');
    expect(rows[5]!.error).toBe('No client name.');
  });
});
