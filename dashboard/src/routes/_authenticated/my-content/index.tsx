import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { MyContentListPage } from '@/features/content-store'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

const searchSchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'installCount']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  type: z.enum(['skill', 'rule', 'prompt']).optional(),
  query: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/my-content/')({
  beforeLoad: requireDashboardUser,
  validateSearch: searchSchema,
  component: () => <MyContentListPage search={Route.useSearch()} />,
})
