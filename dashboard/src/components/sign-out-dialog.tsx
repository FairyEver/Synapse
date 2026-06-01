import { useNavigate, useLocation } from '@tanstack/react-router'
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
