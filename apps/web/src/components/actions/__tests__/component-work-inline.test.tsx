import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ComponentWorkSection } from '../component-work-section';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
jest.mock('@/lib/principal', () => ({ can: () => true }));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));
// The documents list itself is covered elsewhere; here we only care where it opens.
jest.mock('@/components/documents/documents-panel', () => ({
  DocumentsPanel: ({ scope }: { scope: { componentInstanceId: string } }) => (
    <p>docs:{scope.componentInstanceId}</p>
  ),
}));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const period = (id: string, periodLabel: string, periodStart: string) => ({
  id,
  componentName: 'GSTR-3B',
  periodLabel,
  periodStart,
  status: 'active',
  isFuture: false,
  isOverdue: false,
  statutoryDeadline: null,
  internalSlaDate: null,
  requiredDocsMissing: id === 'p2' ? 1 : 0,
  setsRegistrationType: null,
});

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({
    items: [period('p1', 'Apr 2026', '2026-04-01'), period('p2', 'May 2026', '2026-05-01')],
  });
});

describe('Services period documents open inline', () => {
  it('expands a period row with + and collapses it on a second click', async () => {
    const user = userEvent.setup();
    render(wrap(<ComponentWorkSection engagementId="e1" />));
    const rows = await screen.findAllByRole('button', { name: /GSTR-3B/ });
    const row = rows.find((b) => b.getAttribute('aria-expanded') !== null && b.closest('td'))!;

    await user.click(row);
    const panel = screen.getByRole('region', { name: 'GSTR-3B · Apr 2026' });
    expect(within(panel).getByText('docs:p1')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(row);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('opens a progress-grid cell under its component row', async () => {
    const user = userEvent.setup();
    render(wrap(<ComponentWorkSection engagementId="e1" />));
    const cell = await screen.findByTitle(/May 2026 .*required doc\(s\) missing/);
    await user.click(cell);
    const panel = screen.getByRole('region', { name: 'GSTR-3B · May 2026' });
    expect(panel).toHaveTextContent('1 required doc(s) missing');
    expect(within(panel).getByText('docs:p2')).toBeInTheDocument();

    await user.click(cell);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});
