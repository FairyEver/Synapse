import { resolveWebEntrypoint } from '@/lib/web-entrypoints';
import '@/styles/globals.css';
import '@/lib/browser-compat';
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/auth-store';
import { dashboardApi, subscribeAuthExpired } from '@/lib/api';
import { buildDashboardSignInUrl } from '@/lib/dashboard-redirect';
import { routeTree } from './routeTree.gen';
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
});
function resolveRouterBasepath(pathname: string) {
    return pathname === '/console' || pathname.startsWith('/console/') ? '/console' : '/';
}
export const dashboardRouter = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    basepath: resolveRouterBasepath(window.location.pathname),
});
subscribeAuthExpired(() => {
  useAuthStore.getState().auth.reset();
  window.location.assign(buildDashboardSignInUrl(window.location));
});

async function bootstrap() {
    const entrypoint = resolveWebEntrypoint(window.location.href);
    if (entrypoint.kind === 'redirect') {
      window.location.replace(entrypoint.location);
      return;
    }
    try {
        const session = await dashboardApi.getSession();
        useAuthStore.getState().auth.setUser(session);
    }
    catch {
        // not logged in
    }
    ReactDOM.createRoot(document.getElementById('root')!).render(<StrictMode>
      <QueryClientProvider client={queryClient}>


            <RouterProvider router={dashboardRouter}/>


      </QueryClientProvider>
    </StrictMode>);
}
bootstrap();
