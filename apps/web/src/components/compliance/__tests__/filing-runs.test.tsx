import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FilingRun, FilingRunForm, FilingRunRow } from '@hsdg/contracts';
import FilingRunsPage from '@/app/(portal)/compliance/runs/page';
import {
  actionable,
  bulkSummary,
  dataLabel,
  defaultForm,
  formKey,
  parseFormKey,
  pruneSelection,
  runProgress,
  toggleSelection,
} from '../filing-runs-model';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
let search = new URLSearchParams();
const replace = jest.fn((href: string) => {
  search = new URLSearchParams(href.split('?')[1] ?? '');
});
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace }),
  usePathname: () => '/compliance/runs',
  useSearchParams: () => search,
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
let flagOn = true;
jest.mock('@/lib/feature-flags', () => ({
  useFeatureFlags: () => ({
    isOn: (f: string) => (f === 'ff_filing_runs' ? flagOn : false),
    isLoading: false,
    flags: {},
  }),
}));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ principal: { permissions: ['engagement.read', 'engagement.manage'] } }),
}));
jest.mock('@/components/filing/filing-drawer', () => ({
  ...jest.requireActual('@/components/filing/filing-drawer'),
  FilingDrawer: ({ items }: { items: { instanceId: string }[] }) => (
    <div data-testid="drawer" data-open={search.get('open') ?? ''}>
      {items.map((i) => i.instanceId).join(',')}
    </div>
  ),
}));

const form = (over: Partial<FilingRunForm> = {}): FilingRunForm => ({
  rule: 'GST_GSTR1_M',
  formLabel: 'GSTR-1',
  section: 'outward',
  periodKey: '2026-09',
  periodLabel: 'Sep 2026',
  statutoryDate: '2026-10-11',
  total: 3,
  filed: 1,
  ...over,
});

const row = (instanceId: string, over: Partial<FilingRunRow> = {}): FilingRunRow => ({
  instanceId,
  engagementId: `e-${instanceId}`,
  engagementCode: `ENG-${instanceId}`,
  engagementKind: 'compliance',
  entityName: `Client ${instanceId}`,
  registrationNumber: '19AAACB1234C1Z5',
  data: {
    slotsRequired: 2,
    slotsFilled: 1,
    requestsTotal: 1,
    requestsOpen: 1,
    waitingOn: ['Bank statement'],
  },
  taskId: null,
  taskStatus: null,
  taskVersion: null,
  preparerId: null,
  preparerName: null,
  reviewerId: null,
  reviewerName: null,
  workflowStatus: 'not_started',
  internalDate: '2026-10-09',
  statutoryDate: '2026-10-11',
  filed: null,
  canLodge: false,
  canAssign: true,
  link: { engagementId: `e-${instanceId}`, engagementKind: 'compliance', instanceId },
  ...over,
});

describe('filing-runs model', () => {
  it('round-trips the picker key', () => {
    expect(parseFormKey(formKey({ rule: 'TDS_24Q', periodKey: '2026-27:Q2' }))).toEqual({
      rule: 'TDS_24Q',
      period: '2026-27:Q2',
    });
    expect(parseFormKey(null)).toBeNull();
    expect(parseFormKey('nopipe')).toBeNull();
    expect(parseFormKey('|2026-09')).toBeNull();
  });

  it('opens on the URL run, else the earliest form not fully filed', () => {
    const done = form({ rule: 'A', statutoryDate: '2026-10-01', total: 2, filed: 2 });
    const later = form({ rule: 'B', statutoryDate: '2026-10-20' });
    const sooner = form({ rule: 'C', statutoryDate: '2026-10-11' });
    expect(defaultForm([done, later, sooner], null)).toBe(sooner);
    expect(defaultForm([done, later, sooner], { rule: 'B', period: '2026-09' })).toBe(later);
    expect(defaultForm([done, later, sooner], { rule: 'Z', period: '2026-09' })).toBe(sooner);
    expect(defaultForm([done], null)).toBe(done);
    expect(defaultForm([], null)).toBeNull();
  });

  it('reads progress as "n of m filed"', () => {
    expect(runProgress({ filed: 18, total: 42 })).toEqual({ label: '18 of 42 filed', percent: 43 });
    expect(runProgress({ filed: 0, total: 0 }).percent).toBe(0);
  });

  it('labels the Data column', () => {
    expect(dataLabel(row('1').data)).toEqual({
      text: '1 waiting · 1/2 slots',
      tone: 'warn',
      title: 'Waiting on: Bank statement',
    });
    expect(
      dataLabel({
        slotsRequired: 2,
        slotsFilled: 2,
        requestsTotal: 1,
        requestsOpen: 0,
        waitingOn: [],
      }).tone,
    ).toBe('success');
    expect(
      dataLabel({
        slotsRequired: 0,
        slotsFilled: 0,
        requestsTotal: 0,
        requestsOpen: 0,
        waitingOn: [],
      }).text,
    ).toBe('—');
  });

  it('keeps bulk actions to rows that allow them', () => {
    const rows = [row('1'), row('2', { canAssign: false }), row('3', { workflowStatus: 'filed' })];
    const all = new Set(['1', '2', '3']);
    expect(actionable(rows, all, 'assign')).toEqual(['1', '3']);
    expect(actionable(rows, all, 'remind')).toEqual(['1', '2']);
  });

  it('toggles one, all, and prunes stale ids', () => {
    let s = toggleSelection(new Set(), ['1']);
    expect([...s]).toEqual(['1']);
    s = toggleSelection(s, ['1', '2']);
    expect([...s].sort()).toEqual(['1', '2']);
    s = toggleSelection(s, ['1', '2']);
    expect(s.size).toBe(0);
    expect([...pruneSelection(new Set(['1', 'gone']), [row('1')])]).toEqual(['1']);
  });

  it('summarises a partial bulk result', () => {
    expect(bulkSummary('assign', { succeeded: ['a', 'b'], failed: [] })).toEqual({
      message: 'Assigned 2 filings.',
      tone: 'success',
    });
    expect(
      bulkSummary('assign', { succeeded: ['a'], failed: [{ instanceId: 'b', message: 'x' }] }),
    ).toEqual({ message: 'Assigned 1 filing; 1 could not be done.', tone: 'error' });
    expect(
      bulkSummary('remind', { succeeded: [], failed: [{ instanceId: 'b', message: 'x' }] }).message,
    ).toBe('Could not remind 1 filing.');
  });
});

