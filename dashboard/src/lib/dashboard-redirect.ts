const dashboardRedirectOrigin = 'https://synapse.local'

export function normalizeDashboardRedirect(value: string | undefined) {
  if (!value) return undefined
  try {
    const url = new URL(value, dashboardRedirectOrigin)
    if (url.origin !== dashboardRedirectOrigin) return undefined
    if (!url.pathname.startsWith('/') || url.pathname === '/sign-in') {
      return undefined
    }
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return undefined
  }
}
