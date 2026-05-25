import {
  ArchiveIcon,
  BarChart3Icon,
  BotIcon,
  CalendarClockIcon,
  CodeIcon,
  DatabaseIcon,
  FileSearchIcon,
  FileTextIcon,
  GaugeIcon,
  MessageSquareIcon,
  ShieldIcon,
  SquareTerminalIcon,
  WrenchIcon,
  WorkflowIcon,
  UsersIcon,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

export type RouteItem = {
  title: string;
  path: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export type ModuleRouteItem = RouteItem & {
  permissionKey: string;
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
    title: '邀请',
    path: '/invitations',
    icon: MessageSquareIcon,
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

export const moduleRouteItems: ModuleRouteItem[] = [
  {
    title: '技能',
    path: '/modules/skills',
    icon: SquareTerminalIcon,
    permissionKey: 'module.skill',
  },
  {
    title: '规则',
    path: '/modules/rules',
    icon: CodeIcon,
    permissionKey: 'module.rule',
  },
  {
    title: '提示词',
    path: '/modules/prompts',
    icon: FileTextIcon,
    permissionKey: 'module.prompt',
  },
  {
    title: '对话',
    path: '/modules/agent',
    icon: MessageSquareIcon,
    permissionKey: 'module.agent',
  },
  {
    title: '数据',
    path: '/modules/database',
    icon: DatabaseIcon,
    permissionKey: 'module.database',
  },
  {
    title: '定时',
    path: '/modules/scheduler',
    icon: CalendarClockIcon,
    permissionKey: 'module.scheduler',
  },
  {
    title: '工作流',
    path: '/modules/workflow',
    icon: WorkflowIcon,
    permissionKey: 'module.workflow',
  },
  {
    title: '工具',
    path: '/modules/tools',
    icon: WrenchIcon,
    permissionKey: 'module.tools',
  },
  {
    title: '本机',
    path: '/modules/local',
    icon: BotIcon,
    permissionKey: 'module.local',
  },
  {
    title: '使用分析',
    path: '/modules/usage',
    icon: BarChart3Icon,
    permissionKey: 'module.usage',
  },
];

export function getUserRouteItems(permissionKeys: readonly string[] = []) {
  const allowed = new Set(permissionKeys);
  return [
    ...userRouteItems,
    ...moduleRouteItems.filter((item) => allowed.has(item.permissionKey)),
  ];
}

export const routeItems = adminRouteItems;
