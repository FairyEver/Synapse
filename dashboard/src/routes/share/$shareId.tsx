import { createFileRoute } from '@tanstack/react-router'
import { useCallback } from 'react'
import { DriveBrowserPage } from '@/features/drive-browser/drive-browser-page'

export const Route = createFileRoute('/share/$shareId')({
  validateSearch: parseSharePasswordSearch,
  component: RouteComponent,
})

function RouteComponent() {
  const { shareId } = Route.useParams()
  const { password } = Route.useSearch()
  const navigate = Route.useNavigate()
  const handleDriveNavigate = useCallback((href: string) => {
    void navigate({ href })
  }, [navigate])
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
      initialPassword={password}
      onInitialPasswordConsumed={clearPasswordSearch}
      onNavigate={handleDriveNavigate}
    />
  )
}

function parseSharePasswordSearch(search: Record<string, unknown>): { password?: string } {
  return typeof search.password === 'string' && search.password.length > 0
    ? { password: search.password }
    : {}
}
