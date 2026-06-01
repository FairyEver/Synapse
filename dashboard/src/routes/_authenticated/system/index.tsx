import { createFileRoute } from '@tanstack/react-router'
import SystemPage from '@/features/system'
import { requireDashboardAdmin } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/system/')({
  beforeLoad: requireDashboardAdmin,
  component: SystemPage,
})
