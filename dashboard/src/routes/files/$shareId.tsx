import { createFileRoute } from '@tanstack/react-router'
import { DriveBrowserPage } from '@/features/drive-browser/drive-browser-page'

export const Route = createFileRoute('/files/$shareId')({
  validateSearch: parseSharePasswordSearch,
  component: RouteComponent,
})

function RouteComponent() {
  const { shareId } = Route.useParams()
  const { password } = Route.useSearch()
  return <DriveBrowserPage context='share' shareId={shareId} initialPassword={password} />
}

function parseSharePasswordSearch(search: Record<string, unknown>): { password?: string } {
  return typeof search.password === 'string' && search.password.length > 0
    ? { password: search.password }
    : {}
}
