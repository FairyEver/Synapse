import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { Download, ExternalLink, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { driveBrowserKindLabel, formatDriveBrowserDate, formatDriveBrowserSize } from '../shared/drive-format'
import { DriveBrowserItemIcon } from '../shared/drive-icons'
import { DriveCodeRenderer } from './code-renderer'
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

const READING_CONTAINER_CLASSNAME = 'mx-auto w-full max-w-4xl px-4 md:px-6'
const MEDIA_CONTAINER_CLASSNAME = 'mx-auto w-full max-w-6xl px-4 md:px-6'
const FULL_CONTAINER_CLASSNAME = 'h-full min-h-0 w-full'

export function DriveRendererShell({
  snapshot,
  body = false,
  initialRendererId = null,
  rendererId,
  onRendererChange,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly body?: boolean
  readonly initialRendererId?: DriveRendererId | null
  readonly rendererId?: DriveRendererId | null
  readonly onRendererChange?: (id: DriveRendererId) => void
}) {
  const options = useMemo(() => getDriveRendererOptions(snapshot), [snapshot])
  const initialRenderer = findDriveRendererOption(snapshot, initialRendererId)
  const [internalRendererId, setInternalRendererId] = useState<DriveRendererId | null>(
    initialRenderer?.id ?? options[0]?.id ?? null
  )
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
    setInternalRendererId((current) =>
      findDriveRendererOption(snapshot, current)?.id ?? findDriveRendererOption(snapshot, initialRendererId)?.id ?? null
    )
  }, [initialRendererId, rendererId, snapshot])

  if (!selected) return null

  return (
    <section className='h-full min-h-0 bg-background'>
      {body ? (
        <DriveRendererFloatingMenu
          snapshot={snapshot}
          options={options}
          selected={selected}
          onSelect={setRenderer}
        />
      ) : null}
      <DriveRendererContent snapshot={snapshot} selected={selected} body={body} />
    </section>
  )
}

export function DriveRendererContent({
  snapshot,
  selected,
  body = false,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly selected: DriveRendererOption
  readonly body?: boolean
}) {
  const preview = snapshot.preview
  const containerClassName = selected.container === 'media'
    ? MEDIA_CONTAINER_CLASSNAME
    : selected.container === 'reading'
      ? READING_CONTAINER_CLASSNAME
      : FULL_CONTAINER_CLASSNAME
  const contentHostClassName = cn(
    'h-full min-h-0',
    selected.container === 'full' ? 'overflow-hidden' : 'overflow-auto'
  )
  const renderContent = (content: ReactNode) => (
    <div className={contentHostClassName}>
      {body || selected.id === 'markdown' ? content : <div className={containerClassName}>{content}</div>}
    </div>
  )

  if (!preview || selected.id === 'download') {
    return renderContent(<DriveDownloadRenderer current={snapshot.current} />)
  }
  if (selected.id === 'markdown') {
    return renderContent(<DriveMarkdownRenderer current={snapshot.current} preview={preview} />)
  }
  if (selected.id === 'code') {
    return renderContent(<DriveCodeRenderer current={snapshot.current} preview={preview} />)
  }
  if (selected.id === 'image') {
    return renderContent(<DriveImageRenderer current={snapshot.current} preview={preview} />)
  }
  if (selected.id === 'iframe' && preview.visitUrl) {
    return renderContent(<DriveIframeRenderer current={snapshot.current} visitUrl={preview.visitUrl} />)
  }
  return renderContent(<DriveCodeRenderer current={snapshot.current} preview={preview} />)
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
  const driveBrowserUrl = snapshot.context === 'owner' ? snapshot.current.browserUrl : null

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
          {driveBrowserUrl ? (
            <DropdownMenuItem asChild>
              <a href={driveBrowserUrl}>
                <ExternalLink data-icon='inline-start' />
                在云盘中查看
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
          {options.length > 1 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>打开方式</DropdownMenuLabel>
            </>
          ) : null}
          {options.length > 1 ? options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={option.id === selected.id}
              onCheckedChange={() => onSelect(option.id)}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          )) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
