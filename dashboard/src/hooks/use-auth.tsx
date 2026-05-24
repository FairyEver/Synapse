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
  adminApi,
  subscribeAuthExpired,
} from '@/lib/api';

type AuthContextValue = {
  isAuthenticated: boolean;
  isLoading: boolean;
  session: AdminSession | null;
  login: (credentials: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    adminApi
      .getSession()
      .then((nextSession) => {
        if (isMounted) {
          setSession(nextSession);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 403) {
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
      setSession(await adminApi.login(credentials));
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await adminApi.logout();
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
