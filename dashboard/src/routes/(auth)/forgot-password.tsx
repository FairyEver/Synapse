import { z } from 'zod'
import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  buildAuthRedirectSearch,
  normalizeAuthRedirect,
} from '@/features/auth/auth-redirect-search'

const searchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/forgot-password')({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/sign-in',
      search: buildAuthRedirectSearch(normalizeAuthRedirect(search.redirect)),
    })
  },
})
