import { createFileRoute } from '@tanstack/react-router'
import { ContentStoreCreatePage } from '@/features/content-store'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/my-content/new')({
  beforeLoad: requireDashboardUser,
  component: () => <ContentStoreCreatePage />,
})
