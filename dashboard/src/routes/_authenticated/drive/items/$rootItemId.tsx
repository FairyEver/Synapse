import { createFileRoute } from '@tanstack/react-router'
import { DriveConsoleItemPage } from '@/features/drive-browser/drive-console-page'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/drive/items/$rootItemId')({
  beforeLoad: requireDashboardUser,
  component: RouteComponent,
})

function RouteComponent() {
  const { rootItemId } = Route.useParams()
  return <DriveConsoleItemPage rootItemId={rootItemId} />
}
