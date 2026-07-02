import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SkillRepositoryAdminPage } from '@/features/skill-repository'
import { requireDashboardAdmin } from '@/lib/dashboard-route-guards'

const searchSchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'title', 'name']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  status: z.enum(['active', 'removed']).optional(),
  query: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/skill-repositories/admin')({
  beforeLoad: requireDashboardAdmin,
  validateSearch: searchSchema,
  component: () => <SkillRepositoryAdminPage search={Route.useSearch()} />,
})
