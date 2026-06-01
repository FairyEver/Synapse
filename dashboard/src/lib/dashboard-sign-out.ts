import { normalizeDashboardRedirect } from './dashboard-redirect'

type NavigateToSignIn = (options: {
  to: '/sign-in'
  search: { redirect: string }
  replace: true
}) => void | Promise<unknown>

export async function performDashboardSignOut(options: {
  currentPath: string
  logout: () => Promise<unknown>
  reset: () => void
  navigate: NavigateToSignIn
  onLogoutFailure?: () => void
}) {
  let logoutFailed = false
  try {
    await options.logout()
  } catch {
    logoutFailed = true
  }
  if (logoutFailed) {
    options.onLogoutFailure?.()
  }
  options.reset()
  await options.navigate({
    to: '/sign-in',
    search: { redirect: normalizeDashboardRedirect(options.currentPath) ?? '/' },
    replace: true,
  })
}
