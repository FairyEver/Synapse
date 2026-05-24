import { NavLink, useLocation } from 'react-router';

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import type { RouteItem } from '@/routes';

export function NavProjects({
  projects,
  ...props
}: {
  projects: RouteItem[];
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const location = useLocation();

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden" {...props}>
      <SidebarGroupLabel>运维</SidebarGroupLabel>
      <SidebarMenu>
        {projects.map((item) => (
          <SidebarMenuItem key={item.path}>
            <SidebarMenuButton
              asChild
              isActive={location.pathname === item.path}
            >
              <NavLink to={item.path}>
                <item.icon />
                <span>{item.title}</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
