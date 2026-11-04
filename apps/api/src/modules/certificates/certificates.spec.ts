import {
  checkCertificateFigures,
  fillCertificateBody,
  type CertificateTemplate,
} from '@hsdg/contracts';
import { renderCertificatePdf, type CertificatePdfData } from './certificate-pdf';
import { certificateFy, certificateUdin } from './certificates.service';

const netWorth: Pick<CertificateTemplate, 'variables' | 'checks'> = {
  variables: [
    { key: 'person_pan', label: 'PAN', type: 'pan', required: true },
    { key: 'as_on_date', label: 'As on', type: 'date', required: true },
    { key: 'total_assets', label: 'Total assets', type: 'amount', required: true },
    { key: 'total_liabilities', label: 'Total liabilities', type: 'amount', required: true },
    { key: 'net_worth', label: 'Net worth', type: 'amount', required: true },
    { key: 'tds_rate', label: 'Rate', type: 'percent', required: false },
    { key: 'trc', label: 'TRC', type: 'yesno', required: false },
    { key: 'remarks', label: 'Remarks', type: 'longtext', required: false },
  ],
  checks: [
    {
      type: 'difference',
      target: 'net_worth',
      minuend: 'total_assets',
      subtrahend: 'total_liabilities',
    },
  ],
};
const good = {
  person_pan: ' abcpk1234f ',
  as_on_date: '2026-03-31',
  total_assets: '1,25,00,000.50',
  total_liabilities: '25,00,000.25',
  net_worth: '10000000.25',
};

describe('checkCertificateFigures (PS-402)', () => {
  it('trims and normalises the figures', () => {
    const r = checkCertificateFigures(netWorth, { ...good, trc: 'YES', tds_rate: '10' });
    expect(r.errors).toEqual({});
    expect(r.figures).toEqual({
      person_pan: 'ABCPK1234F',
      as_on_date: '2026-03-31',
      total_assets: '12500000.50',
      total_liabilities: '2500000.25',
      net_worth: '10000000.25',
      trc: 'Yes',
      tds_rate: '10',
    });
  });

  it('checks each type, the required ones and unknown keys', () => {
    const r = checkCertificateFigures(netWorth, {
      person_pan: 'ABCP1234F',
      as_on_date: '31-03-2026',
      total_assets: '12.345',
      total_liabilities: '',
      tds_rate: '101',
      trc: 'maybe',
      remarks: 'x'.repeat(4001),
      colour: 'blue',
    });
    expect(r.errors).toEqual({
      person_pan: 'PAN must be a PAN (AAAAA9999A).',
      as_on_date: 'As on must be a date (YYYY-MM-DD).',
      total_assets: 'Total assets must be a number (up to 2 decimals).',
      total_liabilities: 'Total liabilities is required.',
      net_worth: 'Net worth is required.',
      tds_rate: 'Rate must be between 0 and 100.',
      trc: 'TRC must be Yes or No.',
      remarks: 'Remarks is too long.',
      colour: 'Not a field of this certificate.',
    });
  });

  it('works the cross-checks to the paisa', () => {
    expect(checkCertificateFigures(netWorth, { ...good, net_worth: '10000000.24' }).errors).toEqual(
      {
        net_worth: 'Net worth must equal Total assets less Total liabilities (10000000.25).',
      },
    );
    // 0.1 + 0.2 in floating point is not 0.3; in paise it is.
    expect(
      checkCertificateFigures(netWorth, {
        ...good,
        total_assets: '0.30',
        total_liabilities: '0.10',
        net_worth: '0.20',
      }).errors,
    ).toEqual({});
  });
});

describe('fillCertificateBody', () => {
  it('fills the placeholders and blanks the missing ones', () => {
    expect(fillCertificateBody('{{ a }} owes {{b}} to {{c}}.', { a: 'Ravi', b: '100' })).toBe(
      'Ravi owes 100 to ________.',
    );
  });
});

describe('certificateUdin', () => {
  it("takes the register's format on the partner's own membership number", () => {
    expect(certificateUdin(' 26123456 abcd12ef34 ', '123456')).toEqual({
      value: '26123456ABCD12EF34',
    });
    expect(certificateUdin('26012345ABCDEFGHIJ', '12345')).toEqual({ value: '26012345ABCDEFGHIJ' });
    expect(certificateUdin('26654321ABCDEF1234', '123456')).toEqual({
      error: 'This UDIN is not on your membership number (123456).',
    });
    expect(certificateUdin('2612345ABCDEF1234', '123456')).toHaveProperty('error');
    expect(certificateUdin('26123456ABCDEF1234', null)).toEqual({
      error: 'Your membership number is not on your profile (Admin → People).',
    });
  });
});

describe('certificateFy', () => {
  it('numbers by the Indian financial year', () => {
    expect(certificateFy('2026-03-31')).toBe('2025-26');
    expect(certificateFy('2026-04-01')).toBe('2026-27');
    expect(certificateFy('2099-12-31')).toBe('2099-00');
  });
});

const sample = (over: Partial<CertificatePdfData> = {}): CertificatePdfData => ({
  firm: { name: 'DHVAJ & Associates', frn: '012345N', address: 'B-12, Connaught Place, New Delhi' },
  title: 'Net worth certificate',
  formLabel: null,
  legalRef: null,
  certificateNo: 'CERT/2026-27/0001',
  issuedOn: '2026-11-04',
  addressee: 'The Consulate General of Germany, New Delhi',
  purpose: 'Visa application',
  clientName: 'Ravi Kumar',
  body: 'The net worth of {{client_name}} as on {{as_on_date}} is Rs. {{net_worth}}.\n\nFor {{purpose}}.',
  figures: { as_on_date: '2026-03-31', net_worth: '10000000.00' },
  dateKeys: ['as_on_date'],
  amountKeys: ['net_worth'],
  partner: { name: 'Partner A', membershipNo: '123456' },
  signedOn: '2026-11-03',
  udin: '26123456CEABCD0001',
  place: 'New Delhi',
  status: 'issued',
  revokedReason: null,
  ...over,
});

describe('renderCertificatePdf (PS-402)', () => {
  it('prints the letterhead, the filled wording and the signature with the UDIN', () => {
    const pdf = renderCertificatePdf(sample()).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('(DHVAJ & Associates)');
    expect(pdf).toContain('FRN 012345N');
    expect(pdf).toContain('(Certificate no.: CERT/2026-27/0001)');
    expect(pdf).toContain('(Date: 04-11-2026)');
    expect(pdf).toContain('(NET WORTH CERTIFICATE)');
    expect(pdf).toContain('as on 31-03-2026 is Rs. 1,00,00,000.00');
    expect(pdf).toContain('(UDIN: 26123456CEABCD0001)');
    expect(pdf).toContain('(Partner - Membership no. 123456)');
    expect(pdf).not.toContain('DRAFT');
    expect(pdf).not.toContain('REVOKED');
  });

  it('marks a draft and a revoked certificate so a copy cannot pass for live', () => {
    const draft = renderCertificatePdf(
      sample({ status: 'draft', certificateNo: null, partner: null, udin: null, signedOn: null }),
    ).toString('latin1');
    expect(draft).toContain('(DRAFT - NOT SIGNED - NOT FOR ISSUE)');
    expect(draft).toContain('(UDIN: -)');
    const revoked = renderCertificatePdf(
      sample({ status: 'revoked', revokedReason: 'Wrong consulate' }),
    ).toString('latin1');
    expect(revoked).toContain('(REVOKED - THIS CERTIFICATE IS WITHDRAWN)');
    expect(revoked).toContain('Wrong consulate');
  });
});
