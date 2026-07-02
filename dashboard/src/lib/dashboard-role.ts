export type DashboardRole = 'admin' | 'user'

const adminPaths = new Set([
  '/admin-drive',
  '/audit-logs',
  '/backup',
  '/devices',
  '/invitations',
  '/logs',
  '/system',
  '/teams',
  '/users',
])

export function getDashboardHomePath(role: DashboardRole | null | undefined) {
  return role === 'user' ? '/settings' : '/system'
}

export function isDashboardAdminPath(path: string) {
  const pathname = path.split(/[?#]/, 1)[0] || '/'
  return adminPaths.has(pathname)
}

export function resolveDashboardRedirectForRole(
  role: DashboardRole,
  redirectTo: string | undefined
) {
  if (!redirectTo || redirectTo === '/') return getDashboardHomePath(role)
  if (role === 'user' && isDashboardAdminPath(redirectTo)) return '/settings'
  return redirectTo
}
