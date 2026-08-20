'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch, setToken } from './api';
import type { Principal } from './principal';

interface AuthState {
  principal: Principal | null;
  loading: boolean;
  /** Dev-token sign-in (non-production). Real Entra SSO replaces this later. */
  login: (email: string) => Promise<void>;
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

  const logout = useCallback(() => {
    setToken(null);
    setPrincipal(null);
  }, []);

  return (
    <AuthContext.Provider value={{ principal, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>.');
  return ctx;
}
