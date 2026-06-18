import { useEffect, useMemo, useState } from 'react'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { Download, ExternalLink, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DriveRendererShell } from '../renderers/drive-renderer-shell'
import type { DriveRendererEditContext } from '../renderers/drive-renderer-shell'
import {
  findDriveRendererOption,
  getDriveRendererOptions,
  type DriveRendererId,
} from '../renderers/drive-renderer-registry'
import { DriveFileVersionsDialog } from '../drive-file-versions-dialog'
import { driveBrowserKindLabel, formatDriveBrowserDate, formatDriveBrowserSize } from '../shared/drive-format'
import { DriveBrowserItemIcon } from '../shared/drive-icons'
import { getDriveFileVersionItemId, getDriveFinderActions } from '../shared/drive-view-model'
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
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly mode: 'console' | 'share' | 'standalone'
  readonly onLoadMoreChildren?: () => void
  readonly loadingMoreChildren?: boolean
  readonly loadMoreChildrenError?: string | null
  readonly editContext?: DriveRendererEditContext
}) {
  const fileSelected = snapshot.current.type === 'file'
  const rendererOptions = useMemo(() => getDriveRendererOptions(snapshot), [snapshot])
  const [rendererId, setRendererId] = useState<DriveRendererId | null>(rendererOptions[0]?.id ?? null)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const selectedRenderer = findDriveRendererOption(snapshot, rendererId)
  const versionItemId = getDriveFileVersionItemId(snapshot)

  useEffect(() => {
    setRendererId((current) => findDriveRendererOption(snapshot, current)?.id ?? rendererOptions[0]?.id ?? null)
  }, [rendererOptions, snapshot])

  return (
    <section data-drive-finder-mode={mode} className='flex min-h-0 flex-1 flex-col gap-3'>
      <DriveFinderToolbar snapshot={snapshot} />
      {fileSelected ? (
        <DriveFinderFileLayout>
          <div className='flex h-full min-h-0 flex-col'>
            <DriveFinderFileHeader
              snapshot={snapshot}
              rendererId={selectedRenderer?.id ?? null}
              onRendererChange={setRendererId}
              onOpenVersions={versionItemId ? () => setVersionsOpen(true) : undefined}
            />
            <div className='min-h-0 flex-1 overflow-hidden'>
              <DriveRendererShell
                snapshot={snapshot}
                rendererId={selectedRenderer?.id ?? null}
                onRendererChange={setRendererId}
                editContext={editContext}
              />
            </div>
          </div>
        </DriveFinderFileLayout>
      ) : (
        <DriveFinderFullLayout>
          <DriveFinderList
            snapshot={snapshot}
            onLoadMoreChildren={onLoadMoreChildren}
            loadingMoreChildren={loadingMoreChildren}
            loadMoreChildrenError={loadMoreChildrenError}
          />
        </DriveFinderFullLayout>
      )}
      {versionsOpen && versionItemId ? (
        <DriveFileVersionsDialog
          itemId={versionItemId}
          open={versionsOpen}
          onOpenChange={setVersionsOpen}
        />
      ) : null}
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

function DriveFinderFileHeader({
  snapshot,
  rendererId,
  onRendererChange,
  onOpenVersions,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly rendererId: DriveRendererId | null
  readonly onRendererChange: (id: DriveRendererId) => void
  readonly onOpenVersions?: () => void
}) {
  const actions = getDriveFinderActions(snapshot)
  const rendererOptions = getDriveRendererOptions(snapshot)
  return (
    <header className='flex shrink-0 flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between'>
      <div className='flex min-w-0 flex-col gap-1'>
        <div className='flex min-w-0 items-center gap-2 text-sm font-medium'>
          <DriveBrowserItemIcon item={snapshot.current} />
          <span className='min-w-0 truncate'>{snapshot.current.name}</span>
        </div>
        <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
          <span>{formatDriveBrowserSize(snapshot.current)}</span>
          <span>{driveBrowserKindLabel(snapshot.current.previewKind)}</span>
          <span>{formatDriveBrowserDate(snapshot.current.updatedAt)}</span>
        </div>
      </div>
      <div className='flex shrink-0 flex-wrap gap-2'>
        {actions.fileDownloadUrl ? (
          <Button asChild variant='outline' size='sm'>
            <a href={actions.fileDownloadUrl}>
              <Download data-icon='inline-start' />
              下载
            </a>
          </Button>
        ) : null}
        {actions.fileOpenUrl ? (
          <Button asChild variant='outline' size='sm'>
            <a href={actions.fileOpenUrl} target='_blank' rel='noreferrer'>
              <ExternalLink data-icon='inline-start' />
              新窗口打开
            </a>
          </Button>
        ) : null}
        {onOpenVersions ? (
          <Button type='button' variant='outline' size='sm' onClick={onOpenVersions}>
            <History data-icon='inline-start' />
            历史版本
          </Button>
        ) : null}
        {rendererOptions.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type='button' variant='outline' size='sm'>打开方式</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {rendererOptions.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.id}
                  checked={option.id === rendererId}
                  onCheckedChange={() => onRendererChange(option.id)}
                >
                  {option.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </header>
  )
}
