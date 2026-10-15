import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { FeatureRollout, FeatureRolloutList } from '@hsdg/contracts';
import { RolloutSection } from '../rollout-section';

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

const base: Omit<FeatureRollout, 'flag' | 'label'> = {
  deployed: true,
  deployOffices: null,
  mode: null,
  officeCodes: [],
  note: null,
  liveIn: 'all',
  version: 0,
  updatedAt: null,
  updatedByName: null,
};
const LIST: FeatureRolloutList = {
  items: [
    { ...base, flag: 'ff_today_view', label: 'Staff Workflow 2 — Today and the filing drawer' },
    { ...base, flag: 'ff_gst_tab', label: 'GST tab', deployed: false, liveIn: [] },
  ],
};
const OFFICES = [
  { id: 'o1', code: 'NORTH', name: 'Delhi (North)', isActive: true },
  { id: 'o2', code: 'SOUTH', name: 'Chennai (South)', isActive: true },
];

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
  apiFetch.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
    if (path === '/feature-rollouts') return Promise.resolve(LIST);
    if (path === '/offices') return Promise.resolve(OFFICES);
    const body = init!.body as { mode: string; officeCodes: string[] };
    return Promise.resolve({
      ...LIST.items[0]!,
      mode: body.mode,
      officeCodes: body.officeCodes,
      liveIn: body.officeCodes,
      version: 1,
      updatedByName: 'Managing Partner',
    });
  });
});

it('pilots a phase in one office', async () => {
  render(wrap(<RolloutSection />));
  const today = await screen.findByRole('listitem', { name: /Today and the filing drawer/ });
  expect(within(today).getByText('Every office')).toBeInTheDocument();
  await userEvent.click(within(today).getByRole('button', { name: 'Change' }));
  const form = within(today).getByRole('form', { name: /Rollout of/ });
  await userEvent.selectOptions(within(form).getByLabelText('Where it is on'), 'offices');
  const save = within(form).getByRole('button', { name: 'Save' });
  expect(save).toBeDisabled(); // no office chosen yet
  await userEvent.click(within(form).getByLabelText('Delhi (North) (NORTH)'));
  await userEvent.type(within(form).getByLabelText('Note'), 'North GST pilot');
  await userEvent.click(save);
  expect(apiFetch).toHaveBeenCalledWith('/feature-rollouts/ff_today_view', {
    method: 'PUT',
    body: { mode: 'offices', officeCodes: ['NORTH'], note: 'North GST pilot', version: 0 },
  });
  expect(toast).toHaveBeenCalledWith('Staff Workflow 2 — Today and the filing drawer: NORTH.');
});

it('a phase the deploy leaves off cannot be changed here', async () => {
  render(wrap(<RolloutSection />));
  const gst = await screen.findByRole('listitem', { name: 'GST tab' });
  expect(within(gst).getByText('Not in this deploy')).toBeInTheDocument();
  expect(within(gst).queryByRole('button', { name: 'Change' })).toBeNull();
});
