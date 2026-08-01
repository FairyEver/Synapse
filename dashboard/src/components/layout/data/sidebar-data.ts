import {
  HardDrive,
  History,
  Settings,
  Store,
  Webhook,
  MonitorSmartphone,
  FolderKanban,
} from 'lucide-react'
import { Logo } from '@/assets/logo'
import type { AuthUser } from '@/stores/auth-store'
import { type SidebarData } from '../types'

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

export function getSidebarData(user: Pick<AuthUser, 'handle' | 'email'> | null): SidebarData {
  const handle = user?.handle?.trim()
  const fallbackName = user?.email || 'User'

  return {
    user: {
      name: handle || fallbackName,
      email: user?.email ?? '',
      avatar: '',
      profileUrl: undefined,
    },
    appTitle: {
      name: 'Synapse',
      logo: Logo,
      description: '个人空间',
    },
    navGroups: [userAccountNavGroup],
  }
}

export const sidebarData: SidebarData = getSidebarData(null)
