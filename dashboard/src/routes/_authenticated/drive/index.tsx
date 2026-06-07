import { createFileRoute } from '@tanstack/react-router'
import DriveAdminPage from '@/features/drive'
import { requireDashboardAdmin } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/drive/')({
  beforeLoad: requireDashboardAdmin,
  component: DriveAdminPage,
})
