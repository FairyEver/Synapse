import { createFileRoute } from '@tanstack/react-router'
import InvitationsPage from '@/features/invitations'

export const Route = createFileRoute('/_authenticated/invitations/')({
  component: InvitationsPage,
})
