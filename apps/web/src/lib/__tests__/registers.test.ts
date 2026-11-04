import { dscListPath, udinListPath } from '@/lib/registers-api';
import { udinFormProblem } from '@/components/registers/udin-form';
import { dscExpiryText, dscFormProblem } from '@/components/registers/dsc-form';

const none = { search: '', documentKind: '', status: '', financialYear: '', id: '' } as const;

describe('udinListPath', () => {
  it('leaves empty filters out', () => {
    expect(udinListPath({ ...none })).toBe('/registers/udin?limit=200');
  });
  it('carries every filter, trimmed, on any base', () => {
    const url = udinListPath(
      {
        search: ' Acme ',
        documentKind: 'tax_audit',
        status: 'revoked',
        financialYear: '2025-26',
        id: '',
      },
      '/registers/udin/csv',
    );
    expect(url.startsWith('/registers/udin/csv?')).toBe(true);
    expect(Object.fromEntries(new URL(url, 'http://x').searchParams)).toEqual({
      search: 'Acme',
      documentKind: 'tax_audit',
      status: 'revoked',
      financialYear: '2025-26',
      limit: '200',
    });
  });
});

describe('udinFormProblem', () => {
  const ok = { udin: '26123456ABCDE12345', signedOn: '2026-09-01', generatedOn: '2026-09-02' };
  const today = '2026-11-04';
  it('says nothing until a UDIN is typed, and nothing for a good one', () => {
    expect(udinFormProblem({ ...ok, udin: '' }, null, today)).toBeNull();
    expect(udinFormProblem(ok, '123456', today)).toBeNull();
    expect(udinFormProblem({ ...ok, udin: ok.udin.toLowerCase() }, null, today)).toBeNull();
  });
  it('names a malformed UDIN', () => {
    expect(udinFormProblem({ ...ok, udin: '26123456ABC' }, null, today)).toMatch(/18 characters/);
  });
  it("names a UDIN that is not the partner's", () => {
    expect(udinFormProblem(ok, '654321', today)).toMatch(/membership no\. 123456.*654321/);
  });
  it('generated before signing, or in the future', () => {
    expect(udinFormProblem({ ...ok, generatedOn: '2026-08-31' }, null, today)).toMatch(
      /on or after/,
    );
    expect(udinFormProblem({ ...ok, generatedOn: '2026-11-05' }, null, today)).toMatch(/future/);
  });
});

describe('dscListPath', () => {
  it('leaves the default view and an empty search out', () => {
    expect(dscListPath({ view: 'all', search: '', id: '' })).toBe('/registers/dsc?limit=200');
  });
  it('carries the view and the trimmed search', () => {
    const url = dscListPath({ view: 'at_risk', search: ' Mehta ', id: '' });
    expect(Object.fromEntries(new URL(url, 'http://x').searchParams)).toEqual({
      view: 'at_risk',
      search: 'Mehta',
      limit: '200',
    });
  });
  it('asks for one token by id, whatever the view', () => {
    const url = dscListPath({ view: 'out', search: '', id: 'abc' });
    expect(Object.fromEntries(new URL(url, 'http://x').searchParams)).toEqual({
      id: 'abc',
      limit: '200',
    });
  });
});

describe('dscFormProblem', () => {
  const ok = {
    holderName: 'R. Mehta',
    holderPan: 'ABCDE1234F',
    din: '01234567',
    validFrom: '2025-01-01',
    validTo: '2027-01-01',
    pin: '',
  };
  it('passes a good token, with or without the optional fields', () => {
    expect(dscFormProblem(ok, false)).toBeNull();
    expect(dscFormProblem({ ...ok, holderPan: '', din: '', validFrom: '' }, false)).toBeNull();
    expect(dscFormProblem({ ...ok, holderPan: 'abcde1234f' }, false)).toBeNull();
  });
  it('names a bad PAN, DIN or date order', () => {
    expect(dscFormProblem({ ...ok, holderPan: 'ABC123' }, false)).toMatch(/PAN/);
    expect(dscFormProblem({ ...ok, din: '1234' }, false)).toMatch(/DIN is 8 digits/);
    expect(dscFormProblem({ ...ok, validFrom: '2028-01-01' }, false)).toMatch(/on or before/);
  });
  it('wants a client before it keeps a PIN', () => {
    expect(dscFormProblem({ ...ok, pin: '1234' }, false)).toMatch(/client first/);
    expect(dscFormProblem({ ...ok, pin: '1234' }, true)).toBeNull();
  });
});

describe('dscExpiryText', () => {
  it('reads days left, today and days past', () => {
    expect(dscExpiryText(1)).toBe('1 day left');
    expect(dscExpiryText(30)).toBe('30 days left');
    expect(dscExpiryText(0)).toBe('expires today');
    expect(dscExpiryText(-1)).toBe('expired 1 day ago');
    expect(dscExpiryText(-9)).toBe('expired 9 days ago');
  });
});
