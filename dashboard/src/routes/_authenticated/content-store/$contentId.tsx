import { createFileRoute } from '@tanstack/react-router'
import { ContentStoreDetailPage } from '@/features/content-store'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/content-store/$contentId')({
  beforeLoad: requireDashboardUser,
  component: () => (
    <ContentStoreDetailPage contentId={Route.useParams().contentId} />
  ),
})
