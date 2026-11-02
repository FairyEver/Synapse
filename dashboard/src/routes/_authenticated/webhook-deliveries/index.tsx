import { createFileRoute, redirect } from '@tanstack/react-router'
import { webhookHistorySearchSchema } from '@/features/webhooks/webhook-workspace-search'

/** Preserve bookmarked history filters while using the single Webhook workspace. */
export const Route = createFileRoute('/_authenticated/webhook-deliveries/')({
  validateSearch: webhookHistorySearchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/webhooks/', search: { ...search, tab: 'deliveries' }, replace: true })
  },
})
