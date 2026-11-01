import { Link } from '@heroui/react'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { LogIn, UserRound } from 'lucide-react'
import { buildDashboardSignInUrl } from '@/lib/dashboard-redirect'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
type DriveShareViewerStatusProps = {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly className?: string
}
export function DriveShareViewerStatus({
  snapshot,
  className,
}: DriveShareViewerStatusProps) {
  const user = useAuthStore((state) => state.auth.user)
  if (snapshot.context !== 'share') return null
  if (!user) {
    return (
      <Link className={cn('gap-1', className)} href={buildShareSignInUrl(snapshot)}>
        <Link.Icon><LogIn className='size-full' /></Link.Icon>
        登录
      </Link>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-48 items-center gap-1.5 truncate text-xs text-muted',
        className
      )}
    >
      <UserRound className='size-3.5 shrink-0' />
      <span className='min-w-0 truncate'>{user.handle || user.email}</span>
    </span>
  )
}
function buildShareSignInUrl(snapshot: DriveBrowserSnapshotDto) {
  if (typeof window !== 'undefined')
    return buildDashboardSignInUrl(window.location)
  const fallbackUrl = new URL(
    snapshot.current.browserUrl,
    'https://synapse.local'
  )
  return buildDashboardSignInUrl({
    pathname: fallbackUrl.pathname,
    search: fallbackUrl.search,
    hash: fallbackUrl.hash,
  })
}
