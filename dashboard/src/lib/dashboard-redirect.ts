const dashboardRedirectOrigin = 'https://synapse.local'
import { isGameRedirect } from '@/game-center/runtime/routes'
import { resolveWebEntrypoint } from './web-entrypoints'
const dashboardBasePath = '/console'
const legacyDashboardBasePath = '/dashboard'
const rootPublicRedirectPathPrefixes = ['/share/', '/drive/items/']

type DashboardRedirectLocation = Pick<Location, 'pathname' | 'search' | 'hash'>

export function buildDashboardRedirectPath(location: DashboardRedirectLocation) {
  return `${location.pathname}${sanitizePublicRedirectSearch(location)}${location.hash}`
}

export function buildDashboardSignInUrl(location: DashboardRedirectLocation | undefined) {
  if (!location) return `${dashboardBasePath}/sign-in`
  const redirect = buildDashboardRedirectPath(location)
  return `${dashboardBasePath}/sign-in?redirect=${encodeURIComponent(redirect)}`
}

function stripDashboardBasePath(pathname: string) {
  if (pathname === dashboardBasePath) return '/'
  if (pathname.startsWith(`${dashboardBasePath}/`)) {
    return pathname.slice(dashboardBasePath.length)
  }
  if (pathname === legacyDashboardBasePath) return '/'
  if (pathname.startsWith(`${legacyDashboardBasePath}/`)) {
    return pathname.slice(legacyDashboardBasePath.length)
  }
  return pathname
}

function sanitizePublicRedirectSearch(location: DashboardRedirectLocation) {
  const publicPathname = stripDashboardBasePath(location.pathname)
  if (!rootPublicRedirectPathPrefixes.some((prefix) => publicPathname.startsWith(prefix))) {
    return location.search
  }
  const params = new URLSearchParams(location.search)
  params.delete('password')
  const search = params.toString()
  return search ? `?${search}` : ''
}

export function normalizeDashboardRedirect(value: string | undefined) {
  if (!value) return undefined
  try {
    const url = new URL(value, dashboardRedirectOrigin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    const entrypoint = resolveWebEntrypoint(url.pathname.startsWith('/drive/folders/')
      ? `${dashboardBasePath}${url.pathname}${url.search}${url.hash}`
      : url.href)
    if (entrypoint.kind === 'redirect' && entrypoint.location.startsWith('/drive/items/')) {
      return entrypoint.location
    }
    const pathname = stripDashboardBasePath(url.pathname)
    if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname === '/sign-in') {
      return undefined
    }
    return `${pathname}${url.search}${url.hash}`
  } catch {
    return undefined
  }
}

export function isRootPublicDashboardRedirect(value: string | undefined) {
  const normalized = normalizeDashboardRedirect(value)
  if (!normalized) return false
  const pathname = normalized.split(/[?#]/, 1)[0] || '/'
  return rootPublicRedirectPathPrefixes.some((prefix) => pathname.startsWith(prefix))
}

export function isRootGameDashboardRedirect(value: string | undefined) {
  return isGameRedirect(value)
}
import { isDriveDiscussionNotificationOpenPath } from '@synapse/shared'

export function isRootNotificationDashboardRedirect(value: string | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return false
  const normalized = normalizeDashboardRedirect(value)
  return Boolean(normalized && isDriveDiscussionNotificationOpenPath(normalized.split(/[?#]/, 1)[0] ?? ''))
}
