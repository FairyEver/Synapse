import { redirect } from '@tanstack/react-router'
import { buildDashboardRedirectPath } from './dashboard-redirect'
import { useAuthStore } from '@/stores/auth-store'

export function requireDashboardSession(location: Pick<Location, 'pathname' | 'search' | 'hash'>): void {
  if (!useAuthStore.getState().auth.isAuthenticated) {
    throw redirect({ to: '/sign-in', search: { redirect: buildDashboardRedirectPath(location) } })
  }
}
