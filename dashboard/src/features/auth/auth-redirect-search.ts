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

export function appendAuthRedirectToUrl(url: string, redirectTo: string | undefined) {
  if (!redirectTo) return url
  try {
    const isAbsolute = /^[a-z][a-z\d+.-]*:\/\//i.test(url)
    const nextUrl = new URL(url, 'https://synapse.local')
    nextUrl.searchParams.set('redirect', redirectTo)
    return isAbsolute
      ? nextUrl.toString()
      : `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
  } catch {
    return url
  }
}
