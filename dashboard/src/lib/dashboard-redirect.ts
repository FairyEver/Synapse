const dashboardRedirectOrigin = 'https://synapse.local'
const dashboardBasePath = '/console'
const legacyDashboardBasePath = '/dashboard'
const rootPublicRedirectPathPrefixes = ['/share/']

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
    if (url.origin !== dashboardRedirectOrigin) return undefined
    const pathname = stripDashboardBasePath(url.pathname)
    if (!pathname.startsWith('/') || pathname === '/sign-in') {
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
