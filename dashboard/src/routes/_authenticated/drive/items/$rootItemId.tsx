import { createFileRoute } from '@tanstack/react-router'
import { DriveConsoleItemPage } from '@/features/drive-browser/drive-console-page'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/drive/items/$rootItemId')({
  beforeLoad: requireDashboardUser,
  validateSearch: validateDriveBrowserSearch,
  component: RouteComponent,
})

function RouteComponent() {
  const { rootItemId } = Route.useParams()
  const { surface } = Route.useSearch()
  return <DriveConsoleItemPage rootItemId={rootItemId} surface={surface} />
}

function validateDriveBrowserSearch(search: Record<string, unknown>) {
  return {
    surface: search.surface === 'standalone' ? 'standalone' as const : 'console' as const,
  }
}
