import { NavLink, useLocation } from 'react-router';

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import type { RouteItem } from '@/routes';

export function NavMain({ items }: { items: RouteItem[] }) {
  const location = useLocation();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>管理</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <SidebarMenuItem key={item.path}>
              <SidebarMenuButton
                asChild
                isActive={location.pathname === item.path}
                tooltip={item.title}
              >
                <NavLink to={item.path}>
                  <Icon />
                  <span>{item.title}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
