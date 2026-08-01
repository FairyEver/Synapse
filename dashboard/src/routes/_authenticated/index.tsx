import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/')({
  component: AuthenticatedIndexRoute,
})

function AuthenticatedIndexRoute() {
  return <Navigate to='/settings' replace />
}
