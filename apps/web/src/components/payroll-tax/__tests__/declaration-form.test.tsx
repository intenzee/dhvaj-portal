import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaxDeclaration } from '@hsdg/contracts';
import { DeclarationForm } from '../declaration-form';

jest.setTimeout(20_000);

const blank: TaxDeclaration = {
  employeeId: 'e1',
  id: null,
  taxYear: 2026,
  regime: 'new',
  amounts: {
    rentMonthly: '0',
    metroCity: false,
    landlordPanGiven: false,
    lta: '0',
    section80C: '0',
    section80CCD1B: '0',
    section80DSelf: '0',
    selfSenior: false,
    section80DParents: '0',
    parentsSenior: false,
    homeLoanInterest: '0',
    section80E: '0',
    section80G: '0',
    section80TTA: '0',
    otherIncome: '0',
  },
  previousEmployment: null,
  submittedAt: null,
  lockedAt: null,
  lockedBy: null,
  version: 0,
  proofs: [],
};

describe('DeclarationForm', () => {
  it('shows old-regime deductions only once the old regime is chosen, and saves them', async () => {
    const onSave = jest.fn();
    render(<DeclarationForm value={blank} onSave={onSave} />);
    expect(screen.queryByLabelText(/^80C(?!CD)/)).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText(/Tax regime/), 'old');
    const c = screen.getByLabelText(/^80C(?!CD)/);
    await userEvent.clear(c);
    await userEvent.type(c, '1,50,000');
    await userEvent.click(screen.getByRole('button', { name: 'Save declaration' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 0,
        regime: 'old',
        amounts: expect.objectContaining({ section80C: '150000' }),
        previousEmployment: null,
      }),
    );
  });

  it('refuses to save what is not an amount', async () => {
    const onSave = jest.fn();
    render(<DeclarationForm value={{ ...blank, regime: 'old' }} onSave={onSave} />);
    const c = screen.getByLabelText(/^80C(?!CD)/);
    await userEvent.clear(c);
    await userEvent.type(c, '12.345');
    expect(screen.getByRole('button', { name: 'Save declaration' })).toBeDisabled();
    expect(screen.getByText(/Not an amount/)).toHaveTextContent('80C');
  });

  it('records the previous employer when the person joined mid-year', async () => {
    const onSave = jest.fn();
    render(<DeclarationForm value={blank} onSave={onSave} />);
    await userEvent.click(screen.getByLabelText(/worked elsewhere earlier this year/));
    const tds = screen.getByLabelText('TDS deducted there');
    await userEvent.clear(tds);
    await userEvent.type(tds, '25000');
    await userEvent.click(screen.getByRole('button', { name: 'Save declaration' }));
    expect(onSave.mock.calls[0][0].previousEmployment).toEqual({
      income: '0',
      tds: '25000',
      pf: '0',
      pt: '0',
    });
  });

  it('fixes the regime once tax has been deducted, and locks everything once HR locks it', () => {
    const { rerender } = render(<DeclarationForm value={blank} onSave={jest.fn()} regimeFixed />);
    expect(screen.getByLabelText(/Tax regime/)).toBeDisabled();
    expect(screen.getByText(/Fixed for the year/)).toBeInTheDocument();
    rerender(
      <DeclarationForm
        value={{ ...blank, id: 'd1', lockedAt: '2027-01-05T00:00:00Z' }}
        onSave={jest.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Save declaration' })).toBeNull();
    expect(screen.getByText(/locked the declaration/)).toBeInTheDocument();
  });
});
