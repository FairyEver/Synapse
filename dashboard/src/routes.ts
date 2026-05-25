import {
  ArchiveIcon,
  FileSearchIcon,
  FileTextIcon,
  GaugeIcon,
  ShieldIcon,
  UsersIcon,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

export type RouteItem = {
  title: string;
  path: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export const adminRouteItems: RouteItem[] = [
  {
    title: '系统',
    path: '/system',
    icon: GaugeIcon,
  },
  {
    title: '用户',
    path: '/users',
    icon: UsersIcon,
  },
  {
    title: '团队',
    path: '/teams',
    icon: ShieldIcon,
  },
  {
    title: '审计日志',
    path: '/audit-logs',
    icon: FileSearchIcon,
  },
  {
    title: '备份',
    path: '/backup',
    icon: ArchiveIcon,
  },
  {
    title: '系统日志',
    path: '/logs',
    icon: FileTextIcon,
  },
];

export const userRouteItems: RouteItem[] = [
  {
    title: '账号',
    path: '/me',
    icon: UsersIcon,
  },
  {
    title: '设置',
    path: '/settings',
    icon: GaugeIcon,
  },
];

export const routeItems = adminRouteItems;
