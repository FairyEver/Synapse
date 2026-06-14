import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { buildDashboardRedirectPath } from '@/lib/dashboard-redirect'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    if (!auth.isAuthenticated) {
      throw redirect({ to: '/sign-in', search: { redirect: buildDashboardRedirectPath(location) } })
    }
  },
  component: AuthenticatedLayout,
})
