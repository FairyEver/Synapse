import { createFileRoute } from '@tanstack/react-router'
import { ContentStoreEditorPage } from '@/features/content-store'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/my-content/$contentId_/edit')({
  beforeLoad: requireDashboardUser,
  component: () => (
    <ContentStoreEditorPage contentId={Route.useParams().contentId} />
  ),
})
