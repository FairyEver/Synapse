import { createFileRoute } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { requireDashboardSession } from '@/lib/require-dashboard-session'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: () => requireDashboardSession(window.location),
  component: AuthenticatedLayout,
})
