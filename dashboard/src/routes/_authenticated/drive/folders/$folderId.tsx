import { createFileRoute } from '@tanstack/react-router'
import { useCallback } from 'react'
import { DriveConsoleItemPage } from '@/features/drive-console/drive-console-page'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/drive/folders/$folderId')({
  beforeLoad: requireDashboardUser,
  validateSearch: validateDriveBrowserSearch,
  component: RouteComponent,
})

function RouteComponent() {
  const { folderId } = Route.useParams()
  const { surface } = Route.useSearch()
  const navigate = Route.useNavigate()
  const handleDriveNavigate = useCallback((href: string) => {
    void navigate({ href })
  }, [navigate])

  return <DriveConsoleItemPage itemId={folderId} surface={surface} onNavigate={handleDriveNavigate} />
}

function validateDriveBrowserSearch(search: Record<string, unknown>) {
  return {
    surface: search.surface === 'standalone' ? 'standalone' as const : 'console' as const,
  }
}
