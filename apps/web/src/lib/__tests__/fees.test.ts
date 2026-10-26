import { feeArithmetic } from '../fees';

describe('feeArithmetic', () => {
  it('works out the year and the invoice from the period', () => {
    expect(feeArithmetic('5000', 'monthly', 'monthly')).toBe(
      '= ₹60,000 a year · invoiced monthly, ₹5,000 per invoice',
    );
    expect(feeArithmetic('5000', 'monthly', 'quarterly')).toBe(
      '= ₹60,000 a year · invoiced quarterly, ₹15,000 per invoice',
    );
    expect(feeArithmetic('5000', 'annual', 'monthly')).toBe(
      '= ₹5,000 a year · invoiced monthly, ₹416.66 per invoice',
    );
  });

  it('lets the fee period decide when invoicing was never set up', () => {
    expect(feeArithmetic('15000', 'quarterly', null)).toBe(
      '= ₹60,000 a year · invoiced quarterly, ₹15,000 per invoice',
    );
    expect(feeArithmetic('30000', 'half_yearly', null)).toBe(
      '= ₹60,000 a year · invoiced yearly, ₹60,000 per invoice',
    );
  });

  it('shows a one-time fee once, and nothing for an empty or bad amount', () => {
    expect(feeArithmetic('25000', 'one_time', 'monthly')).toBe('= ₹25,000 once · invoiced once');
    expect(feeArithmetic('', 'monthly', null)).toBeNull();
    expect(feeArithmetic('abc', 'monthly', null)).toBeNull();
  });
});
