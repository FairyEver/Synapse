import { createFileRoute } from '@tanstack/react-router'
import { MyContentDetailPage } from '@/features/content-store'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/my-content/$contentId')({
  beforeLoad: requireDashboardUser,
  component: () => (
    <MyContentDetailPage contentId={Route.useParams().contentId} />
  ),
})
