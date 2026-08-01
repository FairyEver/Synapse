import { createFileRoute } from '@tanstack/react-router'
import { DriveConsoleItemPage } from '@/features/drive-console/drive-console-page'
import { navigateDriveBrowserUrl } from '@/features/drive-browser/shared/drive-navigation'

export const Route = createFileRoute('/_authenticated/drive/folders/$folderId')({
  validateSearch: validateDriveBrowserSearch,
  component: RouteComponent,
})

function RouteComponent() {
  const { folderId } = Route.useParams()
  const { surface } = Route.useSearch()
  return <DriveConsoleItemPage itemId={folderId} surface={surface} onNavigate={navigateDriveBrowserUrl} />
}

function validateDriveBrowserSearch(search: Record<string, unknown>) {
  return {
    surface: search.surface === 'standalone' ? 'standalone' as const : 'console' as const,
  }
}
