import { TerminalIcon } from 'lucide-react';
import type * as React from 'react';
import { Link } from 'react-router';
import { NavMain } from '@/components/nav-main';
import { NavProjects } from '@/components/nav-projects';
import { NavUser } from '@/components/nav-user';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useAuth } from '@/hooks/use-auth';
import { adminRouteItems, userRouteItems } from '@/routes';

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { session } = useAuth();
  const routes = session?.role === 'user' ? userRouteItems : adminRouteItems;
  const mainRoutes = routes.slice(0, 5);
  const operationRoutes = routes.slice(5);
  const homePath = session?.role === 'user' ? '/me' : '/system';

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to={homePath}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <TerminalIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Synapse</span>
                  <span className="truncate text-xs">Dashboard</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={mainRoutes} />
        <NavProjects projects={operationRoutes} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          user={{
            name: session?.role === 'admin' ? '管理员' : '用户',
            email: session?.email ?? '',
          }}
        />
      </SidebarFooter>
    </Sidebar>
  );
}
