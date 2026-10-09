import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AcceptancePanel } from '../acceptance-panel';
import { EntityProfileCard } from '../entity-profile-card';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
jest.mock('@/lib/principal', () => ({ can: () => true }));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const segment = (id: string, segmentKey: string, title: string, state = 'not_started') => ({
  id,
  segmentKey,
  title,
  state,
  sortOrder: 1,
  readOnly: segmentKey === 'engagement_profile',
  decidedByName: null,
  decidedAt: null,
  version: 1,
  answers: [],
  required: 1,
  answered: 0,
  pending: 0,
  attention: 0,
  attentionItems: [],
  notApplicableReason:
    state === 'not_applicable' ? 'continuing engagement — DHVAJ was the auditor last year.' : null,
});

beforeEach(() => apiFetch.mockReset());

describe('Section 01 acceptance prefill', () => {
  beforeEach(() => {
    apiFetch.mockResolvedValue([
      {
        workflowInstanceId: 'wf1',
        engagementServiceId: 'es1',
        engagementId: 'e1',
        phaseState: 'in_progress',
        engagementProfile: [
          { label: 'Client name', value: 'Acme Manufacturing Pvt Ltd', source: 'Entity master' },
          { label: 'CIN', value: 'U17110MH2015PTC123456', source: 'Entity master' },
          { label: 'Engagement manager', value: null, source: 'Engagement' },
          { label: 'First year / continuing audit', value: 'Continuing audit', source: 'System derived' },
        ],
        segments: [
          segment('s1', 'engagement_profile', 'Engagement Profile'),
          segment('s3', 'previous_auditor', 'Previous Auditor Communication', 'not_applicable'),
        ],
        approval: null,
        unresolvedSegmentCount: 2,
        openBlockingMatterCount: 0,
        readyForApproval: false,
        pack: { checks: [], ready: false, attention: 0, draftMemo: null, suggestedConclusion: 'accept' },
        context: {
          firstYear: false,
          firstYearSource: 'history',
          otherServices: [],
          independence: { required: 0, completed: 0, pending: 0, threatsDisclosed: 0, rows: [], mine: null },
          fileStatuses: {},
          priorYear: null,
          partner: null,
          manager: null,
        },
      },
    ]);
  });

  it('shows master facts read-only, with blanks marked, instead of input fields', async () => {
    render(wrap(<AcceptancePanel engagementId="e1" entityId="ent1" />));
    expect(await screen.findByText('Acme Manufacturing Pvt Ltd')).toBeInTheDocument();
    expect(screen.getByText('U17110MH2015PTC123456')).toBeInTheDocument();
    expect(screen.getByText('Not on master')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /update entity information/i })).toHaveAttribute(
      'href',
      '/entities/ent1',
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('asks EP-01 to confirm the facts, with no manual state buttons', async () => {
    render(wrap(<AcceptancePanel engagementId="e1" />));
    expect(await screen.findByText(/EP-01/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark complete/i })).not.toBeInTheDocument();
    apiFetch.mockResolvedValueOnce({});
    await userEvent.click(screen.getAllByRole('button', { name: /^yes/i })[0]!);
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/acceptance/segments/s1/answer',
      expect.objectContaining({ body: { questionKey: 'ep_01', answer: 'yes', details: {} } }),
    );
  });

  it('derives Not Applicable for previous-auditor communication on a continuing audit', async () => {
    render(wrap(<AcceptancePanel engagementId="e1" />));
    await userEvent.click(await screen.findByRole('button', { name: /previous auditor/i }));
    expect(screen.getByText(/DHVAJ was the auditor last year/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark not applicable/i })).not.toBeInTheDocument();
  });
});

describe('02.1 entity profile card', () => {
  it('renders master figures with their source and the computed outcome', async () => {
    apiFetch.mockResolvedValue([
      {
        initialAudit: false,
        smallCompany: { outcome: 'not_small', basis: 'Exceeds the paid-up ceiling.' },
        specialEntityTypes: [],
        saTriggers: [{ code: 'SA 510', triggered: false, basis: '' }],
        missingFacts: [],
        masterFacts: [
          { label: 'Turnover', value: '₹18,00,00,000', source: 'Financial profile FY 2026-27' },
        ],
      },
    ]);
    render(wrap(<EntityProfileCard engagementId="e1" />));
    expect(await screen.findByText('₹18,00,00,000')).toBeInTheDocument();
    expect(screen.getByText(/Financial profile FY 2026-27/)).toBeInTheDocument();
    expect(screen.getByText('Not a small company')).toBeInTheDocument();
  });
});
