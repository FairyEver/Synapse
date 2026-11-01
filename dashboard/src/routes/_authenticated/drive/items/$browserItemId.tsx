import { createFileRoute } from '@tanstack/react-router'
import { DriveBrowserPage } from '@/features/drive-browser/drive-browser-page'
import { navigateDriveBrowserUrl } from '@/features/drive-browser/shared/drive-navigation'
export const Route = createFileRoute(
  '/_authenticated/drive/items/$browserItemId'
)({
  validateSearch: validateDriveBrowserSearch,
  component: RouteComponent,
})
function RouteComponent() {
  const { browserItemId } = Route.useParams()
  return (
    <DriveBrowserPage
      context='owner'
      itemId={browserItemId}
      surface='standalone'
      onNavigate={navigateDriveBrowserUrl}
    />
  )
}
function validateDriveBrowserSearch(_search: Record<string, unknown>) {
  return {
    surface: 'standalone' as const,
  }
}
