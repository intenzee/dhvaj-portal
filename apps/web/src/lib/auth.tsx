'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch, getToken, setToken } from './api';
import { isSignedOut, reconnectDelay, renewalDue } from './session';
import { entraSignIn, entraSignOut, isEntraConfigured } from './entra';
import { newTelemetrySession } from './telemetry';
import type { Principal } from './principal';

interface AuthState {
  principal: Principal | null;
  loading: boolean;
  /** Dev-token sign-in (non-production only). */
  login: (email: string) => Promise<void>;
  /** Microsoft Entra SSO sign-in (production). */
  loginWithEntra: () => Promise<void>;
  entraEnabled: boolean;
  /**
   * Email + portal password. 'must_change' means it was a temporary password:
   * the person has to choose their own (changePassword) before they are in.
   */
  loginWithPassword: (email: string, password: string) => Promise<'ok' | 'must_change'>;
  /** Replace the current (or temporary) password; signs the person in. */
  changePassword: (email: string, currentPassword: string, newPassword: string) => Promise<void>;
  passwordEnabled: boolean;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Email + password sign-in is on unless the deployment turns it off. */
const passwordEnabled = process.env.NEXT_PUBLIC_PASSWORD_LOGIN !== 'false';

async function loadMe(): Promise<Principal> {
  const res = await apiFetch<{ principal: Principal }>('/auth/me');
  return res.principal;
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);
  // Every cached query was fetched under the previous identity's row-level
  // security scope. Drop the whole cache whenever the identity changes, or the
  // next user briefly sees the previous user's lists (e.g. a partner seeing
  // the Managing Partner's engagements).
  const queryClient = useQueryClient();

  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  // Only a 401 ends the session. If the API cannot be reached (it is
  // restarting, or the network blipped) keep the token and try again, so the
  // portal reconnects instead of asking to sign in.
  const refresh = useCallback(async () => {
    for (let attempt = 0; !unmounted.current; attempt++) {
      if (!getToken()) {
        setPrincipal(null);
        return;
      }
      try {
        setPrincipal(await loadMe());
        return;
      } catch (err) {
        if (isSignedOut(err)) {
          setToken(null);
          setPrincipal(null);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, reconnectDelay(attempt)));
      }
    }
  }, []);

  // On first mount, restore a session if a token is present.
  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  // Swap the token for a fresh one while the portal is in use, so a working
  // session does not lapse. Dev and password sign-in renew this way; for
  // Microsoft the API answers 404 and the portal stops asking.
  const signedIn = principal !== null;
  useEffect(() => {
    if (!signedIn) return;
    let stopped = false;
    let busy = false;
    const renew = async (): Promise<void> => {
      const token = getToken();
      if (stopped || busy || !token || !renewalDue(token)) return;
      busy = true;
      try {
        const res = await apiFetch<{ accessToken: string }>('/auth/renew', { method: 'POST' });
        // Not if the user signed out or switched while this was in flight.
        if (getToken() === token) setToken(res.accessToken);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) stopped = true;
      } finally {
        busy = false;
      }
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void renew();
    };
    void renew();
    const timer = window.setInterval(() => void renew(), 60_000);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [signedIn]);

  const login = useCallback(async (email: string) => {
    const res = await apiFetch<{ accessToken: string }>('/auth/dev-token', {
      method: 'POST',
      body: { email },
      anonymous: true,
    });
    queryClient.clear();
    newTelemetrySession();
    setToken(res.accessToken);
    setPrincipal(await loadMe());
  }, [queryClient]);

  const loginWithEntra = useCallback(async () => {
    const accessToken = await entraSignIn();
    queryClient.clear();
    newTelemetrySession();
    setToken(accessToken);
    setPrincipal(await loadMe());
  }, [queryClient]);

  const startSession = useCallback(
    async (accessToken: string) => {
      queryClient.clear();
      newTelemetrySession();
      setToken(accessToken);
      setPrincipal(await loadMe());
    },
    [queryClient],
  );

  const loginWithPassword = useCallback(
    async (email: string, password: string): Promise<'ok' | 'must_change'> => {
      const res = await apiFetch<{ accessToken?: string; mustChangePassword?: boolean }>(
        '/auth/login',
        { method: 'POST', body: { email, password }, anonymous: true },
      );
      if (res.mustChangePassword || !res.accessToken) return 'must_change';
      await startSession(res.accessToken);
      return 'ok';
    },
    [startSession],
  );

  const changePassword = useCallback(
    async (email: string, currentPassword: string, newPassword: string) => {
      const res = await apiFetch<{ accessToken: string }>('/auth/password', {
        method: 'POST',
        body: { email, currentPassword, newPassword },
        anonymous: true,
      });
      await startSession(res.accessToken);
    },
    [startSession],
  );

  const logout = useCallback(() => {
    const viaMicrosoft = principal?.authMethod !== 'password';
    // Change 3: signing out closes the automatic clock (signed_out). The token
    // is read synchronously, so the request carries it even though it is
    // cleared on the next line; failures never block signing out.
    void apiFetch('/time/sign-out', { method: 'POST' }).catch(() => undefined);
    setToken(null);
    setPrincipal(null);
    queryClient.clear();
    // A password session has no Microsoft account to sign out of.
    if (isEntraConfigured && viaMicrosoft) void entraSignOut().catch(() => undefined);
  }, [queryClient, principal]);

  return (
    <AuthContext.Provider
      value={{
        principal,
        loading,
        login,
        loginWithEntra,
        entraEnabled: isEntraConfigured,
        loginWithPassword,
        changePassword,
        passwordEnabled,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>.');
  return ctx;
}
