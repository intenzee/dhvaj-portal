import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth, type LogoutOptions } from '../auth';
import { IDLE_NOTICE, LAST_ACTIVE_KEY, SIGN_OUT_NOTICE_KEY } from '../idle';

let token: string | null = null;
const apiFetch = jest.fn();
jest.mock('../api', () => {
  const actual = jest.requireActual('../api');
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetch(...args),
    getToken: () => token,
    setToken: (t: string | null) => {
      token = t;
    },
  };
});
const stopPush = jest.fn().mockResolvedValue(undefined);
jest.mock('../push', () => ({ stopPush: () => stopPush() }));
const entraSignOut = jest.fn().mockResolvedValue(undefined);
jest.mock('../entra', () => ({
  isEntraConfigured: true,
  entraSignIn: jest.fn(),
  entraSignOut: () => entraSignOut(),
}));
jest.mock('../telemetry', () => ({ newTelemetrySession: jest.fn() }));

const principal = {
  userId: 'u1',
  employeeId: 'e1',
  displayName: 'Sam Partner',
  authMethod: 'entra',
  permissions: [],
};

let logout: (options?: LogoutOptions) => void = () => undefined;
function Grab(): null {
  logout = useAuth().logout;
  return null;
}

async function signedIn(): Promise<void> {
  token = 'tok';
  apiFetch.mockImplementation((path: string) =>
    path === '/auth/me' ? Promise.resolve({ principal }) : Promise.resolve({}),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <Grab />
      </AuthProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/auth/me'));
  await act(async () => undefined);
}

describe('signing out', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
  });

  it('after 15 idle minutes keeps push alerts, skips Microsoft, and ends the clock at the last activity', async () => {
    await signedIn();
    const at = Date.now() - 15 * 60_000;
    act(() => logout({ reason: 'idle', at }));

    expect(token).toBeNull();
    expect(stopPush).not.toHaveBeenCalled();
    expect(entraSignOut).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledWith('/time/sign-out', {
      method: 'POST',
      body: { at: new Date(at).toISOString() },
    });
    expect(window.localStorage.getItem(SIGN_OUT_NOTICE_KEY)).toBe(IDLE_NOTICE);
  });

  it('with the Sign out button stops push on this browser and signs out of Microsoft', async () => {
    await signedIn();
    window.localStorage.setItem(SIGN_OUT_NOTICE_KEY, 'old');
    act(() => logout());

    expect(token).toBeNull();
    expect(stopPush).toHaveBeenCalledTimes(1);
    expect(entraSignOut).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith('/time/sign-out', { method: 'POST' });
    expect(window.localStorage.getItem(SIGN_OUT_NOTICE_KEY)).toBeNull();
  });
});
