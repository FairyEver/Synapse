import '@/styles/index.css'
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { ThemeProvider } from '@/context/theme-provider'
import { useAuthStore } from '@/stores/auth-store'
import { dashboardApi, subscribeAuthExpired } from '@/lib/api'
import { routeTree } from './routeTree.gen'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  basepath: '/dashboard',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

subscribeAuthExpired(() => {
  useAuthStore.getState().auth.reset()
  router.navigate({ to: '/sign-in', replace: true })
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
        <ThemeProvider defaultTheme='light' storageKey='dashboard-theme'>
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  )
}

bootstrap()
