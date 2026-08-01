import { LogOut, Shield } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { adminApi } from '@/lib/api'
import { useAdminAuthStore } from '@/stores/admin-auth-store'
import { useLayout } from '@/context/layout-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { AppTitle } from './app-title'
import { adminSidebarData } from './data/admin-sidebar-data'
import { NavGroup } from './nav-group'

export function AdminSidebar() {
  const { collapsible, variant } = useLayout()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const navigate = useNavigate()
  const reset = useAdminAuthStore((state) => state.auth.reset)

  async function logout() {
    try {
      await adminApi.logout()
    } finally {
      reset()
      await navigate({ to: '/access', replace: true })
    }
  }

  return (
    <>
      <Sidebar collapsible={collapsible} variant={variant}>
        <SidebarHeader><AppTitle {...adminSidebarData.appTitle} /></SidebarHeader>
        <SidebarContent>
          {adminSidebarData.navGroups.map((group) => <NavGroup key={group.title} {...group} />)}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size='lg' onClick={() => setConfirmOpen(true)}>
                <Shield />
                <span className='flex-1 text-start font-medium'>平台管理员</span>
                <LogOut />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title='退出管理界面'
        desc='确认退出当前管理会话？'
        confirmText='退出管理界面'
        destructive
        handleConfirm={logout}
        className='sm:max-w-sm'
      />
    </>
  )
}
