import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RISK_TILES, RISK_TILE_LABEL, type RiskTile, type RiskTileKey } from '@hsdg/contracts';
import { RiskSection } from '../risk-section';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
let flagOn = true;
jest.mock('@/lib/feature-flags', () => ({
  useFeatureFlags: () => ({ isOn: () => flagOn, isLoading: false, flags: {} }),
}));
let role = 'partner';
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    principal: { effectiveRole: role, roles: [role], permissions: ['report.read'] },
  }),
}));
jest.mock('@/lib/principal', () => ({
  can: (p: { permissions: string[] } | null, perm: string) => !!p?.permissions.includes(perm),
}));

const tile = (key: RiskTileKey, over: Partial<RiskTile> = {}): RiskTile => ({
  key,
  count: 0,
  items: [],
  href: `/list/${key}`,
  available: true,
  ...over,
});

function renderSection(tiles: Partial<Record<RiskTileKey, Partial<RiskTile>>>) {
  apiFetch.mockImplementation((path: string) => {
    const key = /\/dashboard\/risk\/([a-z_]+)/.exec(path)![1] as RiskTileKey;
    const offset = Number(/offset=(\d+)/.exec(path)![1]);
    const t = tile(key, tiles[key]);
    return Promise.resolve({ ...t, items: t.items.slice(offset, offset + 5) });
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RiskSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiFetch.mockReset();
  flagOn = true;
  role = 'partner';
});

describe('Risk section on the partner Home (PS-301)', () => {
  it('loads each tile on its own; items open the work', async () => {
    renderSection({
      notices: {
        count: 1,
        items: [
          {
            ref: { engagementId: 'e1', engagementKind: 'compliance', noticeId: 'n1' },
            title: 'Scrutiny · ABC/1',
            detail: 'Bharat Textiles · Reply due',
            dueOn: '2026-11-06',
          },
        ],
      },
      receivables: {
        count: 2,
        amount: '150000.00',
        items: [
          {
            ref: null,
            href: '/billing/clients/c1',
            title: 'INV/1',
            detail: 'Bharat',
            dueOn: '2026-07-01',
          },
        ],
      },
      dsc: { available: false },
      kyc: {
        count: 1,
        items: [
          {
            ref: null,
            href: '/entities/c9',
            title: 'Bharat Textiles',
            detail: 'No complete KYC on file',
            dueOn: null,
          },
        ],
      },
    });
    const notices = await screen.findByRole('region', { name: RISK_TILE_LABEL.notices });
    expect(await within(notices).findByText('Scrutiny · ABC/1')).toBeInTheDocument();
    expect(within(notices).getByText('Scrutiny · ABC/1').closest('a')).toHaveAttribute(
      'href',
      '/notices/n1',
    );
    const owed = screen.getByRole('region', { name: RISK_TILE_LABEL.receivables });
    expect(await within(owed).findByText(/1,50,000/)).toBeInTheDocument();
    expect(within(owed).getByText('INV/1').closest('a')).toHaveAttribute(
      'href',
      '/billing/clients/c1',
    );
    const dsc = screen.getByRole('region', { name: RISK_TILE_LABEL.dsc });
    expect(await within(dsc).findByText(/once the register is in use/)).toBeInTheDocument();
    const kyc = screen.getByRole('region', { name: RISK_TILE_LABEL.kyc });
    expect((await within(kyc).findByText('Bharat Textiles')).closest('a')).toHaveAttribute(
      'href',
      '/entities/c9',
    );
    expect(apiFetch).toHaveBeenCalledTimes(RISK_TILES.length);
    expect(apiFetch.mock.calls.map((c) => c[0])).toContain(
      '/dashboard/risk/missed?limit=5&offset=0',
    );
  });

  it('pages a tile with more than five items', async () => {
    const items = Array.from({ length: 7 }, (_, n) => ({
      ref: { engagementId: 'e1', engagementKind: 'compliance' as const, instanceId: `i${n}` },
      title: `Filing ${n + 1}`,
      detail: 'Bharat',
      dueOn: '2026-10-01',
    }));
    renderSection({ missed: { count: 7, items } });
    const missed = await screen.findByRole('region', { name: RISK_TILE_LABEL.missed });
    expect(await within(missed).findByText('1–5 of 7')).toBeInTheDocument();
    fireEvent.click(within(missed).getByRole('button', { name: 'Next' }));
    expect(await within(missed).findByText('Filing 6')).toBeInTheDocument();
    expect(within(missed).getByText('6–7 of 7')).toBeInTheDocument();
  });

  it('is not on Home with the flag off, or for a role below partner', () => {
    flagOn = false;
    const off = renderSection({});
    expect(off.container).toBeEmptyDOMElement();
    off.unmount();
    flagOn = true;
    role = 'senior';
    const senior = renderSection({});
    expect(senior.container).toBeEmptyDOMElement();
  });
});
