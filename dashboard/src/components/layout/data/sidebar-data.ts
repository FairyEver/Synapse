import {
  LayoutDashboard,
  Users,
  Shield,
  Mail,
  FileText,
  HardDrive,
  ScrollText,
  UserCircle,
  Settings,
  Command,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Admin',
    email: 'admin@synapse.dev',
    avatar: '',
  },
  teams: [
    {
      name: 'Synapse Admin',
      logo: Command,
      plan: '管理后台',
    },
  ],
  navGroups: [
    {
      title: '管理',
      items: [
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
          title: '备份',
          url: '/backup',
          icon: HardDrive,
        },
        {
          title: '系统日志',
          url: '/logs',
          icon: ScrollText,
        },
      ],
    },
    {
      title: '账户',
      items: [
        {
          title: '个人中心',
          url: '/me',
          icon: UserCircle,
        },
        {
          title: '设置',
          url: '/settings',
          icon: Settings,
        },
      ],
    },
  ],
}
