import { createFileRoute } from '@tanstack/react-router'
import StateSyncPage from '@/features/state-sync'

export const Route = createFileRoute('/_authenticated/state-sync/')({
  component: StateSyncPage,
})
