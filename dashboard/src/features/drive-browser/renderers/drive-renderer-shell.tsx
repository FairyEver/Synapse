import { useEffect, useMemo, useState } from 'react'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { Download, ExternalLink, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { driveBrowserKindLabel, formatDriveBrowserDate, formatDriveBrowserSize } from '../shared/drive-format'
import { DriveBrowserItemIcon } from '../shared/drive-icons'
import {
  findDriveRendererOption,
  getDriveRendererOptions,
  type DriveRendererId,
  type DriveRendererOption,
} from './drive-renderer-registry'
import { DriveDownloadRenderer } from './download-renderer'
import { DriveIframeRenderer } from './iframe-renderer'
import { DriveImageRenderer } from './image-renderer'
import { DriveMarkdownRenderer } from './markdown-renderer'
import { DriveSourceRenderer } from './source-renderer'

const READING_CONTAINER_CLASSNAME = 'mx-auto w-full max-w-4xl px-4 md:px-6'
const MEDIA_CONTAINER_CLASSNAME = 'mx-auto w-full max-w-6xl px-4 md:px-6'

export function DriveRendererShell({
  snapshot,
  body = false,
  rendererId,
  onRendererChange,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly body?: boolean
  readonly rendererId?: DriveRendererId | null
  readonly onRendererChange?: (id: DriveRendererId) => void
}) {
  const options = useMemo(() => getDriveRendererOptions(snapshot), [snapshot])
  const [internalRendererId, setInternalRendererId] = useState<DriveRendererId | null>(options[0]?.id ?? null)
  const activeRendererId = rendererId === undefined ? internalRendererId : rendererId
  const selected = findDriveRendererOption(snapshot, activeRendererId)
  const setRenderer = (id: DriveRendererId) => {
    if (onRendererChange) {
      onRendererChange(id)
      return
    }
    setInternalRendererId(id)
  }

  useEffect(() => {
    if (rendererId !== undefined) return
    setInternalRendererId((current) => findDriveRendererOption(snapshot, current)?.id ?? null)
  }, [rendererId, snapshot])

  if (!selected) return null

  return (
    <section className={cn('min-h-0 bg-background', body ? 'min-h-svh' : 'h-full')}>
      {body ? (
        <DriveRendererFloatingMenu
          snapshot={snapshot}
          options={options}
          selected={selected}
          onSelect={setRenderer}
        />
      ) : null}
      <DriveRendererContent snapshot={snapshot} selected={selected} />
    </section>
  )
}

export function DriveRendererContent({
  snapshot,
  selected,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly selected: DriveRendererOption
}) {
  const preview = snapshot.preview
  const containerClassName = selected.container === 'media'
    ? MEDIA_CONTAINER_CLASSNAME
    : selected.container === 'reading'
      ? READING_CONTAINER_CLASSNAME
      : 'min-h-svh w-full px-4 md:px-6'

  if (!preview || selected.id === 'download') {
    return (
      <div className={containerClassName}>
        <DriveDownloadRenderer current={snapshot.current} />
      </div>
    )
  }
  if (selected.id === 'markdown') {
    return (
      <div className={containerClassName}>
        <DriveMarkdownRenderer preview={preview} />
      </div>
    )
  }
  if (selected.id === 'image') {
    return (
      <div className={containerClassName}>
        <DriveImageRenderer current={snapshot.current} preview={preview} />
      </div>
    )
  }
  if (selected.id === 'iframe' && preview.visitUrl) {
    return <DriveIframeRenderer current={snapshot.current} visitUrl={preview.visitUrl} />
  }
  return (
    <div className={containerClassName}>
      <DriveSourceRenderer preview={preview} />
    </div>
  )
}

function DriveRendererFloatingMenu({
  snapshot,
  options,
  selected,
  onSelect,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly options: readonly DriveRendererOption[]
  readonly selected: DriveRendererOption
  readonly onSelect: (id: DriveRendererId) => void
}) {
  return (
    <div className='fixed right-5 bottom-5 z-50'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type='button' size='icon' className='rounded-full' aria-label='文件操作'>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-64'>
          <DropdownMenuLabel className='flex min-w-0 items-center gap-2'>
            <DriveBrowserItemIcon item={snapshot.current} />
            <span className='min-w-0 truncate'>{snapshot.current.name}</span>
          </DropdownMenuLabel>
          <div className='px-2 pb-2 text-xs text-muted-foreground'>
            {formatDriveBrowserSize(snapshot.current)} / {driveBrowserKindLabel(snapshot.current.previewKind)} / {formatDriveBrowserDate(snapshot.current.updatedAt)}
          </div>
          <DropdownMenuSeparator />
          {snapshot.current.downloadUrl ? (
            <DropdownMenuItem asChild>
              <a href={snapshot.current.downloadUrl}>
                <Download data-icon='inline-start' />
                下载
              </a>
            </DropdownMenuItem>
          ) : null}
          {snapshot.preview?.visitUrl ? (
            <DropdownMenuItem asChild>
              <a href={snapshot.preview.visitUrl} target='_blank' rel='noreferrer'>
                <ExternalLink data-icon='inline-start' />
                新窗口打开
              </a>
            </DropdownMenuItem>
          ) : null}
          {options.length > 1 ? <DropdownMenuSeparator /> : null}
          {options.length > 1 ? options.map((option) => (
            <DropdownMenuItem key={option.id} onClick={() => onSelect(option.id)}>
              {option.id === selected.id ? '当前：' : null}{option.label}
            </DropdownMenuItem>
          )) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
