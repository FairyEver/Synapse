import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { ChevronDown, MoreHorizontal } from 'lucide-react'
import { RelativeTime } from '@/components/relative-time'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { useFilePreviewLayoutMode } from '@/features/file-browser/preview/file-preview-layout'
import {
  FilePreviewToolbarItemView,
  FilePreviewToolbarMenuItems,
  getCompactOverflowToolbarItems,
  getCompactPrimaryToolbarItems,
} from '@/features/file-browser/preview/file-preview-toolbar'
import { DriveBrowserItemIcon } from '../shared/drive-icons'
import { DriveShareViewerStatus } from '../shared/drive-share-viewer-status'
import { getDrivePreviewFileIdentity, getDrivePreviewSystemActions } from './drive-preview-actions'
import type { DrivePreviewSystemAction } from './drive-preview-actions'
import type { DriveRendererId, DriveRendererOption } from './drive-renderer-registry'
import type { DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

const DRIVE_PREVIEW_PRIMARY_ACTION_IDS = new Set<DrivePreviewSystemAction['id']>([
  'renderer-select',
])

export function DrivePreviewHeader({
  snapshot,
  rendererItems,
  selectedRendererId,
  onRendererChange,
  onOpenVersions,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly rendererItems: readonly DriveRendererToolbarItem[]
  readonly rendererOptions: readonly DriveRendererOption[]
  readonly selectedRendererId: DriveRendererId | null
  readonly onRendererChange: (id: DriveRendererId) => void
  readonly onOpenVersions: (itemId: string) => void
}) {
  const identity = getDrivePreviewFileIdentity(snapshot)
  const systemActions = getDrivePreviewSystemActions(snapshot, selectedRendererId)
  const layoutMode = useFilePreviewLayoutMode()
  const primaryActions = systemActions.filter((action) => DRIVE_PREVIEW_PRIMARY_ACTION_IDS.has(action.id))
  const overflowActions = systemActions.filter((action) => !DRIVE_PREVIEW_PRIMARY_ACTION_IDS.has(action.id))
  const hasHeaderActions = primaryActions.length > 0 || overflowActions.length > 0
  const showActionSeparator = rendererItems.length > 0 && hasHeaderActions
  const showViewerStatus = snapshot.context === 'share'
  const showViewerSeparator = showViewerStatus && (rendererItems.length > 0 || hasHeaderActions)

  if (layoutMode === 'compact') {
    return (
      <DrivePreviewCompactHeader
        snapshot={snapshot}
        rendererItems={rendererItems}
        systemActions={systemActions}
        selectedRendererId={selectedRendererId}
        onRendererChange={onRendererChange}
        onOpenVersions={onOpenVersions}
      />
    )
  }

  return (
    <header data-drive-preview-header='true' data-file-preview-header='regular' className='flex shrink-0 flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between'>
      <div className='flex min-w-0 flex-col gap-1'>
        <div className='flex min-w-0 items-center gap-2 text-sm font-medium'>
          <DriveBrowserItemIcon item={snapshot.current} />
          <span className='min-w-0 truncate'>{identity.name}</span>
        </div>
        <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
          <span>{identity.sizeLabel}</span>
          <span>{identity.kindLabel}</span>
          <RelativeTime value={identity.updatedAt} />
        </div>
      </div>
      <div className='flex shrink-0 flex-wrap items-center gap-2'>
        {rendererItems.map((item) => <DrivePreviewToolbarItemView key={item.id} item={item} />)}
        {showActionSeparator ? (
          <Separator
            orientation='vertical'
            data-drive-preview-action-separator='true'
            className='h-6'
          />
        ) : null}
        {primaryActions.map((action) => (
          <DrivePreviewHeaderAction
            key={action.id}
            action={action}
            selectedRendererId={selectedRendererId}
            onRendererChange={onRendererChange}
            onOpenVersions={onOpenVersions}
          />
        ))}
        {overflowActions.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-drive-telemetry-event='web.drive.preview.menu' type='button' variant='outline' size='icon' className='h-8 w-8' aria-label='更多操作'>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent data-drive-telemetry-scope='portal' align='end'>
              <DropdownMenuGroup>
                {overflowActions.map((action) => (
                  <DrivePreviewHeaderMenuAction
                    key={action.id}
                    action={action}
                    selectedRendererId={selectedRendererId}
                    onRendererChange={onRendererChange}
                    onOpenVersions={onOpenVersions}
                  />
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {showViewerStatus ? (
          <div className='flex shrink-0 items-center gap-2'>
            {showViewerSeparator ? (
              <Separator
                orientation='vertical'
                data-drive-preview-viewer-separator='true'
                className='h-6'
              />
            ) : null}
            <DriveShareViewerStatus snapshot={snapshot} />
          </div>
        ) : null}
      </div>
    </header>
  )
}

function DrivePreviewCompactHeader({
  snapshot,
  rendererItems,
  systemActions,
  selectedRendererId,
  onRendererChange,
  onOpenVersions,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly rendererItems: readonly DriveRendererToolbarItem[]
  readonly systemActions: readonly DrivePreviewSystemAction[]
  readonly selectedRendererId: DriveRendererId | null
  readonly onRendererChange: (id: DriveRendererId) => void
  readonly onOpenVersions: (itemId: string) => void
}) {
  const identity = getDrivePreviewFileIdentity(snapshot)
  const primaryItems = getCompactPrimaryToolbarItems(rendererItems)
  const overflowItems = getCompactOverflowToolbarItems(rendererItems)
  const showViewerStatus = snapshot.context === 'share'
  const hasMenuActions = overflowItems.length > 0 || systemActions.length > 0 || showViewerStatus

  return (
    <header data-drive-preview-header='true' data-file-preview-header='compact' className='shrink-0 border-b'>
      <div className='flex min-h-14 min-w-0 items-center gap-3 px-3'>
        <DriveBrowserItemIcon item={snapshot.current} />
        <span className='min-w-0 flex-1 truncate text-sm font-medium'>{identity.name}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button data-drive-telemetry-event='web.drive.preview.menu' type='button' variant='outline' size='icon' className='size-11' aria-label='更多操作'>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent data-drive-telemetry-scope='portal' align='end' className='w-72'>
            <DropdownMenuLabel className='min-w-0 truncate'>{identity.name}</DropdownMenuLabel>
            <div className='px-2 pb-2 text-xs text-muted-foreground'>
              {identity.sizeLabel} / {identity.kindLabel} / <RelativeTime value={identity.updatedAt} />
            </div>
            {hasMenuActions ? <DropdownMenuSeparator /> : null}
            <FilePreviewToolbarMenuItems items={overflowItems} />
            {overflowItems.length > 0 && systemActions.length > 0 ? <DropdownMenuSeparator /> : null}
            {systemActions.map((action) => (
              <DrivePreviewHeaderMenuAction
                key={action.id}
                action={action}
                selectedRendererId={selectedRendererId}
                onRendererChange={onRendererChange}
                onOpenVersions={onOpenVersions}
              />
            ))}
            {showViewerStatus ? (
              <>
                {(overflowItems.length > 0 || systemActions.length > 0) ? <DropdownMenuSeparator /> : null}
                <div className='px-2 py-1.5'>
                  <DriveShareViewerStatus
                    snapshot={snapshot}
                    className='min-h-11 w-full justify-start'
                  />
                </div>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {primaryItems.length > 0 ? (
        <div className='flex min-h-14 max-w-full items-center gap-2 overflow-x-auto border-t px-3 py-1.5'>
          {primaryItems.map((item) => (
            <FilePreviewToolbarItemView key={item.id} item={item} compact />
          ))}
        </div>
      ) : null}
    </header>
  )
}

function DrivePreviewHeaderAction({
  action,
  selectedRendererId,
  onRendererChange,
  onOpenVersions,
}: {
  readonly action: DrivePreviewSystemAction
  readonly selectedRendererId: DriveRendererId | null
  readonly onRendererChange: (id: DriveRendererId) => void
  readonly onOpenVersions: (itemId: string) => void
}) {
  if (action.kind === 'link') {
    return (
      <Button asChild variant='outline' size='sm'>
        <a data-drive-telemetry-event='web.drive.preview.action' href={action.href} target={action.external ? '_blank' : undefined} rel={action.external ? 'noreferrer' : undefined}>
          <action.icon data-icon='inline-start' />
          {action.label}
        </a>
      </Button>
    )
  }
  if (action.kind === 'versions') {
    return (
      <Button data-drive-telemetry-event='web.drive.preview.versions' type='button' variant='outline' size='sm' onClick={() => onOpenVersions(action.itemId)}>
        <action.icon data-icon='inline-start' />
        {action.label}
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-drive-telemetry-event='web.drive.preview.renderer-menu' type='button' variant='outline' size='sm'>
          {action.label}
          <ChevronDown data-icon='inline-end' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-drive-telemetry-scope='portal' align='end'>
        {action.options.map((option) => (
          <DropdownMenuCheckboxItem
            data-drive-telemetry-event='web.drive.renderer.select'
            key={option.id}
            checked={option.id === selectedRendererId}
            disabled={Boolean(option.disabledReason)}
            onCheckedChange={() => {
              if (!option.disabledReason) onRendererChange(option.id)
            }}
          >
            <DriveRendererOptionMenuLabel option={option} />
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DrivePreviewHeaderMenuAction({
  action,
  selectedRendererId,
  onRendererChange,
  onOpenVersions,
}: {
  readonly action: DrivePreviewSystemAction
  readonly selectedRendererId: DriveRendererId | null
  readonly onRendererChange: (id: DriveRendererId) => void
  readonly onOpenVersions: (itemId: string) => void
}) {
  if (action.kind === 'link') {
    return (
      <DropdownMenuItem asChild>
        <a data-drive-telemetry-event='web.drive.preview.action' href={action.href} target={action.external ? '_blank' : undefined} rel={action.external ? 'noreferrer' : undefined}>
          <action.icon data-icon='inline-start' />
          {action.label}
        </a>
      </DropdownMenuItem>
    )
  }
  if (action.kind === 'versions') {
    return (
      <DropdownMenuItem data-drive-telemetry-event='web.drive.preview.versions' onSelect={() => onOpenVersions(action.itemId)}>
        <action.icon data-icon='inline-start' />
        {action.label}
      </DropdownMenuItem>
    )
  }
  return action.options.map((option) => (
    <DropdownMenuCheckboxItem
      data-drive-telemetry-event='web.drive.renderer.select'
      key={option.id}
      checked={option.id === selectedRendererId}
      disabled={Boolean(option.disabledReason)}
      onCheckedChange={() => {
        if (!option.disabledReason) onRendererChange(option.id)
      }}
    >
      <DriveRendererOptionMenuLabel option={option} />
    </DropdownMenuCheckboxItem>
  ))
}

export function DriveRendererOptionMenuLabel({ option }: { readonly option: DriveRendererOption }) {
  if (!option.disabledReason) return <>{option.label}</>
  return (
    <span className='flex min-w-0 flex-col gap-0.5'>
      <span>{option.label}</span>
      <span className='text-xs text-muted-foreground'>{option.disabledReason}</span>
    </span>
  )
}

export function DrivePreviewToolbarItemView({ item }: { readonly item: DriveRendererToolbarItem }) {
  return <FilePreviewToolbarItemView item={item} />
}
