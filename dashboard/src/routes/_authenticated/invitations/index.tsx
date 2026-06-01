import { createFileRoute } from '@tanstack/react-router'
import InvitationsPage from '@/features/invitations'
import { requireDashboardAdmin } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/invitations/')({
  beforeLoad: requireDashboardAdmin,
  component: InvitationsPage,
})
