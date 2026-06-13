import { createFileRoute } from '@tanstack/react-router'
import { useCallback } from 'react'
import { DriveBrowserPage } from '@/features/drive-browser/drive-browser-page'

export const Route = createFileRoute('/files/$shareId_/items/$browserItemId')({
  validateSearch: parseSharePasswordSearch,
  component: RouteComponent,
})

function RouteComponent() {
  const { shareId, browserItemId } = Route.useParams()
  const { password } = Route.useSearch()
  const navigate = Route.useNavigate()
  const clearPasswordSearch = useCallback(() => {
    void navigate({
      replace: true,
      search: (prev) => ({ ...prev, password: undefined }),
    })
  }, [navigate])

  return (
    <DriveBrowserPage
      context='share'
      shareId={shareId}
      itemId={browserItemId}
      initialPassword={password}
      onInitialPasswordAccepted={clearPasswordSearch}
    />
  )
}

function parseSharePasswordSearch(search: Record<string, unknown>): { password?: string } {
  return typeof search.password === 'string' && search.password.length > 0
    ? { password: search.password }
    : {}
}
