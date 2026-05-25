import { Outlet, useLocation } from 'react-router';

import { AppSidebar } from '@/components/app-sidebar';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/use-auth';
import { adminRouteItems, getUserRouteItems } from '@/routes';

export function DashboardLayout() {
  const location = useLocation();
  const { session } = useAuth();
  const routes =
    session?.role === 'user'
      ? getUserRouteItems(session.modulePermissions)
      : adminRouteItems;
  const activeRoute = routes.find((item) => item.path === location.pathname);

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-14 min-w-0 shrink-0 items-center">
            <div className="flex h-10 min-w-0 items-center gap-3 px-4">
              <SidebarTrigger className="shrink-0" />
              <Separator
                orientation="vertical"
                className="data-[orientation=vertical]:h-5 data-[orientation=vertical]:self-center"
              />
              <Breadcrumb>
                <BreadcrumbList className="h-10 items-center">
                  <BreadcrumbItem>
                    <BreadcrumbPage className="text-base font-medium leading-none">
                      {activeRoute?.title ?? '系统'}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
          </header>
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
