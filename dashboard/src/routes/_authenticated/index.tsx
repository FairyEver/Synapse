import { createFileRoute, Navigate } from '@tanstack/react-router'
import { getDashboardHomePath } from '@/lib/dashboard-role'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/')({
  component: AuthenticatedIndexRoute,
})

function AuthenticatedIndexRoute() {
  const role = useAuthStore((state) => state.auth.user?.role)
  return <Navigate to={getDashboardHomePath(role)} replace />
}
