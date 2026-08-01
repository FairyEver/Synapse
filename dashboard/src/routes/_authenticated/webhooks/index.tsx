import { createFileRoute } from '@tanstack/react-router'
import WebhooksPage from '@/features/webhooks'

export const Route = createFileRoute('/_authenticated/webhooks/')({
  component: WebhooksPage,
})
