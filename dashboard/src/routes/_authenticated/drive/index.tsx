import { createFileRoute } from '@tanstack/react-router'
import { useCallback } from 'react'
import { DriveConsolePage } from '@/features/drive-console/drive-console-page'

export const Route = createFileRoute('/_authenticated/drive/')({
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = Route.useNavigate()
  const handleDriveNavigate = useCallback((href: string) => {
    void navigate({ href })
  }, [navigate])

  return <DriveConsolePage onNavigate={handleDriveNavigate} />
}
