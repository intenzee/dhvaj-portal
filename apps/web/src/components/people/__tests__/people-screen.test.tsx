import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PeopleRoster, PeopleRosterRow } from '@hsdg/contracts';
import { PeopleScreen } from '../people-screen';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
let roles = ['managing_partner'];
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ principal: { permissions: ['user.manage'], roles, role: roles[0] } }),
}));

jest.setTimeout(20_000);

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const person = (over: Partial<PeopleRosterRow>): PeopleRosterRow => ({
  employeeId: 'e1',
  employeeCode: 'EMP001',
  fullName: 'Someone',
  userId: 'u1',
  email: 'someone@dhvaj.in',
  loginActive: true,
  gradeSlug: 'senior',
  mainRole: 'senior',
  addOns: [],
  roles: ['senior'],
  reportsToId: null,
  reportsToName: null,
  officeCode: 'NORTH',
  employmentStatus: 'active',
  dateOfExit: null,
  openTasks: 0,
  ledEngagements: 0,
  version: 3,
  ...over,
});

const khushi = person({
  employeeId: 'k',
  employeeCode: 'EMP010',
  fullName: 'Khushi Sharma',
  userId: 'uk',
  gradeSlug: 'partner',
  mainRole: 'article',
  roles: ['article'],
  reportsToId: 'm',
  reportsToName: 'Meera Rao',
});
const meera = person({
  employeeId: 'm',
  employeeCode: 'EMP001',
  fullName: 'Meera Rao',
  userId: 'um',
  gradeSlug: 'partner',
  mainRole: 'managing_partner',
  roles: ['managing_partner'],
});

const roster: PeopleRoster = {
  people: [meera, khushi],
  checks: [
    {
      key: 'grade_role',
      title: 'Grade and main role disagree',
      hint: 'Pick the grade they are paid at and the role they work as.',
      people: [
        { employeeId: 'k', fullName: 'Khushi Sharma', detail: 'Grade Partner, role Article' },
      ],
    },
  ],
};

beforeEach(() => {
  roles = ['managing_partner'];
  apiFetch.mockReset();
  toast.mockReset();
  apiFetch.mockImplementation((path: string) => {
    if (path === '/people/admin/roster') return Promise.resolve(roster);
    if (path === '/offices') return Promise.resolve([{ id: 'o1', code: 'NORTH', name: 'North' }]);
    return Promise.resolve({});
  });
});

describe('People screen (B-2)', () => {
  it('shows the clean-up list and a chip where grade and role disagree', async () => {
    render(wrap(<PeopleScreen />));
    expect(await screen.findByText('Grade and main role disagree')).toBeInTheDocument();
    expect(screen.getByText('Grade Partner, role Article')).toBeInTheDocument();
    // Only Khushi's row carries the chip.
    expect(screen.getAllByText('Grade and role disagree')).toHaveLength(1);
  });

  it('offers to bring the main role along when the grade changes, as two separate saves', async () => {
    const user = userEvent.setup();
    render(wrap(<PeopleScreen />));
    await user.selectOptions(await screen.findByLabelText('Grade of Khushi Sharma'), 'article');
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/employees/k', {
        method: 'PATCH',
        body: { gradeSlug: 'article', version: 3 },
      }),
    );
    // Partner grade → Article grade, role already Article: nothing to offer.
    expect(screen.queryByText(/role .* too\?/)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Grade of Meera Rao'), 'manager');
    expect(await screen.findByText('Make Meera’s role Manager too?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, make it Manager' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/users/um/roles', {
        method: 'PUT',
        body: { roles: ['manager'] },
      }),
    );
  });

  it('draws the org chart from reports-to', async () => {
    const user = userEvent.setup();
    render(wrap(<PeopleScreen />));
    await user.click(await screen.findByRole('tab', { name: 'Org chart' }));
    const chart = screen.getByLabelText('Org chart');
    const top = within(chart).getByText('Meera Rao').closest('li')!;
    expect(within(top).getByText('Khushi Sharma')).toBeInTheDocument();
  });

  it('shows permanent delete to the administrator only', async () => {
    const user = userEvent.setup();
    const { unmount } = render(wrap(<PeopleScreen />));
    await user.click(
      await screen.findByRole('button', { name: 'Open leaving options for Khushi Sharma' }),
    );
    expect(screen.getByRole('region', { name: 'Deactivate' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Delete permanently' })).not.toBeInTheDocument();
    unmount();

    roles = ['admin'];
    render(wrap(<PeopleScreen />));
    await user.click(
      await screen.findByRole('button', { name: 'Open leaving options for Khushi Sharma' }),
    );
    expect(screen.getByRole('region', { name: 'Delete permanently' })).toBeInTheDocument();
  });
});
