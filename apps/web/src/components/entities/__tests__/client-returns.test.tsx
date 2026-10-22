import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ClientReturnLine, ClientReturns } from '@hsdg/contracts';
import {
  ClientReturnsCard,
  ReturnsGrid,
  returnCounts,
  returnLineLabel,
} from '@/components/entities/client-returns';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const line = (over: Partial<ClientReturnLine>): ClientReturnLine => ({
  entityId: 'e1',
  entityCode: 'C-0001',
  entityName: 'Bharat Traders',
  registrationId: 'r1',
  gstin: '07AAACB1234C1Z5',
  stateCode: '07',
  marks: {},
  updatedAt: '2026-10-21T10:00:00.000Z',
  ...over,
});

const data: ClientReturns = {
  periods: ['2026-04', '2026-05', '2026-27:Q1'],
  forms: ['GSTR1', 'GSTR3B'],
  lines: [
    line({
      marks: {
        '2026-04': { GSTR1: 'filed', GSTR3B: 'filed' },
        '2026-05': { GSTR1: 'not_applicable' },
      },
    }),
    line({
      entityId: 'e2',
      entityCode: 'C-0002',
      entityName: 'Kumar Clinic',
      registrationId: null,
      gstin: null,
      stateCode: '27',
      marks: { '2026-27:Q1': { GSTR1: 'filed' } },
    }),
  ],
};

beforeEach(() => apiFetch.mockReset());

describe('client GST returns', () => {
  it('labels a line by its GSTIN, else its state, else neither', () => {
    expect(returnLineLabel({ gstin: '07AAACB1234C1Z5', stateCode: '07' })).toBe('07AAACB1234C1Z5');
    expect(returnLineLabel({ gstin: null, stateCode: '27' })).toBe('Maharashtra (GSTIN not added)');
    expect(returnLineLabel({ gstin: null, stateCode: null })).toBe('No GSTIN in the sheet');
  });

  it('counts filed and NA marks', () => {
    expect(returnCounts(data.lines)).toEqual({ filed: 3, notApplicable: 1 });
  });

  it('lays the marks out as the sheet does: periods across, forms under each', () => {
    render(wrap(<ReturnsGrid data={data} showClient />));
    for (const p of ['Apr-26', 'May-26', 'Q1 26-27']) expect(screen.getByText(p)).toBeTruthy();
    expect(screen.getAllByText('Filed').length).toBe(3);
    expect(screen.getAllByText('NA').length).toBe(1);
    expect(screen.getByRole('link', { name: 'Kumar Clinic' }).getAttribute('href')).toBe(
      '/entities/e2',
    );
  });

  it("shows the client's card only when the sheet had marks for it", async () => {
    apiFetch.mockResolvedValueOnce({ ...data, lines: [data.lines[0]] });
    render(wrap(<ClientReturnsCard entityId="e1" />));
    expect(await screen.findByText('GST returns filed')).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith('/client-returns?entityId=e1');
    expect(screen.getByText(/2 filed · 1 NA/)).toBeTruthy();

    apiFetch.mockResolvedValueOnce({ periods: [], forms: [], lines: [] });
    const { container } = render(wrap(<ClientReturnsCard entityId="e3" />));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(container.textContent).toBe('');
  });
});
