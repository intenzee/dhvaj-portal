import { udinListPath } from '@/lib/registers-api';
import { udinFormProblem } from '@/components/registers/udin-form';

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
