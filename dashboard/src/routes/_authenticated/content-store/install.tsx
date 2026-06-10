import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ContentStoreInstallFallbackPage } from '@/features/content-store'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

const searchSchema = z.object({
  session: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/content-store/install')({
  beforeLoad: requireDashboardUser,
  validateSearch: searchSchema,
  component: () => (
    <ContentStoreInstallFallbackPage session={Route.useSearch().session} />
  ),
})
