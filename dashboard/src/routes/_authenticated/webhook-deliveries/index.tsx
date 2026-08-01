import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import WebhookDeliveriesPage from '@/features/webhook-deliveries'

const searchSchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  webhookId: z.string().optional(),
  status: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  user: z.string().optional(),
  userId: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/webhook-deliveries/')({
  component: () => <WebhookDeliveriesPage mode='user' search={Route.useSearch()} />,
  validateSearch: searchSchema,
})
