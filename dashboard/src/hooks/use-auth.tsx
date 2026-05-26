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
  error: string;
  isAuthenticated: boolean;
  isLoading: boolean;
  session: AdminSession | null;
  login: (credentials: { email: string; password: string }) => Promise<AdminSession>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<AdminSession | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const nextSession = await dashboardApi.getSession();
      setSession(nextSession);
      setError('');
      return nextSession;
    } catch (nextError) {
      if (nextError instanceof ApiError && nextError.status === 401) {
        setSession(null);
        setError('');
        return null;
      }
      setError(nextError instanceof Error ? nextError.message : '会话加载失败');
      throw nextError;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    refreshSession()
      .catch(() => undefined)
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [refreshSession]);

  useEffect(() => subscribeAuthExpired(() => setSession(null)), []);

  useEffect(() => {
    if (!session) return undefined;

    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') {
        void refreshSession().catch(() => undefined);
      }
    }

    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refreshSession, session]);

  const login = useCallback(
    async (credentials: { email: string; password: string }) => {
      const nextSession = await dashboardApi.login(credentials);
      setSession(nextSession);
      setError('');
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
      error,
      isAuthenticated: session !== null,
      isLoading,
      session,
      login,
      logout,
      refreshSession,
    }),
    [error, isLoading, login, logout, refreshSession, session],
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
