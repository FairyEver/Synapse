import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ContentStoreAdminPage } from '@/features/content-store'
import { requireDashboardAdmin } from '@/lib/dashboard-route-guards'

const searchSchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'installCount']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  type: z.enum(['skill', 'rule', 'prompt']).optional(),
  visibility: z.enum(['private', 'public']).optional(),
  moderationStatus: z.enum(['normal', 'removed']).optional(),
  query: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/content-store-admin/')({
  beforeLoad: requireDashboardAdmin,
  validateSearch: searchSchema,
  component: () => <ContentStoreAdminPage search={Route.useSearch()} />,
})
