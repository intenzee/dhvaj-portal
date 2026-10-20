import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { PeopleSection } from '../people-section';
import { UsersSection } from '../users-section';
import type { AdminEmployeeRow, AdminUserRow } from '@/lib/types';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
const permissions = ['employee.manage', 'employee.read', 'user.manage'];
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: { permissions } }) }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const OFFICES = [{ id: 'o1', code: 'NORTH', name: 'Delhi (North)', isActive: true }];
const DEEPAK: AdminUserRow = {
  id: 'u1',
  email: 'deepak@hsdg.in',
  displayName: 'Deepak Gupta',
  officeId: 'o1',
  officeCode: 'NORTH',
  isActive: true,
  roles: ['managing_partner'],
};
const DHARMENDER: AdminUserRow = { ...DEEPAK, id: 'u2', email: 'dharmender@dhvaj.in', displayName: 'Dharmender', roles: ['admin'] };
const EMP: AdminEmployeeRow = {
  id: 'e1',
  employeeCode: 'DA001',
  fullName: 'Deepak Gupta',
  gradeSlug: 'partner',
  gradeName: 'Partner',
  officeCode: 'NORTH',
  userId: 'u1',
  userEmail: 'deepak@hsdg.in',
  isPartner: true,
  employmentStatus: 'active',
  dateOfJoining: '2026-10-01',
  dateOfExit: null,
  membershipNo: null,
  partnerSince: null,
  version: 3,
};

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
  apiFetch.mockImplementation((path: string) => {
    if (path.startsWith('/employees?')) return Promise.resolve({ items: [EMP], total: 1, limit: 25, offset: 0 });
    if (path.startsWith('/users?')) return Promise.resolve({ items: [DEEPAK, DHARMENDER], total: 2, limit: 100, offset: 0 });
    if (path === '/offices') return Promise.resolve(OFFICES);
    return Promise.resolve({});
  });
});

it('lists employees with their portal login', async () => {
  render(wrap(<PeopleSection />));
  const row = (await screen.findByText('DA001')).closest('tr')!;
  expect(within(row).getByText('deepak@hsdg.in')).toBeInTheDocument();
  expect(within(row).getByText('Active')).toBeInTheDocument();
});

it('creates a partner with a membership number and a linked login', async () => {
  render(wrap(<PeopleSection />));
  await userEvent.click(await screen.findByRole('button', { name: /New employee/ }));
  await userEvent.type(screen.getByLabelText(/Employee code/), 'da002');
  await userEvent.type(screen.getByLabelText(/Full name/), 'Dharmender');
  await userEvent.selectOptions(screen.getByLabelText(/Grade/), 'partner');
  await userEvent.type(screen.getByLabelText(/Date of joining/), '2026-10-20');
  await userEvent.selectOptions(screen.getByLabelText(/Portal login/), 'u2');
  await userEvent.type(screen.getByLabelText(/ICAI membership no/), '512345');
  await userEvent.click(screen.getByRole('button', { name: 'Create employee' }));
  expect(apiFetch).toHaveBeenCalledWith('/employees', {
    method: 'POST',
    body: {
      employeeCode: 'DA002',
      fullName: 'Dharmender',
      gradeSlug: 'partner',
      officeCode: 'NORTH',
      dateOfJoining: '2026-10-20',
      userId: 'u2',
      membershipNo: '512345',
    },
  });
  expect(toast).toHaveBeenCalledWith('Employee created.');
});

it('hides partner details for a non-partner grade', async () => {
  render(wrap(<PeopleSection />));
  await userEvent.click(await screen.findByRole('button', { name: /New employee/ }));
  expect(screen.queryByLabelText(/ICAI membership no/)).toBeNull();
});

it('edits only what changed, with the version', async () => {
  render(wrap(<PeopleSection />));
  await userEvent.click(await screen.findByRole('button', { name: /Edit/ }));
  await userEvent.type(screen.getByLabelText(/ICAI membership no/), '512345');
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(apiFetch).toHaveBeenCalledWith('/employees/e1', {
    method: 'PATCH',
    body: { version: 3, membershipNo: '512345' },
  });
});

it('moves a user to a new sign-in email', async () => {
  render(wrap(<UsersSection />));
  const row = (await screen.findByText('deepak@hsdg.in')).closest('tr')!;
  await userEvent.click(within(row).getByRole('button', { name: /Edit/ }));
  const email = screen.getByLabelText(/Email/);
  await userEvent.clear(email);
  await userEvent.type(email, 'deepak@dhvaj.in');
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(apiFetch).toHaveBeenCalledWith('/users/u1', {
    method: 'PATCH',
    body: { email: 'deepak@dhvaj.in' },
  });
  expect(apiFetch).not.toHaveBeenCalledWith('/users/u1/roles', expect.anything());
});
