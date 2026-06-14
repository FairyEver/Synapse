import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { ForgotPassword } from '@/features/auth/forgot-password'

const searchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/forgot-password')({
  component: ForgotPassword,
  validateSearch: searchSchema,
})
