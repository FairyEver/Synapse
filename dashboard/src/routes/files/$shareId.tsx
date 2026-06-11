import { createFileRoute } from '@tanstack/react-router'
import { DriveBrowserPage } from '@/features/drive-browser/drive-browser-page'

export const Route = createFileRoute('/files/$shareId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { shareId } = Route.useParams()
  return <DriveBrowserPage context='share' shareId={shareId} />
}
