import { createFileRoute } from '@tanstack/react-router'
import WebhookDetailPage from '@/features/webhooks/detail'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/webhooks/$webhookId')({
  beforeLoad: requireDashboardUser,
  component: WebhookDetailPage,
})
