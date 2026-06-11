import { createFileRoute } from '@tanstack/react-router'
import { DriveBrowserPage } from '@/features/drive-browser/drive-browser-page'

export const Route = createFileRoute('/files/$shareId/items/$browserItemId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { shareId, browserItemId } = Route.useParams()
  return <DriveBrowserPage context='share' shareId={shareId} itemId={browserItemId} />
}
