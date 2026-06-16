import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { cn } from '@/lib/utils'

export function DriveFinderBreadcrumbs({ snapshot }: { readonly snapshot: DriveBrowserSnapshotDto }) {
  return (
    <nav className='flex min-w-0 flex-wrap items-center gap-1 text-sm' aria-label='当前位置'>
      {snapshot.breadcrumbs.map((item, index) => (
        <span key={item.id} className='flex min-w-0 items-center gap-1'>
          {index > 0 ? <span className='text-muted-foreground'>/</span> : null}
          <a
            href={item.browserUrl}
            className={cn(
              'min-w-0 truncate rounded-sm px-1 py-0.5 hover:bg-accent',
              index === snapshot.breadcrumbs.length - 1 ? 'font-medium' : 'text-muted-foreground'
            )}
          >
            {item.name}
          </a>
        </span>
      ))}
    </nav>
  )
}
