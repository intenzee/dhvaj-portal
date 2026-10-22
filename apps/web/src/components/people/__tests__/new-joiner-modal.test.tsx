import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { NewJoinerModal } from '../new-joiner-modal';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    principal: { permissions: ['employee.manage', 'user.onboard'], roles: ['hr'] },
  }),
}));

// Typing into several fields is slow on a loaded runner.
jest.setTimeout(20_000);

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const employee = {
  id: 'e9',
  employeeCode: 'DA021',
  fullName: 'Neha Joshi',
  dateOfJoining: '2026-10-21',
};

let employeeCreate: () => Promise<unknown>;
beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
  employeeCreate = () => Promise.resolve(employee);
  apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/offices') {
      return Promise.resolve([{ id: 'o1', code: 'NORTH', name: 'Delhi', isActive: true }]);
    }
    if (path.startsWith('/employees?')) {
      return Promise.resolve({
        items: [{ employeeCode: 'DA001' }],
        total: 1,
        limit: 100,
        offset: 0,
      });
    }
    if (path === '/users' && init?.method === 'POST') {
      return Promise.resolve({ id: 'u9', email: 'neha@dhvaj.in' });
    }
    if (path === '/employees' && init?.method === 'POST') return employeeCreate();
    if (path === '/users/u9/password')
      return Promise.resolve({ temporaryPassword: 'Abcd-Efgh-Jkmn' });
    return Promise.resolve(undefined);
  });
});

async function fill(code: string): Promise<void> {
  await userEvent.type(screen.getByLabelText(/Employee code/), code);
  await userEvent.type(screen.getByLabelText(/Full name/), 'Neha Joshi');
  await userEvent.type(screen.getByLabelText(/Work email/), 'neha@dhvaj.in');
}

it('offers HR only the article, senior and manager roles', async () => {
  render(wrap(<NewJoinerModal onClose={jest.fn()} />));
  const options = Array.from((screen.getByLabelText(/Role/) as HTMLSelectElement).options).map(
    (o) => o.value,
  );
  expect(options).toEqual(['', 'article', 'senior', 'manager']);
});

it('makes the login, then the employee linked to it, then a temporary password', async () => {
  render(wrap(<NewJoinerModal onClose={jest.fn()} />));
  await screen.findByRole('option', { name: /Delhi/ });
  await fill('DA021');
  await userEvent.click(screen.getByRole('button', { name: 'Add joiner' }));

  expect(await screen.findByTestId('temporary-password')).toHaveTextContent('Abcd-Efgh-Jkmn');
  const calls = apiFetch.mock.calls.map(([p, i]) => `${i?.method ?? 'GET'} ${p}`);
  expect(calls.filter((c) => !c.startsWith('GET'))).toEqual([
    'POST /users',
    'POST /employees',
    'POST /users/u9/password',
  ]);
  const users = apiFetch.mock.calls.find(([p, i]) => p === '/users' && i?.method === 'POST')!;
  expect(users[1].body).toMatchObject({ roles: ['article'], officeCode: 'NORTH' });
  const emp = apiFetch.mock.calls.find(([p, i]) => p === '/employees' && i?.method === 'POST')!;
  expect(emp[1].body).toMatchObject({ employeeCode: 'DA021', userId: 'u9', gradeSlug: 'article' });
});

it('refuses a code already in use before making anything', async () => {
  render(wrap(<NewJoinerModal onClose={jest.fn()} />));
  await screen.findByRole('option', { name: /Delhi/ });
  await fill('DA001');
  await userEvent.click(screen.getByRole('button', { name: 'Add joiner' }));

  await screen.findByRole('button', { name: 'Add joiner' });
  expect(toast).toHaveBeenCalledWith('Employee code DA001 is already in use.', 'error');
  expect(apiFetch.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
});

it('says what was made when the employee record is refused', async () => {
  employeeCreate = () => Promise.reject(new Error('no'));
  render(wrap(<NewJoinerModal onClose={jest.fn()} />));
  await screen.findByRole('option', { name: /Delhi/ });
  await fill('DA022');
  await userEvent.click(screen.getByRole('button', { name: 'Add joiner' }));

  expect(await screen.findByText('Partly done')).toBeInTheDocument();
  expect(
    screen.getByText(/The login neha@dhvaj.in was made, but the employee record was not/),
  ).toBeInTheDocument();
});
