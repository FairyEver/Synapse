import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { DesktopAuth } from '@/features/auth/desktop-auth'

const searchSchema = z.object({
  client_id: z.string().optional(),
  redirect_uri: z.string().optional(),
  response_type: z.string().optional(),
  state: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/auth/desktop')({
  component: DesktopAuthRoute,
  validateSearch: searchSchema,
})

function DesktopAuthRoute() {
  const search = Route.useSearch()
  return <DesktopAuth search={search} />
}
