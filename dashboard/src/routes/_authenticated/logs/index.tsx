import { createFileRoute } from '@tanstack/react-router'
import LogsPage from '@/features/logs'
import { requireDashboardAdmin } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/logs/')({
  beforeLoad: requireDashboardAdmin,
  component: LogsPage,
})
