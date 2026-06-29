import { createFileRoute } from '@tanstack/react-router'
import { DriveConsolePage } from '@/features/drive-console/drive-console-page'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/drive/')({
  beforeLoad: requireDashboardUser,
  component: DriveConsolePage,
})
