import { createFileRoute } from '@tanstack/react-router'
import MePage from '@/features/me'

export const Route = createFileRoute('/_authenticated/me/')({
  component: MePage,
})
