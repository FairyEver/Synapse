import { Activity, Archive, ChartNoAxesCombined, FileText, FolderKanban, History, KeyRound, LayoutDashboard, Mail, MessageSquareWarning, MonitorSmartphone, ScrollText, Settings, Store, Users, UsersRound, Webhook, type LucideIcon } from 'lucide-react'
export type NavigationItem = { title: string; path: string; icon: LucideIcon; external?: boolean }
export const userNavigation: NavigationItem[] = [
  { title: '云端数据表', path: '/tables', icon: ScrollText },
  { title: '我的 Skills', path: '/skill-repositories', icon: FolderKanban },
  { title: '探索 Skills', path: '/skill-repositories/explore', icon: Store },
  { title: 'Webhooks', path: '/webhooks', icon: Webhook },
  { title: 'Webhook 历史', path: '/webhook-deliveries', icon: History },
  { title: '我的设备', path: '/my-devices', icon: MonitorSmartphone },
  { title: '设置', path: '/settings', icon: Settings },
]
export const adminNavigation: NavigationItem[] = [
  { title: '系统概览', path: '/system', icon: LayoutDashboard },
  { title: '埋点统计', path: '/telemetry', icon: ChartNoAxesCombined },
  { title: '用户管理', path: '/users', icon: Users },
  { title: '站内信', path: '/mail-internal', icon: Mail },
  { title: '团队', path: '/teams', icon: UsersRound },
  { title: '设备', path: '/devices', icon: MonitorSmartphone },
  { title: 'Skill 仓库', path: '/skill-repositories', icon: FolderKanban },
  { title: 'Webhook 历史', path: '/webhook-deliveries', icon: History },
  { title: '审计日志', path: '/audit-logs', icon: FileText },
  { title: '问题反馈', path: '/problem-feedback', icon: MessageSquareWarning },
  { title: '备份', path: '/backup', icon: Archive },
  { title: '系统日志', path: '/logs', icon: ScrollText },
]
export const settingsNavigation = [
  { title: '个人资料', path: '/settings', icon: Activity },
  { title: 'API 密钥', path: '/settings/api-keys', icon: KeyRound },
]

/** A detail route belongs to its closest navigation entry. */
export function getActiveNavigationPath(items: NavigationItem[], pathname: string): string | undefined {
  return items
    .filter((item) => !item.external && (pathname === item.path || pathname.startsWith(`${item.path}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0]?.path
}
