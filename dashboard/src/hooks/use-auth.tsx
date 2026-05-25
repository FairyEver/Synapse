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
          setSession(nextSession.role === 'admin' ? nextSession : null);
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
      const nextSession = await adminApi.login(credentials);
      if (nextSession.role !== 'admin') {
        throw new ApiError('需要管理员权限。', 403);
      }
      setSession(nextSession);
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
