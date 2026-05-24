import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';

import { DashboardLayout } from '@/components/dashboard-layout';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { AuditLogsPage } from '@/pages/audit-logs-page';
import { BackupPage } from '@/pages/backup-page';
import { InvitationsPage } from '@/pages/invitations-page';
import { LoginPage } from '@/pages/login-page';
import { LogsPage } from '@/pages/logs-page';
import { SignupPage } from '@/pages/signup-page';
import { SystemPage } from '@/pages/system-page';
import { TeamInvitePage } from '@/pages/team-invite-page';
import { TeamsPage } from '@/pages/teams-page';
import { UsersPage } from '@/pages/users-page';

function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        加载中
      </div>
    );
  }

  if (!isAuthenticated) {
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
        <Route element={<ProtectedRoute />}>
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
        <Route path="*" element={<Navigate to="/system" replace />} />
      </Routes>
    </AuthProvider>
  );
}
