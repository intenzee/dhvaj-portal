import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ScopeHandoff } from '@hsdg/contracts';
import { isScopeHandoffItem, ScopeHandoffCard } from '../scope-handoff-card';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const HANDOFF: ScopeHandoff = {
  available: true,
  versionLabel: 'v1.1',
  status: 'complete',
  specialists: [
    { observation: 'Unquoted investments', decision: 'likely_required', note: null, signalCode: 'PS-004' },
  ],
  components: [
    {
      code: 'SU-002',
      name: 'Pune Branch',
      auditor: 'branch_auditor',
      auditorStrategy: null,
      scopeConclusion: 'in_scope',
    },
  ],
  timing: [{ label: 'Inventory', status: 'year_end', rollForward: null, prompt: null }],
  dependencies: [
    {
      code: 'SD-001',
      description: 'ERP read access',
      neededBy: null,
      status: 'open',
      ownerName: 'Manager X',
      ownerParty: 'engagement_team',
    },
  ],
};

const props = { engagementId: 'e1', workflowInstanceId: 'w1' };

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue(HANDOFF);
});

describe('03.4 hand-off cards (03.8 / 03.9 / 03.11)', () => {
  it('knows which planning rows receive a hand-off', () => {
    expect(isScopeHandoffItem('specialist_planning')).toBe(true);
    expect(isScopeHandoffItem('component_planning')).toBe(true);
    expect(isScopeHandoffItem('timeline_milestones')).toBe(true);
    expect(isScopeHandoffItem('team_allocation')).toBe(false);
  });

  it('03.9 shows the units another firm audits, read-only, with the 03.4 version', async () => {
    render(wrap(<ScopeHandoffCard {...props} itemKey="component_planning" />));
    expect(await screen.findByText(/SU-002 Pune Branch/)).toBeInTheDocument();
    expect(screen.getByText(/03\.4 v1\.1/)).toBeInTheDocument();
    expect(screen.queryByText(/Unquoted investments/)).not.toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/w1/scope-approach/handoff');
  });

  it('03.11 shows the timing pattern and the open dependencies', async () => {
    render(wrap(<ScopeHandoffCard {...props} itemKey="timeline_milestones" />));
    expect(await screen.findByText('Inventory')).toBeInTheDocument();
    expect(screen.getByText(/SD-001 ERP read access/)).toBeInTheDocument();
    expect(screen.getByText(/owner: Manager X/)).toBeInTheDocument();
  });

  it('renders nothing before 03.4 exists', async () => {
    apiFetch.mockResolvedValue({ ...HANDOFF, available: false });
    const { container } = render(wrap(<ScopeHandoffCard {...props} itemKey="specialist_planning" />));
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
