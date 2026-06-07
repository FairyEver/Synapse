import { createFileRoute } from '@tanstack/react-router'
import DevicesPage from '@/features/devices'
import { requireDashboardAdmin } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/devices/')({
  beforeLoad: requireDashboardAdmin,
  component: DevicesPage,
})
