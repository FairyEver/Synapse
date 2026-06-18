import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  buildConsoleDriveBrowserUrl,
  buildConsoleDriveItemBrowserUrl,
  type DriveBrowserSnapshotDto,
  type DriveFileContentUpdateResult,
} from '@synapse/shared'
import { Download, ExternalLink, History, MoreHorizontal } from 'lucide-react'
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
import { DriveFileVersionsDialog } from '../drive-file-versions-dialog'
import { driveBrowserKindLabel, formatDriveBrowserDate, formatDriveBrowserSize } from '../shared/drive-format'
import { DriveBrowserItemIcon } from '../shared/drive-icons'
import { getDriveFileVersionItemId } from '../shared/drive-view-model'
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
import { DriveMDXeditorRenderer } from './mdxeditor-renderer'

const READING_CONTAINER_CLASSNAME = 'mx-auto w-full max-w-4xl px-4 md:px-6'
const MEDIA_CONTAINER_CLASSNAME = 'mx-auto w-full max-w-6xl px-4 md:px-6'
const FULL_CONTAINER_CLASSNAME = 'h-full min-h-0 w-full'
const FLOATING_MENU_MARGIN = 20
const FLOATING_MENU_FALLBACK_SIZE = 36
const FLOATING_MENU_DRAG_THRESHOLD_PX = 4
const FLOATING_MENU_IDLE_DIM_DELAY_MS = 3000

type DriveFloatingMenuPoint = {
  readonly left: number
  readonly top: number
}

type DriveFloatingMenuSize = {
  readonly width: number
  readonly height: number
}

type DriveFloatingMenuDragState = {
  readonly pointerId: number
  readonly startPointer: DriveFloatingMenuPoint
  readonly startPosition: DriveFloatingMenuPoint
  moved: boolean
}

export type DriveRendererEditContext = {
  readonly reload: () => Promise<DriveBrowserSnapshotDto>
  readonly reloading: boolean
  readonly saveText: (input: { readonly text: string; readonly baseVersionId: string }) => Promise<DriveFileContentUpdateResult>
  readonly savingText: boolean
}

export function clampDriveFloatingMenuPosition(
  position: DriveFloatingMenuPoint,
  viewport: DriveFloatingMenuSize,
  menuSize: DriveFloatingMenuSize,
  margin = FLOATING_MENU_MARGIN
): DriveFloatingMenuPoint {
  const maxLeft = Math.max(margin, viewport.width - menuSize.width - margin)
  const maxTop = Math.max(margin, viewport.height - menuSize.height - margin)
  return {
    left: Math.min(Math.max(position.left, margin), maxLeft),
    top: Math.min(Math.max(position.top, margin), maxTop),
  }
}

export function shouldSuppressDriveFloatingMenuOpen(
  start: DriveFloatingMenuPoint,
  current: DriveFloatingMenuPoint,
  threshold = FLOATING_MENU_DRAG_THRESHOLD_PX
): boolean {
  return Math.hypot(current.left - start.left, current.top - start.top) >= threshold
}

export function getDriveFloatingMenuNewWindowUrl(snapshot: DriveBrowserSnapshotDto): string | null {
  if (snapshot.surface === 'standalone' || snapshot.context === 'share') return null
  return snapshot.preview?.visitUrl ?? null
}

export function getDriveFloatingMenuDriveBrowserUrl(snapshot: DriveBrowserSnapshotDto): string | null {
  if (snapshot.context !== 'owner') return null
  return snapshot.current.type === 'folder'
    ? buildConsoleDriveBrowserUrl(snapshot.current.id)
    : buildConsoleDriveItemBrowserUrl(snapshot.current.id)
}

export function DriveRendererShell({
  snapshot,
  body = false,
  initialRendererId = null,
  rendererId,
  onRendererChange,
  editContext,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly body?: boolean
  readonly initialRendererId?: DriveRendererId | null
  readonly rendererId?: DriveRendererId | null
  readonly onRendererChange?: (id: DriveRendererId) => void
  readonly editContext?: DriveRendererEditContext
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
      <DriveRendererContent snapshot={snapshot} selected={selected} body={body} editContext={editContext} />
    </section>
  )
}

