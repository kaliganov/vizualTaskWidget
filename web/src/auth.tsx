import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export type User = {
  id: string;
  email: string;
  name: string;
  companyId: string;
};

type AuthCtx = {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('vp_token');
    if (!token) {
      setReady(true);
      return;
    }
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => {
        localStorage.removeItem('vp_token');
        setUser(null);
      })
      .finally(() => setReady(true));
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      ready,
      login: async (email, password) => {
        const res = await api<{ accessToken: string; user: User }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        localStorage.setItem('vp_token', res.accessToken);
        setUser(res.user);
      },
      logout: () => {
        localStorage.removeItem('vp_token');
        setUser(null);
      },
    }),
    [user, ready],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('AuthProvider missing');
  return ctx;
}
