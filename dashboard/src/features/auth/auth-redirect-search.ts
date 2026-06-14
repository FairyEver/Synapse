import { normalizeDashboardRedirect } from '@/lib/dashboard-redirect'

export type AuthRedirectSearch = {
  redirect?: string
}

export function normalizeAuthRedirect(value: string | undefined) {
  return normalizeDashboardRedirect(value)
}

export function buildAuthRedirectSearch(redirectTo: string | undefined): AuthRedirectSearch {
  return redirectTo ? { redirect: redirectTo } : {}
}
