const adminRoutePatterns = [
  /^\/system\/?$/u,
  /^\/telemetry\/?$/u,
  /^\/users\/?$/u,
  /^\/devices\/?$/u,
  /^\/skill-repositories\/?$/u,
  /^\/webhook-deliveries\/?$/u,
  /^\/audit-logs\/?$/u,
  /^\/problem-feedback\/?$/u,
  /^\/backup\/?$/u,
  /^\/drive\/?$/u,
  /^\/logs\/?$/u,
]

export function normalizeAdminRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return undefined
  const url = new URL(value, 'http://synapse.local')
  if (url.origin !== 'http://synapse.local') return undefined
  const pathname = url.pathname.startsWith('/admin/') ? url.pathname.slice('/admin'.length) : url.pathname
  return adminRoutePatterns.some((pattern) => pattern.test(pathname))
    ? `${pathname}${url.search}${url.hash}`
    : undefined
}
