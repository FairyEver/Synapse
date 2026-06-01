import { createFileRoute } from '@tanstack/react-router'
import TeamsPage from '@/features/teams'
import { requireDashboardAdmin } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/teams/')({
  beforeLoad: requireDashboardAdmin,
  component: TeamsPage,
})
