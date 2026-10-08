import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { WorkAreasPanel } from '../work-areas-panel';

const apiFetch = jest.fn();
const toast = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
jest.mock('@/lib/principal', () => ({ can: () => true }));
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const workArea = (key: string, title: string, source: string, detail = {}) => ({
  id: `id-${key}`,
  workAreaKey: key,
  title,
  scope: null,
  source,
  originAreaKey: null,
  state: 'not_started',
  isActive: true,
  generatedFromVersion: 1,
  sortOrder: 1,
  detail: {
    ownerEmployeeId: 'm',
    ownerName: 'Manager M',
    reviewerEmployeeId: 'p',
    reviewerName: 'Partner P',
    riskLevel: null,
    materiality: null,
    dueDate: null,
    financialCurrent: null,
    financialPrior: null,
    financialMovement: null,
    financialSource: null,
    conclusion: null,
    conclusionState: 'draft',
    detailVersion: 2,
    ...detail,
  },
  draftConclusion: null as string | null,
  reviewed: false,
  createdAt: '',
  updatedAt: '',
});

const generation = {
  workflowInstanceId: 'wf1',
  engagementServiceId: 's1',
  engagementId: 'e1',
  frameworkApproved: true,
  generatedFromVersion: 1,
  activeCount: 3,
  areas: [
    workArea('caro', 'CARO 2020 (21-clause) Workstream', 'framework:caro'),
    workArea('ifc', 'Internal Financial Controls (IFC) Workstream', 'framework:ifc'),
    workArea('fs_rev', 'Revenue', 'planning:03.5', {
      riskLevel: 'significant',
      financialCurrent: 1200,
      financialPrior: 1000,
      materiality: 75,
    }),
  ],
  pack: {
    checks: [
      {
        key: 'procedures_complete',
        label: 'Every procedure complete',
        ok: false,
        blocking: true,
        facts: [
          '1 of 2 procedure(s) complete; still open:',
          '• P2 Cut-off testing — in progress (Revenue)',
        ],
        goTo: { phaseKey: 'audit_areas', label: 'Open Revenue', anchor: 'area-id-fs_rev' },
      },
      {
        key: 'evidence',
        label: 'Completed procedures carry evidence',
        ok: false,
        blocking: false,
        facts: ['1 completed procedure(s) with no evidence linked:'],
        goTo: null,
      },
    ],
    ready: false,
    attention: 1,
    draftMemo: null,
  },
  controlsPack: {
    checks: [
      {
        key: 'procedures_complete',
        label: 'Every procedure complete',
        ok: true,
        blocking: true,
        facts: ['1 of 1 procedure(s) complete.'],
        goTo: null,
      },
    ],
    ready: true,
    attention: 0,
    draftMemo: null,
  },
};

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
});

describe('audit work builds itself', () => {
  it('shows filled-in areas grouped by source and refreshes suggested work', async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url.endsWith('/work-areas/suggest'))
        return Promise.resolve({
          generation,
          areasAdded: 0,
          detailsFilled: 0,
          proceduresAdded: 2,
        });
      return Promise.resolve([generation]);
    });
    const user = userEvent.setup();
    render(wrap(<WorkAreasPanel engagementId="e1" team={[]} />));
    expect(await screen.findByText('Financial statement areas (from 03.5)')).toBeInTheDocument();
    expect(screen.getByText('Significant risk')).toBeInTheDocument();
    expect(screen.getByText(/CY 1,200 · PY 1,000 · PM 75/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate work/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Refresh suggested work/ }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/work-areas/suggest',
      { method: 'POST', body: {} },
    );
    expect(toast).toHaveBeenCalledWith('Added 2 procedure(s).');
  });

  it('Phase 05 shows only the controls workstreams', async () => {
    apiFetch.mockResolvedValue([generation]);
    render(
      wrap(
        <WorkAreasPanel engagementId="e1" team={[]} only={['ifc', 'internal_audit_reliance']} />,
      ),
    );
    expect(
      await screen.findByText('Internal Financial Controls (IFC) Workstream'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Revenue')).not.toBeInTheDocument();
    expect(screen.queryByText('CARO 2020 (21-clause) Workstream')).not.toBeInTheDocument();
    expect(screen.getByText('Controls work · Phase 05')).toBeInTheDocument();
    expect(screen.getByText('Ready for completion')).toBeInTheDocument();
  });

  it('says what finishing the work needs and goes straight to the area, its conclusion drafted', async () => {
    const draft =
      'Revenue — procedures performed:\n• P2 Cut-off testing: No exceptions.\nExceptions: none identified.\nConclusion: based on the procedures performed, sufficient appropriate evidence has been obtained and no material misstatement was identified in Revenue.';
    const withDraft = {
      ...generation,
      areas: generation.areas.map((a) =>
        a.workAreaKey === 'fs_rev' ? { ...a, draftConclusion: draft } : a,
      ),
    };
    apiFetch.mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('/procedures') ? [] : [withDraft]),
    );
    const user = userEvent.setup();
    render(wrap(<WorkAreasPanel engagementId="e1" team={[]} />));
    expect(await screen.findByText('What finishing the work needs')).toBeInTheDocument();
    expect(screen.getByText('• P2 Cut-off testing — in progress (Revenue)')).toBeInTheDocument();
    expect(screen.getByText(/Worth knowing \(1 — never blocks\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Open Revenue/ }));
    expect(await screen.findByLabelText('Area conclusion')).toHaveValue(draft);
    expect(screen.getByText(/Drafted from the procedures/)).toBeInTheDocument();
  });
});
