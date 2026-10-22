import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { RELAXED_FIRM_CHECKS, type WorkflowSettings } from '@hsdg/contracts';
import { ChecksSection } from '../checks-section';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const settings = (over: Partial<WorkflowSettings> = {}): WorkflowSettings => ({
  defaultReviewer: 'engagement_manager',
  articleClientScope: 'office',
  clientReminderChannel: 'email',
  bulkAssignScope: 'managers_and_leads',
  clientReminderDays: 5,
  clientEscalationDays: 2,
  checks: { ...RELAXED_FIRM_CHECKS, task_blockers: true },
  checksEditable: true,
  version: 7,
  updatedAt: '2026-10-23T00:00:00.000Z',
  updatedByName: 'Managing Partner',
  ...over,
});

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
});

it('the managing partner switches a check on and only the change is sent, with the version', async () => {
  const s = settings();
  apiFetch.mockImplementation((_path: string, init?: { body?: { checks: object } }) =>
    Promise.resolve(init ? { ...s, checks: { ...s.checks, ...init.body!.checks }, version: 8 } : s),
  );
  render(wrap(<ChecksSection />));
  const form = await screen.findByRole('form', { name: 'Firm checks' });
  expect(within(form).getByText(/1 of 23 checks are on/)).toBeInTheDocument();
  const save = within(form).getByRole('button', { name: 'Save checks' });
  expect(save).toBeDisabled();

  const ack = within(form).getByRole('checkbox', {
    name: /The acknowledgement must be uploaded to lodge/,
  });
  expect(ack).not.toBeChecked();
  expect(within(form).getByText(/Off — Optional; the filing shows "Ack missing"/)).toBeVisible();
  await userEvent.click(ack);
  await userEvent.click(save);
  expect(apiFetch).toHaveBeenCalledWith('/workflow-settings/checks', {
    method: 'PATCH',
    body: { version: 7, checks: { lodge_ack_required: true } },
  });
  expect(toast).toHaveBeenCalledWith('Checks saved.');
});

it('switch all off sends every check that was on', async () => {
  const s = settings({
    checks: { ...RELAXED_FIRM_CHECKS, review_required: true, task_blockers: true },
  });
  apiFetch.mockResolvedValue(s);
  render(wrap(<ChecksSection />));
  const form = await screen.findByRole('form', { name: 'Firm checks' });
  await userEvent.click(within(form).getByRole('button', { name: 'Switch all off' }));
  await userEvent.click(within(form).getByRole('button', { name: 'Save checks' }));
  expect(apiFetch).toHaveBeenCalledWith('/workflow-settings/checks', {
    method: 'PATCH',
    body: { version: 7, checks: { review_required: false, task_blockers: false } },
  });
});

it('a partner sees the checks but cannot switch them', async () => {
  apiFetch.mockResolvedValue(settings({ checksEditable: false }));
  render(wrap(<ChecksSection />));
  const form = await screen.findByRole('form', { name: 'Firm checks' });
  expect(
    within(form).getByText('Only the managing partner or the administrator can switch checks.'),
  ).toBeInTheDocument();
  for (const box of within(form).getAllByRole('checkbox')) expect(box).toBeDisabled();
  expect(within(form).queryByRole('button', { name: 'Save checks' })).toBeNull();
  expect(within(form).queryByRole('button', { name: 'Switch all off' })).toBeNull();
});
