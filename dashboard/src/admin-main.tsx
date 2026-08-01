import '@/styles/index.css'
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { adminRouteTree } from './admin-routes'
import { adminApi, subscribeAdminAuthExpired } from '@/lib/api'
import { normalizeAdminRedirect } from '@/lib/admin-redirect'
import { useAdminAuthStore } from '@/stores/admin-auth-store'
import { DirectionProvider } from '@/context/direction-provider'
import { FontProvider } from '@/context/font-provider'
import { ThemeProvider } from '@/context/theme-provider'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

export const adminRouter = createRouter({
  routeTree: adminRouteTree,
  context: { queryClient },
  defaultPreload: 'intent',
  basepath: '/admin',
})

subscribeAdminAuthExpired(() => {
  const redirect = normalizeAdminRedirect(adminRouter.state.location.href)
  useAdminAuthStore.getState().auth.reset()
  void adminRouter.navigate({ to: '/access', search: redirect ? { redirect } : {}, replace: true })
})

async function bootstrap() {
  try {
    useAdminAuthStore.getState().auth.setSession(await adminApi.getSession())
  } catch {
    // The access route handles an absent or expired session.
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider><FontProvider><DirectionProvider><RouterProvider router={adminRouter} /></DirectionProvider></FontProvider></ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  )
}

void bootstrap()
