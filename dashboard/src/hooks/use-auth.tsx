import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  type AdminSession,
  ApiError,
  dashboardApi,
  subscribeAuthExpired,
} from '@/lib/api';

type AuthContextValue = {
  isAuthenticated: boolean;
  isLoading: boolean;
  session: AdminSession | null;
  login: (credentials: { email: string; password: string }) => Promise<AdminSession>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    dashboardApi
      .getSession()
      .then((nextSession) => {
        if (isMounted) {
          setSession(nextSession);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          return;
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => subscribeAuthExpired(() => setSession(null)), []);

  const login = useCallback(
    async (credentials: { email: string; password: string }) => {
      const nextSession = await dashboardApi.login(credentials);
      setSession(nextSession);
      return nextSession;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await dashboardApi.logout();
    } finally {
      setSession(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: session !== null,
      isLoading,
      session,
      login,
      logout,
    }),
    [isLoading, login, logout, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