describe('Filing runs page', () => {
  const run: FilingRun = {
    rule: 'GST_GSTR1_M',
    formLabel: 'GSTR-1',
    periodKey: '2026-09',
    periodLabel: 'Sep 2026',
    total: 3,
    filed: 1,
    items: [
      row('1'),
      row('2', { canAssign: false }),
      row('3', {
        workflowStatus: 'filed',
        filed: { referenceNo: 'AA190926000001X', filedOn: '2026-10-10' },
      }),
    ],
  };

  const renderPage = () =>
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <FilingRunsPage />
      </QueryClientProvider>,
    );

  beforeEach(() => {
    flagOn = true;
    search = new URLSearchParams();
    apiFetch.mockReset();
    toast.mockReset();
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/compliance/runs/forms')) return Promise.resolve([form()]);
      if (path.startsWith('/compliance/runs?')) return Promise.resolve(run);
      if (path === '/compliance/runs/remind')
        return Promise.resolve({
          succeeded: ['1'],
          failed: [{ instanceId: '2', message: 'You are not on this engagement.' }],
          reminders: [
            {
              instanceId: '1',
              client: 'Client 1',
              channel: 'whatsapp',
              waUrl: 'https://wa.me/919876543210?text=Please',
              text: 'Please',
              waitingOn: ['Sales register'],
              raised: 0,
            },
          ],
        });
      return Promise.resolve({ items: [] });
    });
  });

  it('says so when the flag is off for the office', () => {
    flagOn = false;
    renderPage();
    expect(screen.getByText(/aren.t switched on for your office/)).toBeInTheDocument();
  });

  it('loads the next due run and shows progress', async () => {
    renderPage();
    expect(await screen.findByText('Client 1')).toBeInTheDocument();
    expect(screen.getAllByText('1 of 3 filed').length).toBeGreaterThan(0);
    expect(apiFetch).toHaveBeenCalledWith('/compliance/runs?rule=GST_GSTR1_M&period=2026-09');
    expect(screen.getByText('AA190926000001X')).toBeInTheDocument();
  });

  it('reminds the selected filings and lists the ones that failed', async () => {
    renderPage();
    await screen.findByText('Client 1');
    fireEvent.click(screen.getByLabelText('Select every filing'));
    const remind = screen.getByRole('button', { name: /Remind clients \(2\)/ });
    fireEvent.click(remind);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/compliance/runs/remind', {
        method: 'POST',
        body: { instanceIds: ['1', '2'] },
      }),
    );
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Client 2: You are not on this engagement/)).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith('Reminded 1 filing; 1 could not be done.', 'error');
    // Under the WhatsApp channel each reminded client is one tap away.
    const toSend = screen.getByRole('region', { name: 'Reminders to send' });
    expect(
      within(toSend).getByRole('link', { name: 'Open WhatsApp for Client 1' }),
    ).toHaveAttribute('href', 'https://wa.me/919876543210?text=Please');
    expect(
      within(toSend).getByRole('button', { name: 'Copy text for Client 1' }),
    ).toBeInTheDocument();
  });

  it('offers Assign only for filings the caller leads', async () => {
    renderPage();
    await screen.findByText('Client 1');
    fireEvent.click(screen.getByLabelText('Select Client 2'));
    expect(screen.getByRole('button', { name: /Assign/ })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Select Client 1'));
    expect(screen.getByRole('button', { name: 'Assign (1)' })).toBeEnabled();
  });

  it('a client click opens the filing in the drawer', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Client 1'));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('open=1'), { scroll: false });
  });
});
