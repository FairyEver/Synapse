import { Outlet, useLocation } from '@tanstack/react-router'
import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { SkipToMain } from '@/components/skip-to-main'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  const href = useLocation({ select: (location) => location.href })
  const shellless = isStandaloneDriveReaderHref(href)
  const content = children ?? <Outlet />

  return (
    <SearchProvider>
      <LayoutProvider>
        {shellless ? (
          content
        ) : (
          <SidebarProvider defaultOpen={defaultOpen}>
            <SkipToMain />
            <AppSidebar />
            <SidebarInset
              className={cn(
                // Set content container, so we can use container queries
                '@container/content',

                // If layout is fixed, set the height
                // to 100svh to prevent overflow
                'has-data-[layout=fixed]:h-svh',

                // If layout is fixed and sidebar is inset,
                // set the height to 100svh - spacing (total margins) to prevent overflow
                'peer-data-[variant=inset]:has-data-[layout=fixed]:h-[calc(100svh-(var(--spacing)*4))]'
              )}
            >
              {content}
            </SidebarInset>
          </SidebarProvider>
        )}
      </LayoutProvider>
    </SearchProvider>
  )
}

function isStandaloneDriveReaderHref(href: string): boolean {
  const url = new URL(href, 'http://synapse.local')
  return url.pathname.startsWith('/drive/items/') && url.searchParams.get('surface') === 'standalone'
}
