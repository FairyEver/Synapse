import '@/styles/index.css'
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { DirectionProvider } from '@/context/direction-provider'
import { FontProvider } from '@/context/font-provider'
import { ThemeProvider } from '@/context/theme-provider'
import { useAuthStore } from '@/stores/auth-store'
import { dashboardApi, subscribeAuthExpired } from '@/lib/api'
import { normalizeDashboardRedirect } from '@/lib/dashboard-redirect'
import { routeTree } from './routeTree.gen'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function resolveRouterBasepath(pathname: string) {
  return pathname === '/console' || pathname.startsWith('/console/') ? '/console' : '/'
}

export const dashboardRouter = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  basepath: resolveRouterBasepath(window.location.pathname),
})

subscribeAuthExpired(() => {
  const redirect = normalizeDashboardRedirect(dashboardRouter.state.location.href)
  useAuthStore.getState().auth.reset()
  dashboardRouter.navigate({
    to: '/sign-in',
    search: redirect ? { redirect } : {},
    replace: true,
  })
})

async function bootstrap() {
  try {
    const session = await dashboardApi.getSession()
    useAuthStore.getState().auth.setUser(session)
  } catch {
    // not logged in
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <FontProvider>
            <DirectionProvider>
              <RouterProvider router={dashboardRouter} />
            </DirectionProvider>
          </FontProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  )
}

bootstrap()
