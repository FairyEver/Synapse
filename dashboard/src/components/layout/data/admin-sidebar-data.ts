import {
  DatabaseBackup,
  FileText,
  FolderKanban,
  HardDrive,
  History,
  LayoutDashboard,
  MessageSquareWarning,
  MonitorSmartphone,
  ScrollText,
  Users,
} from 'lucide-react'
import { Logo } from '@/assets/logo'
import type { SidebarData } from '../types'

export const adminSidebarData: SidebarData = {
  user: { name: '平台管理员', email: '', avatar: '', profileUrl: undefined },
  appTitle: { name: 'Synapse', logo: Logo, description: '系统管理' },
  navGroups: [{
    title: '管理',
    items: [
      { title: '系统概览', url: '/system', icon: LayoutDashboard },
      { title: '用户管理', url: '/users', icon: Users },
      { title: '设备', url: '/devices', icon: MonitorSmartphone },
      { title: 'Skill 仓库', url: '/skill-repositories', icon: FolderKanban },
      { title: 'Webhook 历史', url: '/webhook-deliveries', icon: History },
      { title: '审计日志', url: '/audit-logs', icon: FileText },
      { title: '问题反馈', url: '/problem-feedback', icon: MessageSquareWarning },
      { title: '备份', url: '/backup', icon: DatabaseBackup },
      { title: '云盘管理', url: '/drive', icon: HardDrive },
      { title: '系统日志', url: '/logs', icon: ScrollText },
    ],
  }],
}
