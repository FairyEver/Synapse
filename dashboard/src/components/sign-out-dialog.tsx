import { useNavigate, useLocation } from '@tanstack/react-router'
import { toast } from 'sonner'
import { dashboardApi } from '@/lib/api'
import { performDashboardSignOut } from '@/lib/dashboard-sign-out'
import { useAuthStore } from '@/stores/auth-store'
import { ConfirmDialog } from '@/components/confirm-dialog'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { auth } = useAuthStore()

  const handleSignOut = async () => {
    await performDashboardSignOut({
      currentPath: location.href,
      logout: dashboardApi.logout,
      reset: auth.reset,
      navigate,
      onLogoutFailure: () => toast.error('退出登录失败，服务端会话可能未清除。'),
    })
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title='退出登录'
      desc='确认退出当前账号？'
      confirmText='退出登录'
      destructive
      handleConfirm={handleSignOut}
      className='sm:max-w-sm'
    />
  )
}
