import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getDriveFinderActions } from '../shared/drive-view-model'
import { DriveFinderBreadcrumbs } from './drive-finder-breadcrumbs'
import { DriveFinderList } from './drive-finder-list'
import { DriveFinderFullLayout } from './drive-finder-layout'

export function DriveFinder({
  snapshot,
  mode,
  onLoadMoreChildren,
  loadingMoreChildren = false,
  loadMoreChildrenError = null,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly mode: 'console' | 'share' | 'standalone'
  readonly onLoadMoreChildren?: () => void
  readonly loadingMoreChildren?: boolean
  readonly loadMoreChildrenError?: string | null
}) {
  return (
    <section data-drive-finder-mode={mode} className='flex min-h-0 flex-1 flex-col gap-3'>
      <DriveFinderToolbar snapshot={snapshot} />
      <DriveFinderFullLayout>
        <DriveFinderList
          snapshot={snapshot}
          onLoadMoreChildren={onLoadMoreChildren}
          loadingMoreChildren={loadingMoreChildren}
          loadMoreChildrenError={loadMoreChildrenError}
        />
      </DriveFinderFullLayout>
    </section>
  )
}

function DriveFinderToolbar({ snapshot }: { readonly snapshot: DriveBrowserSnapshotDto }) {
  const actions = getDriveFinderActions(snapshot)
  return (
    <div className='flex shrink-0 flex-col gap-3 md:flex-row md:items-center md:justify-between'>
      <DriveFinderBreadcrumbs snapshot={snapshot} />
      <div className='flex shrink-0 flex-wrap gap-2'>
        {actions.directoryDownloadUrl ? (
          <Button asChild variant='outline' size='sm'>
            <a href={actions.directoryDownloadUrl}>
              <Download data-icon='inline-start' />
              下载整个目录
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  )
}
