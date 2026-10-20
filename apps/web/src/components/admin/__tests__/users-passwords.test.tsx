import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { UsersSection } from '../users-section';
import type { AdminUserRow } from '@/lib/types';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: { permissions: ['user.manage'] } }) }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const base: AdminUserRow = {
  id: 'u1',
  email: 'ravi@dhvaj.in',
  displayName: 'Ravi Kumar',
  officeId: 'o1',
  officeCode: 'NORTH',
  isActive: true,
  roles: ['senior'],
};
const USERS: AdminUserRow[] = [
  base,
  { ...base, id: 'u2', email: 'asha@dhvaj.in', displayName: 'Asha' },
  { ...base, id: 'u3', email: 'neha@dhvaj.in', displayName: 'Neha' },
  { ...base, id: 'u4', email: 'deepak@dhvaj.in', displayName: 'Deepak' },
];

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
  apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (path.startsWith('/users?')) return Promise.resolve({ items: USERS, total: 4, limit: 25, offset: 0 });
    if (path === '/offices') return Promise.resolve([{ id: 'o1', code: 'NORTH', name: 'Delhi', isActive: true }]);
    if (path === '/user-passwords') {
      return Promise.resolve({
        u1: { mustChange: false, locked: false },
        u2: { mustChange: true, locked: false },
        u3: { mustChange: false, locked: true },
      });
    }
    if (path === '/users' && init?.method === 'POST') return Promise.resolve({ ...base, id: 'u9', email: 'new@dhvaj.in' });
    if (path.endsWith('/password') && init?.method === 'POST') {
      return Promise.resolve({ temporaryPassword: 'Abcd-Efgh-Jkmn' });
    }
    return Promise.resolve(undefined);
  });
});

const rowOf = async (email: string) => (await screen.findByText(email)).closest('tr')!;

it('shows how each user signs in', async () => {
  render(wrap(<UsersSection />));
  expect(await within(await rowOf('ravi@dhvaj.in')).findByText('Password')).toBeInTheDocument();
  expect(await within(await rowOf('asha@dhvaj.in')).findByText('Temporary password')).toBeInTheDocument();
  expect(await within(await rowOf('neha@dhvaj.in')).findByText('Locked')).toBeInTheDocument();
  expect(await within(await rowOf('deepak@dhvaj.in')).findByText('Microsoft only')).toBeInTheDocument();
});

it('creates a user with a temporary password and shows it once', async () => {
  render(wrap(<UsersSection />));
  await userEvent.click(await screen.findByRole('button', { name: /New user/ }));
  await userEvent.type(screen.getByLabelText(/Email/), 'new@dhvaj.in');
  await userEvent.type(screen.getByLabelText(/Display name/), 'New Person');
  expect(screen.getByLabelText(/Give a portal password/)).toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: 'Create user' }));

  expect(apiFetch).toHaveBeenCalledWith('/users/u9/password', { method: 'POST' });
  expect(await screen.findByTestId('temporary-password')).toHaveTextContent('Abcd-Efgh-Jkmn');
  expect(screen.getByText('User created')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Copy sign-in details/ })).toBeInTheDocument();
});

it('creates a Microsoft-only user when no password is wanted', async () => {
  render(wrap(<UsersSection />));
  await userEvent.click(await screen.findByRole('button', { name: /New user/ }));
  await userEvent.type(screen.getByLabelText(/Email/), 'new@dhvaj.in');
  await userEvent.type(screen.getByLabelText(/Display name/), 'New Person');
  await userEvent.click(screen.getByLabelText(/Give a portal password/));
  await userEvent.click(screen.getByRole('button', { name: 'Create user' }));
  expect(toast).toHaveBeenCalledWith('User created.');
  expect(apiFetch).not.toHaveBeenCalledWith('/users/u9/password', expect.anything());
});

it('resets a locked password from Edit', async () => {
  render(wrap(<UsersSection />));
  const row = await rowOf('neha@dhvaj.in');
  await within(row).findByText('Locked');
  await userEvent.click(within(row).getByRole('button', { name: /Edit/ }));
  expect(screen.getByText(/Locked after 5 wrong passwords/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reset password' }));
  expect(apiFetch).toHaveBeenCalledWith('/users/u3/password', { method: 'POST' });
  expect(await screen.findByTestId('temporary-password')).toHaveTextContent('Abcd-Efgh-Jkmn');
});

it('turns off password sign-in', async () => {
  render(wrap(<UsersSection />));
  const row = await rowOf('ravi@dhvaj.in');
  await within(row).findByText('Password');
  await userEvent.click(within(row).getByRole('button', { name: /Edit/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Turn off password sign-in' }));
  expect(apiFetch).toHaveBeenCalledWith('/users/u1/password', { method: 'DELETE' });
});
