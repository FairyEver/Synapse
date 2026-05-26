import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';

import { DashboardLayout } from '@/components/dashboard-layout';
import { ErrorState } from '@/components/page-state';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { AuditLogsPage } from '@/pages/audit-logs-page';
import { BackupPage } from '@/pages/backup-page';
import { InvitationsPage } from '@/pages/invitations-page';
import { LoginPage } from '@/pages/login-page';
import { LogsPage } from '@/pages/logs-page';
import { MePage } from '@/pages/me-page';
import { SettingsPage } from '@/pages/settings-page';
import { SignupPage } from '@/pages/signup-page';
import { SystemPage } from '@/pages/system-page';
import { TeamInvitePage } from '@/pages/team-invite-page';
import { TeamsPage } from '@/pages/teams-page';
import { UsersPage } from '@/pages/users-page';

function ProtectedRoute({ roles }: { roles: Array<'admin' | 'user'> }) {
  const { error, isAuthenticated, isLoading, refreshSession, session } =
    useAuth();
  const location = useLocation();

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    void refreshSession().catch(() => undefined);
  }, [isAuthenticated, isLoading, location.pathname, refreshSession]);

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        加载中
      </div>
    );
  }

  if (error) {
    return (
      <main className="min-w-0 overflow-x-hidden overflow-y-auto p-4 pt-0">
        <ErrorState
          message={error}
          onRetry={() => void refreshSession().catch(() => undefined)}
        />
      </main>
    );
  }

  if (!isAuthenticated || !session || !roles.includes(session.role)) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/team-invite" element={<TeamInvitePage />} />
        <Route element={<ProtectedRoute roles={['admin']} />}>
          <Route element={<DashboardLayout />}>
            <Route index element={<Navigate to="/system" replace />} />
            <Route path="system" element={<SystemPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="teams" element={<TeamsPage />} />
            <Route path="invitations" element={<InvitationsPage />} />
            <Route path="audit-logs" element={<AuditLogsPage />} />
            <Route path="backup" element={<BackupPage />} />
            <Route path="logs" element={<LogsPage />} />
          </Route>
        </Route>
        <Route element={<ProtectedRoute roles={['user']} />}>
          <Route element={<DashboardLayout />}>
            <Route path="me" element={<MePage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </AuthProvider>
  );
}
