const dashboardRedirectOrigin = 'https://synapse.local'
const dashboardBasePath = '/console'
const legacyDashboardBasePath = '/dashboard'

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
