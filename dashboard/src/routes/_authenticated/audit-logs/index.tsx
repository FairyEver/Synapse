import { createFileRoute } from '@tanstack/react-router'
import AuditLogsPage from '@/features/audit-logs'
import { requireDashboardAdmin } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/audit-logs/')({
  beforeLoad: requireDashboardAdmin,
  component: AuditLogsPage,
})
