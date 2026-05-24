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
import { routeItems } from '@/routes';

const mainRoutes = routeItems.slice(0, 5);
const operationRoutes = routeItems.slice(5);

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { session } = useAuth();

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/system">
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
