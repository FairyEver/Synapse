import { createFileRoute } from '@tanstack/react-router'
import { DriveChangeHistoryPage } from '@/features/drive-browser/change-history/drive-change-history-page'

export const Route = createFileRoute(
  '/_authenticated/drive/items/$browserItemId_/changes'
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { browserItemId } = Route.useParams()
  return <DriveChangeHistoryPage key={browserItemId} itemId={browserItemId} />
}
