import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { LogIn, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildDashboardSignInUrl } from '@/lib/dashboard-redirect'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

type DriveShareViewerStatusProps = {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly className?: string
}

export function DriveShareViewerStatus({ snapshot, className }: DriveShareViewerStatusProps) {
  const user = useAuthStore((state) => state.auth.user)
  if (snapshot.context !== 'share') return null
  if (!user) {
    return (
      <Button asChild variant='outline' size='sm' className={className}>
        <a href={buildShareSignInUrl(snapshot)}>
          <LogIn data-icon='inline-start' />
          登录
        </a>
      </Button>
    )
  }
  return (
    <span className={cn('inline-flex min-w-0 max-w-48 items-center gap-1.5 truncate text-xs text-muted-foreground', className)}>
      <UserRound className='size-3.5 shrink-0' />
      <span className='min-w-0 truncate'>{user.handle || user.email}</span>
    </span>
  )
}

function buildShareSignInUrl(snapshot: DriveBrowserSnapshotDto) {
  if (typeof window !== 'undefined') return buildDashboardSignInUrl(window.location)
  const fallbackUrl = new URL(snapshot.current.browserUrl, 'https://synapse.local')
  return buildDashboardSignInUrl({
    pathname: fallbackUrl.pathname,
    search: fallbackUrl.search,
    hash: fallbackUrl.hash,
  })
}
