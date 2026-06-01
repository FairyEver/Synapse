import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { TeamInvite } from '@/features/auth/team-invite'

const teamInviteSearchSchema = z.object({
  token: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/team-invite')({
  validateSearch: teamInviteSearchSchema,
  component: TeamInviteRoute,
})

function TeamInviteRoute() {
  const { token } = Route.useSearch()

  return <TeamInvite token={token} />
}
