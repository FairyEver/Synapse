import { createFileRoute } from '@tanstack/react-router'
import UsersPage from '@/features/users'
import { requireDashboardAdmin } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/users/')({
  beforeLoad: requireDashboardAdmin,
  component: UsersPage,
})
