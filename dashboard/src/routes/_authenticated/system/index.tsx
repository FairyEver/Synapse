import { createFileRoute } from '@tanstack/react-router'
import SystemPage from '@/features/system'

export const Route = createFileRoute('/_authenticated/system/')({
  component: SystemPage,
})
