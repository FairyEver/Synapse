import { createFileRoute } from '@tanstack/react-router'
import { DriveConsoleItemPage } from '@/features/drive-console/drive-console-page'
import { navigateDriveBrowserUrl } from '@/features/drive-browser/shared/drive-navigation'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/drive/items/$browserItemId')({
  beforeLoad: requireDashboardUser,
  validateSearch: validateDriveBrowserSearch,
  component: RouteComponent,
})

function RouteComponent() {
  const { browserItemId } = Route.useParams()
  const { surface } = Route.useSearch()
  return <DriveConsoleItemPage itemId={browserItemId} surface={surface} onNavigate={navigateDriveBrowserUrl} />
}

function validateDriveBrowserSearch(search: Record<string, unknown>) {
  return {
    surface: search.surface === 'console' ? 'console' as const : 'standalone' as const,
  }
}
