import {
  LayoutDashboard,
  Users,
  Shield,
  Mail,
  FileText,
  HardDrive,
  History,
  ScrollText,
  Settings,
  Store,
  Webhook,
  MonitorSmartphone,
  FolderKanban,
} from 'lucide-react'
import { Logo } from '@/assets/logo'
import type { AuthUser } from '@/stores/auth-store'
import { type SidebarData } from '../types'

const adminNavGroup = {
  title: '管理',
  items: [
    {
      title: 'Skill 仓库',
      url: '/skill-repositories/admin',
      icon: FolderKanban,
    },
    {
      title: 'Legacy Content Store',
      url: '/content-store-admin',
      icon: Store,
    },
    {
      title: '系统概览',
      url: '/system',
      icon: LayoutDashboard,
    },
    {
      title: '用户管理',
      url: '/users',
      icon: Users,
    },
    {
      title: '设备',
      url: '/devices',
      icon: MonitorSmartphone,
    },
    {
      title: '团队管理',
      url: '/teams',
      icon: Shield,
    },
    {
      title: '邀请管理',
      url: '/invitations',
      icon: Mail,
    },
    {
      title: '审计日志',
      url: '/audit-logs',
      icon: FileText,
    },
    {
      title: 'Webhook 历史',
      url: '/webhook-deliveries',
      icon: History,
    },
    {
      title: '备份',
      url: '/backup',
      icon: HardDrive,
    },
    {
      title: '云盘管理',
      url: '/admin-drive',
      icon: HardDrive,
    },
    {
      title: '系统日志',
      url: '/logs',
      icon: ScrollText,
    },
  ],
} satisfies SidebarData['navGroups'][number]

const userAccountNavGroup = {
  title: '账户',
  items: [
    {
      title: '我的 Skills',
      url: '/skill-repositories',
      icon: FolderKanban,
    },
    {
      title: '探索 Skills',
      url: '/skill-repositories/explore',
      icon: Store,
    },
    {
      title: '网盘',
      url: '/drive',
      icon: HardDrive,
    },
    {
      title: 'Webhooks',
      url: '/webhooks',
      icon: Webhook,
    },
    {
      title: 'Webhook 历史',
      url: '/webhook-deliveries',
      icon: History,
    },
    {
      title: '我的设备',
      url: '/my-devices',
      icon: MonitorSmartphone,
    },
    {
      title: '设置',
      url: '/settings',
      icon: Settings,
    },
  ],
} satisfies SidebarData['navGroups'][number]

const adminAccountNavGroup = {
  title: '账户',
  items: [
    {
      title: '设置',
      url: '/settings',
      icon: Settings,
    },
  ],
} satisfies SidebarData['navGroups'][number]

export function getSidebarData(user: Pick<AuthUser, 'displayName' | 'email' | 'role'> | null): SidebarData {
  const isAdmin = user?.role !== 'user'
  const displayName = user?.displayName?.trim()
  const fallbackName = user?.email || (isAdmin ? 'Admin' : 'User')

  return {
    user: {
      name: displayName || fallbackName,
      email: user?.email ?? '',
      avatar: '',
      profileUrl: undefined,
    },
    appTitle: {
      name: 'Synapse',
      logo: Logo,
      description: isAdmin ? '系统管理' : '个人空间',
    },
    navGroups: isAdmin ? [adminNavGroup, adminAccountNavGroup] : [userAccountNavGroup],
  }
}

export const sidebarData: SidebarData = getSidebarData(null)
