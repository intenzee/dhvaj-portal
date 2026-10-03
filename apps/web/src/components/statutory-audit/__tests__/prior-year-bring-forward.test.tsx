import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { CarriedMattersSection } from '../planning-strategy-sections';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((url: string) =>
    url.endsWith('/import') ? Promise.resolve({ matters: [], added: 2 }) : Promise.resolve([]),
  );
});

describe('03.1.6 prior-year matters', () => {
  it('brings last year’s matters forward from the portal file in one click', async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <CarriedMattersSection
          engagementId="e1"
          base="/engagements/e1/statutory-audit/wf1"
          qk={['pi']}
          signals={[]}
          initialAudit={false}
          editable
          onChanged={jest.fn()}
        />,
      ),
    );
    await user.click(await screen.findByRole('button', { name: /Bring forward from last year/ }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/prior-year-matters/import',
      { method: 'POST', body: {} },
    );
  });

  it('offers no import on a first-year audit', async () => {
    render(
      wrap(
        <CarriedMattersSection
          engagementId="e1"
          base="/b"
          qk={['pi']}
          signals={[]}
          initialAudit
          editable
          onChanged={jest.fn()}
        />,
      ),
    );
    expect(await screen.findByText(/Initial audit/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bring forward/ })).not.toBeInTheDocument();
  });
});
