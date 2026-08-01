import { createFileRoute } from '@tanstack/react-router'
import WebhookDetailPage from '@/features/webhooks/detail'

export const Route = createFileRoute('/_authenticated/webhooks/$webhookId')({
  component: WebhookDetailPage,
})
