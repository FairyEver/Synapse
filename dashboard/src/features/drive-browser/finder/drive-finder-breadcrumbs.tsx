import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { cn } from '@/lib/utils'
import {
  navigateDriveBrowserUrl,
  shouldHandleDriveBrowserLinkClick,
  type DriveBrowserNavigate,
} from '../shared/drive-navigation'

const driveConsoleHomeBreadcrumb = {
  id: '__drive_console_home__',
  name: '我的空间',
  browserUrl: '/console/drive',
}

export function getDriveFinderBreadcrumbs(snapshot: DriveBrowserSnapshotDto) {
  if (snapshot.context !== 'owner' || snapshot.surface !== 'console') return snapshot.breadcrumbs
  const [firstBreadcrumb, ...remainingBreadcrumbs] = snapshot.breadcrumbs
  if (firstBreadcrumb?.browserUrl === driveConsoleHomeBreadcrumb.browserUrl) {
    return [{ ...firstBreadcrumb, name: driveConsoleHomeBreadcrumb.name }, ...remainingBreadcrumbs]
  }
  return [driveConsoleHomeBreadcrumb, ...snapshot.breadcrumbs]
}

export function DriveFinderBreadcrumbs({
  snapshot,
  onNavigate = navigateDriveBrowserUrl,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly onNavigate?: DriveBrowserNavigate
}) {
  const breadcrumbs = getDriveFinderBreadcrumbs(snapshot)
  return (
    <nav className='flex min-w-0 flex-wrap items-center gap-1 text-sm' aria-label='当前位置'>
      {breadcrumbs.map((item, index) => (
        <span key={item.id} className='flex min-w-0 items-center gap-1'>
          {index > 0 ? <span className='text-muted-foreground'>/</span> : null}
          <a
            href={item.browserUrl}
            className={cn(
              'min-w-0 truncate rounded-sm px-1 py-0.5 hover:bg-accent',
              index === breadcrumbs.length - 1 ? 'font-medium' : 'text-muted-foreground'
            )}
            onClick={(event) => {
              if (!shouldHandleDriveBrowserLinkClick(event)) return
              event.preventDefault()
              onNavigate(item.browserUrl)
            }}
          >
            {item.name}
          </a>
        </span>
      ))}
    </nav>
  )
}
