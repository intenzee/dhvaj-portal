import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  PERMISSION,
  RELAXED_FIRM_CHECKS,
  type FormInternalDueList,
  type WorkflowSettings,
} from '@hsdg/contracts';
import { WorkflowSection } from '../workflow-section';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
let permissions: string[] = [];
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: { permissions } }) }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const SETTINGS: WorkflowSettings = {
  defaultReviewer: 'engagement_manager',
  articleClientScope: 'office',
  clientReminderChannel: 'email',
  bulkAssignScope: 'managers_and_leads',
  clientReminderDays: 5,
  clientEscalationDays: 2,
  checks: RELAXED_FIRM_CHECKS,
  checksEditable: false,
  version: 3,
  updatedAt: '2026-10-14T00:00:00.000Z',
  updatedByName: 'Partner A',
};
const FORMS: FormInternalDueList = {
  items: [
    {
      ruleId: 'r1',
      ruleCode: 'GSTR1_MONTHLY',
      label: 'GSTR-1',
      stream: 'gst',
      internalSlaOffsetDays: 0,
      suggestedDays: 2,
    },
    {
      ruleId: 'r2',
      ruleCode: 'ROC_AOC4',
      label: 'AOC-4',
      stream: 'roc',
      internalSlaOffsetDays: 7,
      suggestedDays: null,
    },
  ],
};

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
  apiFetch.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
    if (path === '/workflow-settings' && !init) return Promise.resolve(SETTINGS);
    if (path === '/workflow-settings/internal-due') return Promise.resolve(FORMS);
    if (path === '/workflow-settings')
      return Promise.resolve({ ...SETTINGS, ...(init!.body as object), version: 4 });
    const days = (init!.body as { internalSlaOffsetDays: number }).internalSlaOffsetDays;
    return Promise.resolve({
      item: { ...FORMS.items[0]!, internalSlaOffsetDays: days },
      filingsRedated: 3,
    });
  });
});

it('a partner changes the default reviewer and only what changed is sent, with the version', async () => {
  permissions = [PERMISSION.workflowManage];
  render(wrap(<WorkflowSection />));
  const form = await screen.findByRole('form', { name: 'Workflow policy' });
  expect(within(form).getByText(/Last changed by Partner A/)).toBeInTheDocument();
  const save = within(form).getByRole('button', { name: 'Save policy' });
  expect(save).toBeDisabled();

  await userEvent.selectOptions(within(form).getByLabelText(/^Default reviewer/), 'stream_lead');
  await userEvent.click(save);
  expect(apiFetch).toHaveBeenCalledWith('/workflow-settings', {
    method: 'PATCH',
    body: { version: 3, defaultReviewer: 'stream_lead' },
  });
  expect(toast).toHaveBeenCalledWith('Workflow policy saved.');
});

it('will not save escalation later than the reminder', async () => {
  permissions = [PERMISSION.workflowManage];
  render(wrap(<WorkflowSection />));
  const form = await screen.findByRole('form', { name: 'Workflow policy' });
  const esc = within(form).getByLabelText(/Escalate to the stream lead/);
  await userEvent.clear(esc);
  await userEvent.type(esc, '9');
  expect(within(form).getByRole('button', { name: 'Save policy' })).toBeDisabled();
});

it('sets a form’s internal due date to the plan’s suggestion and says how many filings moved', async () => {
  permissions = [PERMISSION.workflowManage];
  render(wrap(<WorkflowSection />));
  const table = await screen.findByRole('region', { name: 'Internal due date per form' });
  const gstr1 = (await within(table).findByText('GSTR-1')).closest('tr')!;
  expect(within(gstr1).getByText('T-2')).toBeInTheDocument();
  // AOC-4 has no suggestion to offer.
  const aoc4 = within(table).getByText('AOC-4').closest('tr')!;
  expect(within(aoc4).queryByRole('button', { name: 'Use suggested' })).toBeNull();

  await userEvent.click(within(gstr1).getByRole('button', { name: 'Use suggested' }));
  expect(apiFetch).toHaveBeenCalledWith('/workflow-settings/internal-due/r1', {
    method: 'PATCH',
    body: { internalSlaOffsetDays: 2 },
  });
  expect(toast).toHaveBeenCalledWith('GSTR-1: T-2. 3 open filings re-dated.');
});

it('shows the policy read-only to someone who may not change it', async () => {
  permissions = [PERMISSION.userManage];
  render(wrap(<WorkflowSection />));
  const form = await screen.findByRole('form', { name: 'Workflow policy' });
  expect(within(form).getByLabelText(/^Default reviewer/)).toBeDisabled();
  expect(within(form).queryByRole('button', { name: 'Save policy' })).toBeNull();
  const table = screen.getByRole('region', { name: 'Internal due date per form' });
  expect(await within(table).findByText('T-7')).toBeInTheDocument();
  expect(within(table).queryByRole('button', { name: /Save/ })).toBeNull();
});
