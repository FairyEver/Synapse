import { createFileRoute } from '@tanstack/react-router'
import { useCallback } from 'react'
import { DriveConsoleItemPage } from '@/features/drive-console/drive-console-page'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/drive/items/$browserItemId')({
  beforeLoad: requireDashboardUser,
  validateSearch: validateDriveBrowserSearch,
  component: RouteComponent,
})

function RouteComponent() {
  const { browserItemId } = Route.useParams()
  const { surface } = Route.useSearch()
  const navigate = Route.useNavigate()
  const handleDriveNavigate = useCallback((href: string) => {
    void navigate({ href })
  }, [navigate])

  return <DriveConsoleItemPage itemId={browserItemId} surface={surface} onNavigate={handleDriveNavigate} />
}

function validateDriveBrowserSearch(search: Record<string, unknown>) {
  return {
    surface: search.surface === 'console' ? 'console' as const : 'standalone' as const,
  }
}
