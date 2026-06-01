import { createFileRoute } from '@tanstack/react-router'
import MePage from '@/features/me'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/me/')({
  beforeLoad: requireDashboardUser,
  component: MePage,
})
