import { useEffect, useMemo, useState } from 'react'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DriveRendererShell } from '../renderers/drive-renderer-shell'
import type { DriveRendererEditContext } from '../renderers/drive-renderer-shell'
import type { DriveAnnotationContext } from '../use-drive-annotations'
import {
  findDriveRendererOption,
  getDriveRendererOptions,
  type DriveRendererId,
} from '../renderers/drive-renderer-registry'
import { DriveShareViewerStatus } from '../shared/drive-share-viewer-status'
import type { DriveBrowserNavigate } from '../shared/drive-navigation'
import { getDriveFinderActions } from '../shared/drive-view-model'
import { DriveFinderBreadcrumbs } from './drive-finder-breadcrumbs'
import { DriveFinderList } from './drive-finder-list'
import { DriveFinderFileLayout, DriveFinderFullLayout } from './drive-finder-layout'

export function DriveFinder({
  snapshot,
  mode,
  onLoadMoreChildren,
  loadingMoreChildren = false,
  loadMoreChildrenError = null,
  editContext,
  annotationContext,
  onNavigate,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly mode: 'console' | 'share' | 'standalone'
  readonly onLoadMoreChildren?: () => void
  readonly loadingMoreChildren?: boolean
  readonly loadMoreChildrenError?: string | null
  readonly editContext?: DriveRendererEditContext
  readonly annotationContext?: DriveAnnotationContext
  readonly onNavigate?: DriveBrowserNavigate
}) {
  const fileSelected = snapshot.current.type === 'file'
  const rendererOptions = useMemo(() => getDriveRendererOptions(snapshot), [snapshot])
  const [rendererId, setRendererId] = useState<DriveRendererId | null>(rendererOptions[0]?.id ?? null)
  const selectedRenderer = findDriveRendererOption(snapshot, rendererId)

  useEffect(() => {
    setRendererId((current) => findDriveRendererOption(snapshot, current)?.id ?? rendererOptions[0]?.id ?? null)
  }, [rendererOptions, snapshot])

  return (
    <section data-drive-finder-mode={mode} className='flex min-h-0 flex-1 flex-col gap-3'>
      <DriveFinderToolbar snapshot={snapshot} mode={mode} onNavigate={onNavigate} />
      {fileSelected ? (
        <DriveFinderFileLayout>
          <DriveRendererShell
            snapshot={snapshot}
            rendererId={selectedRenderer?.id ?? null}
            onRendererChange={setRendererId}
            editContext={editContext}
            annotationContext={annotationContext}
          />
        </DriveFinderFileLayout>
      ) : (
        <DriveFinderFullLayout>
          <DriveFinderList
            snapshot={snapshot}
            onNavigate={onNavigate}
            onLoadMoreChildren={onLoadMoreChildren}
            loadingMoreChildren={loadingMoreChildren}
            loadMoreChildrenError={loadMoreChildrenError}
          />
        </DriveFinderFullLayout>
      )}
    </section>
  )
}

function DriveFinderToolbar({
  snapshot,
  mode,
  onNavigate,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly mode: 'console' | 'share' | 'standalone'
  readonly onNavigate?: DriveBrowserNavigate
}) {
  const actions = getDriveFinderActions(snapshot)
  return (
    <div className='flex shrink-0 flex-col gap-3 md:flex-row md:items-center md:justify-between'>
      <DriveFinderBreadcrumbs snapshot={snapshot} onNavigate={onNavigate} />
      <div className='flex shrink-0 flex-wrap items-center gap-2'>
        {mode === 'share' ? <DriveShareViewerStatus snapshot={snapshot} /> : null}
        {actions.directoryDownloadUrl ? (
          <Button asChild variant='outline' size='sm'>
            <a data-drive-telemetry-event='web.drive.folder.download' href={actions.directoryDownloadUrl}>
              <Download data-icon='inline-start' />
              下载整个目录
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  )
}
