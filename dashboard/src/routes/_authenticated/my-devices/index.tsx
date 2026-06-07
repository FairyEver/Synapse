import { createFileRoute } from '@tanstack/react-router'
import MyDevicesPage from '@/features/my-devices'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/my-devices/')({
  beforeLoad: requireDashboardUser,
  component: MyDevicesPage,
})
