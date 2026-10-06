import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AuditCompletionItem, StatutoryAuditCompletion } from '@hsdg/contracts';
import { CompletionPanel } from '../completion-panel';

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

const item = (o: Partial<AuditCompletionItem> & { itemKey: string; title: string }) =>
  ({
    id: `id-${o.itemKey}`,
    section: 'completion',
    state: 'not_started',
    note: null,
    version: 1,
    updatedAt: '',
    stateSuggested: true,
    noteSuggested: false,
    evidence: { facts: [], suggestedState: 'not_started', ready: false, goTo: null },
    ...o,
  }) as AuditCompletionItem;

const file: StatutoryAuditCompletion = {
  workflowInstanceId: 'wf1',
  engagementServiceId: 's1',
  engagementId: 'e1',
  status: 'in_progress' as StatutoryAuditCompletion['status'],
  items: [
    item({
      itemKey: 'subsequent_events',
      title: 'Subsequent Events',
      state: 'in_progress',
      note: 'SA 560 — events after 31 March 2025 reviewed (P-07).',
      noteSuggested: true,
      evidence: {
        facts: ['1 of 1 linked procedure(s) complete.'],
        suggestedState: 'in_progress',
        ready: true,
        goTo: { phaseKey: 'audit_areas', label: 'Open audit work' },
      },
    }),
    item({
      itemKey: 'ifc',
      title: 'IFC Report',
      section: 'reporting',
      state: 'not_applicable',
      evidence: {
        facts: ['Section 02: IFC reporting not applicable.'],
        suggestedState: 'not_applicable',
        ready: true,
        goTo: { phaseKey: 'framework', label: 'Open Section 02 framework' },
      },
    }),
  ],
  gate: {
    completionItemsResolved: false,
    reportingItemsResolved: true,
    openBlockingNotes: 0,
    areasOpen: 2,
    completionApproved: false,
    signedOff: false,
    archived: false,
  },
  completionApprovedAt: null,
  completionApprovedByName: null,
  completionMemo: null,
  signedOffAt: null,
  signedOffByName: null,
  signoffMemo: null,
  archivedAt: null,
  archivedByName: null,
  archiveNote: null,
  signOffPack: {
    ready: false,
    attention: 1,
    engagementPartnerName: 'Partner A',
    draftMemo: 'Partner sign-off — financial year 2024-25.',
    checks: [
      {
        key: 'completion_approved',
        label: 'Completion approved (07)',
        ok: false,
        blocking: true,
        facts: ['Not yet approved — 1 completion item(s) open:'],
        goTo: { phaseKey: 'completion', label: 'Open completion checklist' },
      },
      {
        key: 'areas_concluded',
        label: 'Audit areas concluded (05/06)',
        ok: false,
        blocking: true,
        facts: ['0 of 2 audit area(s) concluded; not yet:', '• Cash and bank'],
        goTo: { phaseKey: 'audit_areas', label: 'Open audit work' },
      },
      {
        key: 'pbc',
        label: 'Client information (PBC)',
        ok: false,
        blocking: false,
        facts: ['2 PBC request(s) outstanding, 1 overdue.'],
        goTo: { phaseKey: 'pbc', label: 'Open PBC tracker' },
      },
    ],
  },
};

/** The same file with every §29 gate met — ready for the partner. */
const ready: StatutoryAuditCompletion = {
  ...file,
  gate: {
    ...file.gate,
    completionItemsResolved: true,
    areasOpen: 0,
    completionApproved: true,
  },
  signOffPack: { ...file.signOffPack, ready: true, attention: 0, checks: [] },
};

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
});

describe('completion checklist from the file', () => {
  it('shows the facts, links to the work and completes a ready item in one click', async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url.endsWith('/completion/suggest'))
        return Promise.resolve({ completion: file, itemsUpdated: 3 });
      return Promise.resolve([file]);
    });
    const opened: string[] = [];
    window.addEventListener('audit-file:open-phase', (e) =>
      opened.push((e as CustomEvent<string>).detail),
    );
    const user = userEvent.setup();
    render(wrap(<CompletionPanel engagementId="e1" />));

    expect(await screen.findByText('1 of 1 linked procedure(s) complete.')).toBeInTheDocument();
    expect(screen.getByText('Section 02: IFC reporting not applicable.')).toBeInTheDocument();
    expect(screen.getAllByText(/Drafted from the file/).length).toBe(2);
    expect(screen.getByText('Ready to complete')).toBeInTheDocument();

    // The item's link and the sign-off pack's both open the audit work.
    for (const b of screen.getAllByRole('button', { name: /Open audit work/ })) await user.click(b);
    await user.click(screen.getByRole('button', { name: /Open PBC tracker/ }));
    expect(opened).toEqual(['audit_areas', 'audit_areas', 'pbc']);
    expect(screen.getByText('2 of 2 gates open')).toBeInTheDocument();
    expect(screen.getByText('• Cash and bank')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Mark complete/ }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/completion/items/id-subsequent_events',
      { method: 'POST', body: { state: 'complete', version: 1 } },
    );

    await user.click(screen.getByRole('button', { name: /Refresh from the file/ }));
    expect(toast).toHaveBeenCalledWith('Updated 3 item(s) from the file.');
  });

  it("signs off with the drafted memo, or with the partner's own wording", async () => {
    apiFetch.mockResolvedValue([ready]);
    const user = userEvent.setup();
    render(wrap(<CompletionPanel engagementId="e1" />));
    expect(await screen.findByText('Ready to sign off')).toBeInTheDocument();
    expect(screen.getByText(/Signed by the engagement partner, Partner A/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign off' }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/sign-off', {
      method: 'POST',
      body: {},
    });

    const memo = screen.getByLabelText('Sign-off memo');
    await user.clear(memo);
    await user.type(memo, 'Signed after the going-concern discussion.');
    await user.click(screen.getByRole('button', { name: 'Sign off' }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/sign-off', {
      method: 'POST',
      body: { memo: 'Signed after the going-concern discussion.' },
    });
  });
});
