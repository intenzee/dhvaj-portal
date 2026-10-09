import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AuditMatterRecord } from '@hsdg/contracts';
import { MattersCard, matterQuestionKey } from '../matters-card';
import { openAuditPhase } from '../audit-file-nav';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));
jest.mock('../audit-file-nav', () => ({ openAuditPhase: jest.fn() }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const matter = {
  id: 'm1',
  matterCode: 'ACC-M-001',
  section: 'acceptance',
  source: 'acceptance:independence_ethics:ind_02',
  title: 'Independence threat disclosed',
  description: null,
  action: null,
  category: 'independence',
  severity: 'high',
  isBlocking: true,
  isAuto: true,
  ownerEmployeeId: 'e-mx',
  ownerName: 'Manager X',
  dueDate: '2026-10-16',
  status: 'open',
  resolution: null,
  suggestedResolution: 'Article assistant rotated off the engagement.',
  approverName: null,
  version: 3,
} as unknown as AuditMatterRecord;

describe('Acceptance Matters register (§11)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation((url: string, init?: { body?: unknown }) => {
      if (url.startsWith('/employees')) {
        return Promise.resolve({
          items: [
            { id: 'e-mx', fullName: 'Manager X' },
            { id: 'e-pa', fullName: 'Partner A' },
          ],
        });
      }
      if (init?.body) return Promise.resolve(matter);
      return Promise.resolve([matter]);
    });
  });

  it('reads the source question from the matter source', () => {
    expect(matterQuestionKey('acceptance:independence_ethics:ind_02:svc1')).toBe('ind_02');
    expect(matterQuestionKey('framework:caro')).toBeNull();
  });

  it('shows owner, due date and the link back to the question, and saves the register fields', async () => {
    render(
      wrap(
        <MattersCard engagementId="e1" workflowInstanceId="wf1" section="acceptance" canManage />,
      ),
    );
    await screen.findByText('ACC-M-001');
    expect(await screen.findByRole('option', { name: 'Partner A' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-10-16')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toHaveValue('Independence threat disclosed');

    await userEvent.click(screen.getByRole('button', { name: 'Go to IND-02' }));
    expect(openAuditPhase).toHaveBeenCalledWith('acceptance', 'question-ind_02');

    await userEvent.type(screen.getByLabelText('Action / safeguard'), 'Rotate off');
    await userEvent.selectOptions(screen.getByLabelText('Owner'), 'e-pa');
    await userEvent.click(screen.getByRole('button', { name: 'Under review' }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/matters/m1',
      expect.objectContaining({
        body: {
          description: '',
          action: 'Rotate off',
          ownerEmployeeId: 'e-pa',
          dueDate: '2026-10-16',
          status: 'under_review',
          version: 3,
        },
      }),
    );
  });
});
