import {
  rupeesShort,
  taxAuditApplicability,
  type TaxAuditApplicabilityInput,
} from '@hsdg/contracts';
import { radarAnswer } from './tax-audit-applicability.service';

const LAKH = 1_00_000;
const CRORE = 1_00_00_000;
const base: TaxAuditApplicabilityInput = {
  businessTurnover: null,
  professionReceipts: null,
  cashWithinFivePercent: false,
  presumptiveScheme: null,
  profitBelowPresumptive: false,
  incomeAboveExemption: true,
  optedOutOf44AD: false,
};
const calc = (over: Partial<TaxAuditApplicabilityInput>) =>
  taxAuditApplicability({ ...base, ...over });

describe('taxAuditApplicability (s.44AB)', () => {
  it('(a) audits business turnover over ₹1 crore', () => {
    expect(calc({ businessTurnover: 1.5 * CRORE })).toEqual({
      applicable: true,
      clause: '44AB(a)',
      reason: 'Business turnover of ₹1.5 crore is over ₹1 crore.',
    });
    expect(calc({ businessTurnover: CRORE })).toMatchObject({ applicable: false });
  });

  it('(a) lifts the limit to ₹10 crore when cash is within 5% each way', () => {
    expect(calc({ businessTurnover: 8 * CRORE, cashWithinFivePercent: true })).toEqual({
      applicable: false,
      clause: null,
      reason: 'Business turnover of ₹8 crore is within ₹10 crore (cash within 5%).',
    });
    expect(calc({ businessTurnover: 12 * CRORE, cashWithinFivePercent: true })).toMatchObject({
      applicable: true,
      clause: '44AB(a)',
    });
  });

  it('(a) does not reach the deemed profit under s.44AD within ₹2 crore (₹3 crore with cash within 5%)', () => {
    expect(calc({ businessTurnover: 1.8 * CRORE, presumptiveScheme: '44AD' })).toMatchObject({
      applicable: false,
      reason: 'Deemed profit under s.44AD on turnover of ₹1.8 crore, within ₹2 crore.',
    });
    expect(
      calc({
        businessTurnover: 2.5 * CRORE,
        presumptiveScheme: '44AD',
        cashWithinFivePercent: true,
      }),
    ).toMatchObject({ applicable: false });
    expect(calc({ businessTurnover: 2.5 * CRORE, presumptiveScheme: '44AD' })).toMatchObject({
      applicable: true,
      clause: '44AB(a)',
    });
  });

  it('(b) audits professional receipts over ₹50 lakh, unless on s.44ADA within ₹75 lakh', () => {
    expect(calc({ professionReceipts: 60 * LAKH })).toEqual({
      applicable: true,
      clause: '44AB(b)',
      reason: 'Professional receipts of ₹60 lakh are over ₹50 lakh.',
    });
    expect(
      calc({
        professionReceipts: 60 * LAKH,
        presumptiveScheme: '44ADA',
        cashWithinFivePercent: true,
      }),
    ).toMatchObject({ applicable: false });
    // s.44ADA above ₹50 lakh needs cash within 5%.
    expect(calc({ professionReceipts: 60 * LAKH, presumptiveScheme: '44ADA' })).toMatchObject({
      applicable: true,
      clause: '44AB(b)',
    });
    expect(calc({ professionReceipts: 40 * LAKH })).toMatchObject({
      applicable: false,
      reason: 'Professional receipts of ₹40 lakh are within ₹50 lakh.',
    });
  });

  it('(c) audits less than the deemed profit under s.44AE / 44BB / 44BBB', () => {
    expect(
      calc({
        businessTurnover: 30 * LAKH,
        presumptiveScheme: '44AE',
        profitBelowPresumptive: true,
      }),
    ).toMatchObject({ applicable: true, clause: '44AB(c)' });
  });

  it('(d) audits less than the deemed profit under s.44ADA with income over the exemption limit', () => {
    const low = {
      professionReceipts: 30 * LAKH,
      presumptiveScheme: '44ADA' as const,
      profitBelowPresumptive: true,
    };
    expect(calc(low)).toMatchObject({ applicable: true, clause: '44AB(d)' });
    expect(calc({ ...low, incomeAboveExemption: false })).toMatchObject({ applicable: false });
  });

  it('(e) audits a client out of s.44AD within five years, with income over the exemption limit', () => {
    expect(calc({ businessTurnover: 50 * LAKH, optedOutOf44AD: true })).toMatchObject({
      applicable: true,
      clause: '44AB(e)',
    });
    expect(
      calc({ businessTurnover: 50 * LAKH, optedOutOf44AD: true, incomeAboveExemption: false }),
    ).toMatchObject({ applicable: false });
  });

  it('says so when there is no business or professional income', () => {
    expect(calc({})).toEqual({
      applicable: false,
      clause: null,
      reason: 'No business or professional income for the year.',
    });
  });

  it('writes amounts the Indian way', () => {
    expect(rupeesShort(25_000_000)).toBe('₹2.5 crore');
    expect(rupeesShort(8_000_000)).toBe('₹80 lakh');
    expect(rupeesShort(45_000)).toBe('₹45,000');
  });
});

describe('radarAnswer', () => {
  const none = { decided: null, decided_reason: null, pan_tax_audit: null, annual_turnover: null };

  it('takes the year’s decision first', () => {
    expect(
      radarAnswer({
        ...none,
        decided: false,
        decided_reason: 'Decided: on 44AD',
        pan_tax_audit: true,
      }),
    ).toEqual({ likely: false, basis: 'decided', reason: 'Decided: on 44AD' });
  });

  it('then the PAN profile', () => {
    expect(radarAnswer({ ...none, pan_tax_audit: true, annual_turnover: '100' })).toMatchObject({
      likely: true,
      basis: 'pan_profile',
    });
  });

  it('then turnover on the client record against ₹1 crore', () => {
    expect(radarAnswer({ ...none, annual_turnover: '25000000.00' })).toEqual({
      likely: true,
      basis: 'turnover',
      reason:
        'Turnover of ₹2.5 crore on the client record is over ₹1 crore. Not yet worked out for the year.',
    });
    expect(radarAnswer(none)).toMatchObject({ likely: false, basis: 'turnover' });
  });
});
