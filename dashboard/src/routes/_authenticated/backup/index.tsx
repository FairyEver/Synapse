import { createFileRoute } from '@tanstack/react-router'
import BackupPage from '@/features/backup'
import { requireDashboardAdmin } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/backup/')({
  beforeLoad: requireDashboardAdmin,
  component: BackupPage,
})
