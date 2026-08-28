import { createFileRoute } from '@tanstack/react-router'
import { useCallback } from 'react'
import { DriveConsoleItemPage } from '@/features/drive-console/drive-console-page'
import type { DriveConsoleSystemView } from '@/features/drive-console/drive-file-table'
import { navigateDriveBrowserUrl } from '@/features/drive-browser/shared/drive-navigation'

export const Route = createFileRoute('/_authenticated/drive/folders/$folderId')({
  validateSearch: validateDriveBrowserSearch,
  component: RouteComponent,
})

function RouteComponent() {
  const { folderId } = Route.useParams()
  const { surface, view } = Route.useSearch()
  const navigate = Route.useNavigate()
  const handleViewChange = useCallback((nextView: DriveConsoleSystemView) => {
    void navigate({ search: { surface, view: nextView } })
  }, [navigate, surface])
  return (
    <DriveConsoleItemPage
      itemId={folderId}
      surface={surface}
      onNavigate={navigateDriveBrowserUrl}
      activeView={view}
      onViewChange={handleViewChange}
    />
  )
}

function validateDriveBrowserSearch(search: Record<string, unknown>) {
  return {
    surface: search.surface === 'standalone' ? 'standalone' as const : 'console' as const,
    view: parseDriveConsoleSystemView(search.view),
  }
}

function parseDriveConsoleSystemView(value: unknown): DriveConsoleSystemView {
  return value === 'public-assets' || value === 'trash' ? value : 'files'
}
