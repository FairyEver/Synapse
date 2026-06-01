import { redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'

export function requireDashboardAdmin() {
  const { auth } = useAuthStore.getState()
  if (auth.user?.role !== 'admin') {
    throw redirect({ to: '/me', replace: true })
  }
}

export function requireDashboardUser() {
  const { auth } = useAuthStore.getState()
  if (auth.user?.role !== 'user') {
    throw redirect({ to: '/system', replace: true })
  }
}
