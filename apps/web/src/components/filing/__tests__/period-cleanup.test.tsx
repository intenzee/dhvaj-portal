import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TreeItem, TreePeriod } from '@hsdg/contracts';
import { cleanupSummary, PeriodCleanup } from '../period-cleanup';
import { monthLabel } from '../start-fresh';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));

const item = (over: Partial<TreeItem> = {}): TreeItem => ({
  instanceId: 'i1',
  ruleCode: 'GST_GSTR3B',
  label: 'GSTR-3B',
  section: 'summary',
  dueDate: '2025-01-20',
  workflowStatus: 'not_started',
  filedOn: null,
  isLate: false,
  isOverdue: true,
  isProvisional: false,
  verify: false,
  requiredDone: 0,
  requiredTotal: 5,
  mine: false,
  ...over,
});

const period = (items: TreeItem[]): TreePeriod => ({
  periodKey: '2024-12',
  label: 'Dec 2024',
  quarter: null,
  sections: { summary: items },
  items: [],
  nextAction: null,
});

const renderIt = (p: TreePeriod, stream: 'gst' | 'tds' = 'gst') =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PeriodCleanup engagementId="e1" stream={stream} period={p} registrationId="r1" />
    </QueryClientProvider>,
  );

describe('PeriodCleanup', () => {
  beforeEach(() => apiFetch.mockReset());

  it('asks in place, then removes the month', async () => {
    apiFetch.mockResolvedValue({ filings: 2, tasks: 1, requests: 0 });
    renderIt(period([item()]));
    fireEvent.click(screen.getByRole('button', { name: 'Remove this month' }));
    expect(screen.getByText(/Remove Dec 2024\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() => expect(screen.getByText('Removed 2 filings, 1 task.')).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/streams/gst/periods/2024-12/remove', {
      method: 'POST',
      body: { registrationId: 'r1' },
    });
  });

  it('"No" closes the question without a call', () => {
    renderIt(period([item()]));
    fireEvent.click(screen.getByRole('button', { name: 'Remove this month' }));
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(screen.getByRole('button', { name: 'Remove this month' })).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('offers Restore on a removed month and nothing on a filed one', async () => {
    apiFetch.mockResolvedValue({ filings: 1, tasks: 1, requests: 0 });
    const { unmount } = renderIt(
      period([item({ workflowStatus: 'not_applicable', isOverdue: false, removed: true })]),
    );
    expect(screen.queryByRole('button', { name: 'Remove this month' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore month' }));
    await waitFor(() => expect(screen.getByText('Restored 1 filing, 1 task.')).toBeInTheDocument());
    expect(apiFetch.mock.calls[0]![0]).toBe('/engagements/e1/streams/gst/periods/2024-12/restore');
    unmount();

    const { container } = renderIt(period([item({ workflowStatus: 'filed', isOverdue: false })]));
    expect(container).toBeEmptyDOMElement();
  });

  it('says "period" outside GST', () => {
    renderIt(period([item()]), 'tds');
    expect(screen.getByRole('button', { name: 'Remove this period' })).toBeInTheDocument();
  });
});

describe('cleanup text', () => {
  it('summarises a result and labels a month', () => {
    expect(cleanupSummary({ filings: 0, tasks: 0, requests: 0 }, 'Removed')).toBe(
      'Nothing open to remove.',
    );
    expect(cleanupSummary({ filings: 1, tasks: 0, requests: 3 }, 'Removed')).toBe(
      'Removed 1 filing, 3 client requests.',
    );
    expect(monthLabel('2026-09')).toBe('Sep 2026');
  });
});
