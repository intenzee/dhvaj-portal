import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  FrameworkSummaryMatter,
  FrameworkSystemOverride,
  StatutoryAuditFrameworkSummary,
} from '@hsdg/contracts';
import { FrameworkSummaryJudgments } from '../framework-summary-judgments';
import { FrameworkSummaryMatters } from '../framework-summary-matters';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));
jest.mock('@/components/document-preview', () => ({
  DocumentPreview: ({ doc }: { doc: { title: string } }) => <p>Previewing {doc.title}</p>,
}));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const matter = (over: Partial<FrameworkSummaryMatter>): FrameworkSummaryMatter => ({
  id: 'm1',
  code: 'M-001',
  source: '02.4',
  category: 'information_pending',
  title: 'Matter',
  description: null,
  impact: null,
  ownerEmployeeId: null,
  ownerName: null,
  dueDate: null,
  status: 'open',
  partnerAttention: false,
  resolution: null,
  evidenceDocumentId: null,
  blocking: false,
  open: true,
  ...over,
});

const summary = (matters: FrameworkSummaryMatter[]) =>
  ({
    workflowInstanceId: 'wf1',
    engagementId: 'e1',
    header: { blockingMatterCount: 0, openMatterCount: matters.length },
    matters,
  }) as unknown as StatutoryAuditFrameworkSummary;

const props = (s: StatutoryAuditFrameworkSummary) => ({
  engagementId: 'e1',
  summary: s,
  canManage: false,
  onChanged: jest.fn(),
});

beforeEach(() => apiFetch.mockReset());

describe('02.8 §12 significant judgments and system overrides', () => {
  it('lists the judgment matters and every overridden system result with its reason', async () => {
    const overrides: FrameworkSystemOverride[] = [
      {
        source: '02.4',
        title: 'CARO 2020 applicability',
        systemResult: 'Applicable',
        conclusion: 'Not applicable',
        reason: 'Small company per audited figures',
        overriddenByName: 'Priya',
        overriddenAt: '2026-10-01T00:00:00Z',
      },
    ];
    apiFetch.mockResolvedValue(overrides);
    render(
      wrap(
        <FrameworkSummaryJudgments
          {...props(
            summary([
              matter({ id: 'a', title: 'Ind AS transition', category: 'technical_judgment' }),
              matter({ id: 'b', title: 'Pending bank letter' }),
            ]),
          )}
        />,
      ),
    );
    expect(screen.getByText('Ind AS transition')).toBeInTheDocument();
    expect(screen.queryByText('Pending bank letter')).not.toBeInTheDocument();
    expect(await screen.findByText('CARO 2020 applicability')).toBeInTheDocument();
    expect(screen.getByText('Reason: Small company per audited figures')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/framework-summary/overrides',
    );
  });

  it('says so when nothing was judged or overridden', async () => {
    apiFetch.mockResolvedValue([]);
    render(wrap(<FrameworkSummaryJudgments {...props(summary([]))} />));
    expect(screen.getByText('No significant framework judgment recorded.')).toBeInTheDocument();
    expect(await screen.findByText('No system result was overridden.')).toBeInTheDocument();
  });
});

describe('02.8 §7 matter evidence', () => {
  it('opens the evidence document linked to a matter', async () => {
    apiFetch.mockResolvedValue({ id: 'doc9', title: 'Legal opinion' });
    const user = userEvent.setup();
    render(
      wrap(
        <FrameworkSummaryMatters
          {...props(summary([matter({ title: 'Listing status', evidenceDocumentId: 'doc9' })]))}
        />,
      ),
    );
    await user.click(screen.getByRole('button', { name: /Open document/ }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/documents/doc9');
    expect(await screen.findByText('Previewing Legal opinion')).toBeInTheDocument();
  });
});
