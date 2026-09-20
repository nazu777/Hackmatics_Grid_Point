import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authMe, loginUser, signupUser, clearAuthToken, getAuthToken, setAuthToken } from '../services/api';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => getAuthToken());
  const [loading, setLoading] = useState<boolean>(!!getAuthToken());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = getAuthToken();
    if (!t) {
      setLoading(false);
      return;
    }
    authMe()
      .then((u) => setUser(u))
      .catch(() => {
        clearAuthToken();
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const res = await loginUser(email, password);
      setAuthToken(res.token);
      setToken(res.token);
      setUser(res.user);
    } catch (e: any) {
      setError(e?.message || 'Login failed');
      throw e;
    }
  }, []);

  const signup = useCallback(async (name: string, email: string, password: string) => {
    setError(null);
    try {
      const res = await signupUser(name, email, password);
      setAuthToken(res.token);
      setToken(res.token);
      setUser(res.user);
    } catch (e: any) {
      setError(e?.message || 'Signup failed');
      throw e;
    }
  }, []);

  const logout = useCallback(() => {
    clearAuthToken();
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, error, login, signup, logout }),
    [user, token, loading, error, login, signup, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
