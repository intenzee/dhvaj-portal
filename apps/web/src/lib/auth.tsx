'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch, setToken } from './api';
import { entraSignIn, entraSignOut, isEntraConfigured } from './entra';
import type { Principal } from './principal';

interface AuthState {
  principal: Principal | null;
  loading: boolean;
  /** Dev-token sign-in (non-production only). */
  login: (email: string) => Promise<void>;
  /** Microsoft Entra SSO sign-in (production). */
  loginWithEntra: () => Promise<void>;
  entraEnabled: boolean;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function loadMe(): Promise<Principal> {
  const res = await apiFetch<{ principal: Principal }>('/auth/me');
  return res.principal;
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setPrincipal(await loadMe());
    } catch {
      setToken(null);
      setPrincipal(null);
    }
  }, []);

  // On first mount, restore a session if a token is present.
  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const login = useCallback(async (email: string) => {
    const res = await apiFetch<{ accessToken: string }>('/auth/dev-token', {
      method: 'POST',
      body: { email },
      anonymous: true,
    });
    setToken(res.accessToken);
    setPrincipal(await loadMe());
  }, []);

  const loginWithEntra = useCallback(async () => {
    const accessToken = await entraSignIn();
    setToken(accessToken);
    setPrincipal(await loadMe());
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setPrincipal(null);
    if (isEntraConfigured) void entraSignOut().catch(() => undefined);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        principal,
        loading,
        login,
        loginWithEntra,
        entraEnabled: isEntraConfigured,
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
