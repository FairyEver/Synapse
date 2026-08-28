import { createFileRoute } from '@tanstack/react-router'
import { useCallback } from 'react'
import { DriveConsolePage } from '@/features/drive-console/drive-console-page'
import type { DriveConsoleSystemView } from '@/features/drive-console/drive-file-table'

export const Route = createFileRoute('/_authenticated/drive/')({
  validateSearch: validateDriveConsoleSearch,
  component: RouteComponent,
})

function RouteComponent() {
  const { view } = Route.useSearch()
  const navigate = Route.useNavigate()
  const handleDriveNavigate = useCallback((href: string) => {
    void navigate({ href })
  }, [navigate])
  const handleViewChange = useCallback((nextView: DriveConsoleSystemView) => {
    void navigate({ search: { view: nextView } })
  }, [navigate])

  return <DriveConsolePage onNavigate={handleDriveNavigate} activeView={view} onViewChange={handleViewChange} />
}

function validateDriveConsoleSearch(search: Record<string, unknown>) {
  return {
    view: parseDriveConsoleSystemView(search.view),
  }
}

function parseDriveConsoleSystemView(value: unknown): DriveConsoleSystemView {
  return value === 'public-assets' || value === 'trash' ? value : 'files'
}
