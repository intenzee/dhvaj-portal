import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '@/app/login/page';
import { ApiError } from '@/lib/api';

const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace }),
  useSearchParams: () => new URLSearchParams(),
}));

const loginWithPassword = jest.fn();
const changePassword = jest.fn();
let entraEnabled = true;
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    principal: null,
    loading: false,
    login: jest.fn(),
    loginWithEntra: jest.fn(),
    entraEnabled,
    loginWithPassword,
    changePassword,
    passwordEnabled: true,
  }),
}));

beforeEach(() => {
  replace.mockReset();
  loginWithPassword.mockReset();
  changePassword.mockReset();
  entraEnabled = true;
});

const signIn = async (email: string, password: string): Promise<void> => {
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
};

it('offers email + password and Microsoft', () => {
  render(<LoginPage />);
  expect(screen.getByLabelText('Email')).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeInTheDocument();
  expect(screen.getByText('or')).toBeInTheDocument();
});

it('signs in with email and password', async () => {
  loginWithPassword.mockResolvedValue('ok');
  render(<LoginPage />);
  await signIn(' ravi@dhvaj.in ', 'Monsoon-Ledger-42');
  expect(loginWithPassword).toHaveBeenCalledWith('ravi@dhvaj.in', 'Monsoon-Ledger-42');
  expect(replace).toHaveBeenCalled();
});

it('shows why a password was refused', async () => {
  loginWithPassword.mockRejectedValue(new ApiError(401, 'Email or password is incorrect.'));
  render(<LoginPage />);
  await signIn('ravi@dhvaj.in', 'nope-nope-nope');
  expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();
  expect(replace).not.toHaveBeenCalled();
});

it('makes a temporary password be replaced before signing in', async () => {
  loginWithPassword.mockResolvedValue('must_change');
  changePassword.mockResolvedValue(undefined);
  render(<LoginPage />);
  await signIn('ravi@dhvaj.in', 'Abcd-Efgh-Jkmn');
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByText(/Choose your own password/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sign in with Microsoft' })).toBeNull();

  await userEvent.type(screen.getByLabelText(/^New password/), 'Monsoon-Ledger-42');
  await userEvent.type(screen.getByLabelText('Confirm new password'), 'Monsoon-Ledger-43');
  await userEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));
  expect(screen.getByText('The two new passwords do not match.')).toBeInTheDocument();
  expect(changePassword).not.toHaveBeenCalled();

  await userEvent.clear(screen.getByLabelText('Confirm new password'));
  await userEvent.type(screen.getByLabelText('Confirm new password'), 'Monsoon-Ledger-42');
  await userEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));
  expect(changePassword).toHaveBeenCalledWith('ravi@dhvaj.in', 'Abcd-Efgh-Jkmn', 'Monsoon-Ledger-42');
  expect(replace).toHaveBeenCalled();
});

it('has no "or" divider when Microsoft sign-in is not configured', () => {
  entraEnabled = false;
  render(<LoginPage />);
  expect(screen.getByLabelText('Password')).toBeInTheDocument();
  expect(screen.queryByText('or')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Sign in with Microsoft' })).toBeNull();
});
