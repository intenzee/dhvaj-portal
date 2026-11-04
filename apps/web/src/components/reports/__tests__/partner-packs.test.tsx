import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PartnerPackSummary } from '@hsdg/contracts';
import { PartnerPacks, recentMonths } from '../partner-packs';

const apiFetch = jest.fn();
const downloadFile = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  downloadFile: (...args: unknown[]) => downloadFile(...args),
}));
let flagOn = true;
jest.mock('@/lib/feature-flags', () => ({
  useFeatureFlags: () => ({ isOn: () => flagOn, isLoading: false, flags: {} }),
}));
let roles = ['partner'];
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    principal: { employeeId: 'e1', roles, permissions: ['report.read'] },
  }),
}));
jest.mock('@/lib/principal', () => ({
  can: (p: { permissions: string[] } | null, perm: string) => !!p?.permissions.includes(perm),
  hasRole: (p: { roles: string[] } | null, ...r: string[]) => !!p?.roles.some((x) => r.includes(x)),
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));

const pack: PartnerPackSummary = {
  id: 'p1',
  month: '2026-10',
  partnerEmployeeId: 'e1',
  partnerName: 'Asha Rao',
  generatedAt: '2026-11-03T01:30:00Z',
  headline: 'Risk 9 · Filed 86 · Collected ₹4,20,000.00',
};

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PartnerPacks />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiFetch.mockReset();
  downloadFile.mockReset().mockResolvedValue(new Headers());
  toast.mockReset();
  flagOn = true;
  roles = ['partner'];
});

describe('Reports → Partner packs (PS-303)', () => {
  it('lists the packs and downloads one as a PDF', async () => {
    apiFetch.mockResolvedValue([pack]);
    renderPage();
    expect(await screen.findByText(pack.headline)).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'October 2026' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Download the October 2026 pack/ }));
    await waitFor(() =>
      expect(downloadFile).toHaveBeenCalledWith(
        '/reports/partner-packs/p1/pdf',
        'partner-pack-2026-10.pdf',
      ),
    );
  });

  it('a partner builds a month', async () => {
    apiFetch.mockImplementation((_path: string, init?: { method?: string; body?: string }) =>
      Promise.resolve(
        init?.method === 'POST' ? { ...pack, month: JSON.parse(init.body!).month } : [],
      ),
    );
    renderPage();
    await screen.findByText(/No packs yet/);
    const month = screen.getByLabelText('Month') as HTMLSelectElement;
    fireEvent.change(month, { target: { value: month.options[2]!.value } });
    fireEvent.click(screen.getByRole('button', { name: /Build my pack/ }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/reports/partner-packs', {
        method: 'POST',
        body: JSON.stringify({ month: month.options[2]!.value }),
      }),
    );
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/is ready/)));
  });

  it('a manager reads packs but has none to build; off means off', async () => {
    roles = ['manager'];
    apiFetch.mockResolvedValue([]);
    renderPage();
    await screen.findByText(/No packs yet/);
    expect(screen.queryByRole('button', { name: /Build my pack/ })).toBeNull();
  });

  it('is hidden when the flag is off', () => {
    flagOn = false;
    renderPage();
    expect(screen.getByText(/not switched on/)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('months run back a year from this one', () => {
    expect(recentMonths('2026-02-15', 4)).toEqual(['2026-02', '2026-01', '2025-12', '2025-11']);
  });
});
