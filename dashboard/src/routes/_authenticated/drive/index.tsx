import { createFileRoute } from '@tanstack/react-router'
import { useCallback } from 'react'
import { DriveConsolePage } from '@/features/drive-console/drive-console-page'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/drive/')({
  beforeLoad: requireDashboardUser,
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = Route.useNavigate()
  const handleDriveNavigate = useCallback((href: string) => {
    void navigate({ href })
  }, [navigate])

  return <DriveConsolePage onNavigate={handleDriveNavigate} />
}
