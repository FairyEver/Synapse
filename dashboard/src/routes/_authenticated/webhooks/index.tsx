import { createFileRoute } from '@tanstack/react-router'
import WebhooksPage from '@/features/webhooks'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/webhooks/')({
  beforeLoad: requireDashboardUser,
  component: WebhooksPage,
})
