import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CertificateFigures as Figures, CertificateTemplate } from '@hsdg/contracts';
import { CertificateFigures, figureErrors } from '../certificate-figures';
import { certificateRegisterPath } from '@/lib/certificates-api';

const template: CertificateTemplate = {
  code: 'CERT_NET_WORTH',
  name: 'Net worth certificate',
  version: 1,
  effectiveFrom: '2017-04-01',
  formLabel: null,
  legalRef: null,
  verification: 'verify',
  variables: [
    { key: 'person_pan', label: 'PAN', type: 'pan', required: true },
    { key: 'as_on_date', label: 'As on', type: 'date', required: true },
    { key: 'total_assets', label: 'Total assets', type: 'amount', required: true },
    { key: 'total_liabilities', label: 'Total liabilities', type: 'amount', required: true },
    { key: 'net_worth', label: 'Net worth', type: 'amount', required: true },
    { key: 'trc', label: 'TRC obtained', type: 'yesno', required: false },
    { key: 'basis', label: 'Basis', type: 'longtext', required: false },
  ],
  checks: [
    {
      type: 'difference',
      target: 'net_worth',
      minuend: 'total_assets',
      subtrahend: 'total_liabilities',
    },
  ],
  body: '',
  recordsForm15ca: false,
};

describe('figureErrors (PS-402)', () => {
  it('holds back "required" until the person tries to save', () => {
    expect(figureErrors(template, {}, false)).toEqual({});
    expect(Object.keys(figureErrors(template, {}, true))).toEqual([
      'person_pan',
      'as_on_date',
      'total_assets',
      'total_liabilities',
      'net_worth',
    ]);
  });

  it('flags a bad value and a figure that does not add up as soon as it is typed', () => {
    expect(
      figureErrors(
        template,
        { person_pan: 'ABC', total_assets: '100', total_liabilities: '40', net_worth: '50' },
        false,
      ),
    ).toEqual({
      person_pan: 'PAN must be a PAN (AAAAA9999A).',
      net_worth: 'Net worth must equal Total assets less Total liabilities (60.00).',
    });
  });
});

function Harness(): JSX.Element {
  const [f, setF] = useState<Figures>({ total_assets: '100', total_liabilities: '40' });
  return (
    <CertificateFigures
      template={template}
      figures={f}
      onChange={setF}
      errors={figureErrors(template, f, false)}
    />
  );
}

describe('CertificateFigures', () => {
  it('draws a field per variable, typed by the variable, with the check under its field', () => {
    render(<Harness />);
    expect(screen.getByLabelText('As on')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('TRC obtained').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Basis').tagName).toBe('TEXTAREA');
    const pan = screen.getByLabelText('PAN');
    fireEvent.change(pan, { target: { value: 'abcpk1234f' } });
    expect(pan).toHaveValue('ABCPK1234F');
    fireEvent.change(screen.getByLabelText('Net worth'), { target: { value: '50' } });
    expect(
      screen.getByText(/must equal Total assets less Total liabilities \(60\.00\)/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Net worth'), { target: { value: '60' } });
    expect(screen.queryByText(/must equal/)).not.toBeInTheDocument();
  });
});

describe('certificateRegisterPath', () => {
  it('leaves out the empty filters', () => {
    expect(certificateRegisterPath({ search: ' ', status: '', template: '' })).toBe(
      '/registers/certificates',
    );
    expect(
      certificateRegisterPath({ search: 'Acme', status: 'issued', template: 'CERT_15CB' }),
    ).toBe('/registers/certificates?search=Acme&status=issued&template=CERT_15CB');
  });
});