export function DriveRendererContent({
  snapshot,
  selected,
  body = false,
  editContext,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly selected: DriveRendererOption
  readonly body?: boolean
  readonly editContext?: DriveRendererEditContext
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
  if (selected.id === 'mdxeditor') {
    return renderContent(<DriveMDXeditorRenderer current={snapshot.current} preview={preview} edit={snapshot.edit} editContext={editContext} />)
  }
  if (selected.id === 'code') {
    return renderContent(<DriveCodeRenderer current={snapshot.current} preview={preview} edit={snapshot.edit} editContext={editContext} />)
  }
  if (selected.id === 'image') {
    return renderContent(<DriveImageRenderer current={snapshot.current} preview={preview} />)
  }
  if (selected.id === 'iframe' && preview.visitUrl) {
    return renderContent(<DriveIframeRenderer current={snapshot.current} visitUrl={preview.visitUrl} />)
  }
  return renderContent(<DriveCodeRenderer current={snapshot.current} preview={preview} edit={snapshot.edit} editContext={editContext} />)
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
  const driveBrowserUrl = getDriveFloatingMenuDriveBrowserUrl(snapshot)
  const newWindowUrl = getDriveFloatingMenuNewWindowUrl(snapshot)
  const versionItemId = getDriveFileVersionItemId(snapshot)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DriveFloatingMenuDragState | null>(null)
  const suppressClickRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<DriveFloatingMenuPoint | null>(null)
  const [interactionActive, setInteractionActive] = useState(false)
  const [idleDimmed, setIdleDimmed] = useState(false)
  const [activityTick, setActivityTick] = useState(0)

  const menuStyle: CSSProperties | undefined = menuPosition
    ? { left: `${menuPosition.left}px`, top: `${menuPosition.top}px` }
    : undefined

  const markActivity = () => {
    setIdleDimmed(false)
    setActivityTick((current) => current + 1)
  }

  useEffect(() => {
    setIdleDimmed(false)
    if (open || interactionActive) return

    const timer = window.setTimeout(() => {
      setIdleDimmed(true)
    }, FLOATING_MENU_IDLE_DIM_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [activityTick, interactionActive, open])

  const getMenuSize = (): DriveFloatingMenuSize => {
    const rect = menuRef.current?.getBoundingClientRect()
    return {
      width: rect?.width ?? FLOATING_MENU_FALLBACK_SIZE,
      height: rect?.height ?? FLOATING_MENU_FALLBACK_SIZE,
    }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    markActivity()
    if (event.button !== 0) return
    const rect = menuRef.current?.getBoundingClientRect()
    if (!rect) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startPointer: { left: event.clientX, top: event.clientY },
      startPosition: { left: rect.left, top: rect.top },
      moved: false,
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const currentPointer = { left: event.clientX, top: event.clientY }
    const moved = drag.moved || shouldSuppressDriveFloatingMenuOpen(drag.startPointer, currentPointer)
    if (!moved) return
    drag.moved = true
    const nextPosition = {
      left: drag.startPosition.left + currentPointer.left - drag.startPointer.left,
      top: drag.startPosition.top + currentPointer.top - drag.startPointer.top,
    }
    setMenuPosition(clampDriveFloatingMenuPosition(
      nextPosition,
      { width: window.innerWidth, height: window.innerHeight },
      getMenuSize()
    ))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    event.preventDefault()
    suppressClickRef.current = true
    if (!drag.moved) setOpen((current) => !current)
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleClick = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      ref={menuRef}
      className={cn(
        'fixed right-5 z-50',
        selected.id === 'code' ? 'top-14' : 'top-5',
        menuPosition && 'top-auto right-auto'
      )}
      style={menuStyle}
    >
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type='button'
            size='icon'
            className={cn(
              'touch-none rounded-full cursor-grab transition-opacity duration-200 active:cursor-grabbing',
              idleDimmed && !open ? 'opacity-50 hover:opacity-100 focus-visible:opacity-100' : 'opacity-100'
            )}
            aria-label='文件操作'
            onPointerEnter={() => setInteractionActive(true)}
            onPointerLeave={() => setInteractionActive(false)}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onFocus={() => setInteractionActive(true)}
            onBlur={() => setInteractionActive(false)}
            onClick={handleClick}
          >
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
          {newWindowUrl ? (
            <DropdownMenuItem asChild>
              <a href={newWindowUrl} target='_blank' rel='noreferrer'>
                <ExternalLink data-icon='inline-start' />
                新窗口打开
              </a>
            </DropdownMenuItem>
          ) : null}
          {versionItemId ? (
            <DropdownMenuItem onSelect={() => setVersionsOpen(true)}>
              <History data-icon='inline-start' />
              历史版本
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
      {versionsOpen && versionItemId ? (
        <DriveFileVersionsDialog
          itemId={versionItemId}
          open={versionsOpen}
          onOpenChange={setVersionsOpen}
        />
      ) : null}
    </div>
  )
}
