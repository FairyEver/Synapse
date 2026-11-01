import {
  Button,
  Dropdown,
  Label,
  Link,
  Separator,
  Tooltip,
} from '@heroui/react'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { ChevronDown, MoreHorizontal } from 'lucide-react'
import { RelativeTime } from '@/components/relative-time'
import { useFilePreviewLayoutMode } from '@/features/file-browser/preview/file-preview-layout'
import {
  FilePreviewToolbarItemView,
  FilePreviewToolbarMenuItems,
  getCompactOverflowToolbarItems,
  getCompactPrimaryToolbarItems,
} from '@/features/file-browser/preview/file-preview-toolbar'
import { DriveBrowserItemIcon } from '../shared/drive-icons'
import { DriveShareViewerStatus } from '../shared/drive-share-viewer-status'
import {
  getDrivePreviewFileIdentity,
  getDrivePreviewSystemActions,
} from './drive-preview-actions'
import type {
  DrivePreviewPdfExportAction,
  DrivePreviewSystemAction,
} from './drive-preview-actions'
import { copyDrivePreviewShareLink } from './drive-preview-share-clipboard'
import type {
  DriveRendererId,
  DriveRendererOption,
} from './drive-renderer-registry'
import type { DriveRendererToolbarItem } from './drive-renderer-toolbar-context'
const DRIVE_PREVIEW_PRIMARY_ACTION_IDS = new Set<
  DrivePreviewSystemAction['id']
>(['renderer-select'])
export function DrivePreviewHeader({
  snapshot,
  rendererItems,
  selectedRendererId,
  onRendererChange,
  onOpenVersions,
  pdfExport,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly rendererItems: readonly DriveRendererToolbarItem[]
  readonly rendererOptions: readonly DriveRendererOption[]
  readonly selectedRendererId: DriveRendererId | null
  readonly onRendererChange: (id: DriveRendererId) => void
  readonly onOpenVersions: (itemId: string) => void
  readonly pdfExport?: Omit<
    DrivePreviewPdfExportAction,
    'kind' | 'id' | 'label' | 'icon'
  >
}) {
  const identity = getDrivePreviewFileIdentity(snapshot)
  const systemActions = getDrivePreviewSystemActions(
    snapshot,
    selectedRendererId,
    pdfExport
  )
  const layoutMode = useFilePreviewLayoutMode()
  const primaryActions = systemActions.filter((action) =>
    DRIVE_PREVIEW_PRIMARY_ACTION_IDS.has(action.id)
  )
  const overflowActions = systemActions.filter(
    (action) => !DRIVE_PREVIEW_PRIMARY_ACTION_IDS.has(action.id)
  )
  const hasHeaderActions =
    primaryActions.length > 0 || overflowActions.length > 0
  const showActionSeparator = rendererItems.length > 0 && hasHeaderActions
  const showViewerStatus = snapshot.context === 'share'
  const showViewerSeparator =
    showViewerStatus && (rendererItems.length > 0 || hasHeaderActions)
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
    <header
      data-drive-preview-header='true'
      data-file-preview-header='regular'
      className='flex shrink-0 items-center justify-between gap-2 border-b p-2'
    >
      <div className='flex min-w-0 flex-1 items-center gap-2 text-sm font-medium'>
        <DriveBrowserItemIcon item={snapshot.current} />
        <Tooltip>
          <Tooltip.Trigger
            data-drive-preview-file-name='true'
            className='min-w-0 truncate text-left focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
          >
            {identity.name}
          </Tooltip.Trigger>
          <Tooltip.Content placement='bottom' offset={6}>
            <span
              data-drive-preview-file-metadata='true'
              className='flex items-center gap-2 whitespace-nowrap'
            >
              <span>{identity.sizeLabel}</span>
              <span>{identity.kindLabel}</span>
              <RelativeTime value={identity.updatedAt} />
            </span>
          </Tooltip.Content>
        </Tooltip>
      </div>
      <div className='flex shrink-0 flex-wrap items-center gap-2'>
        {rendererItems.length > 0 ? (
          <div
            data-drive-preview-renderer-actions='true'
            className='flex items-center gap-1'
          >
            {rendererItems.map((item) => (
              <DrivePreviewToolbarItemView key={item.id} item={item} />
            ))}
          </div>
        ) : null}
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
          <Dropdown>
            <Button
              data-drive-telemetry-event='web.drive.preview.menu'
              type='button'
              variant='ghost'
              isIconOnly
              className='size-8'
              aria-label='更多操作'
            >
              <MoreHorizontal />
            </Button>
            <Dropdown.Popover isNonModal data-drive-telemetry-scope='portal'>
              <Dropdown.Menu aria-label='操作'>
                {overflowActions.map((action) => (
                  <DrivePreviewHeaderMenuAction
                    key={action.id}
                    action={action}
                    selectedRendererId={selectedRendererId}
                    onRendererChange={onRendererChange}
                    onOpenVersions={onOpenVersions}
                  />
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
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
  const hasMenuActions =
    overflowItems.length > 0 || systemActions.length > 0 || showViewerStatus
  return (
    <header
      data-drive-preview-header='true'
      data-file-preview-header='compact'
      className='shrink-0 border-b'
    >
      <div className='flex min-h-14 min-w-0 items-center gap-3 px-3'>
        <DriveBrowserItemIcon item={snapshot.current} />
        <span className='min-w-0 flex-1 truncate text-sm font-medium'>
          {identity.name}
        </span>
        <Dropdown>
          <Button
            data-drive-telemetry-event='web.drive.preview.menu'
            type='button'
            variant='outline'
            isIconOnly
            className='size-11'
            aria-label='更多操作'
          >
            <MoreHorizontal />
          </Button>
          <Dropdown.Popover
            isNonModal
            data-drive-telemetry-scope='portal'
            className='w-72'
          >
            <div className='px-3 py-2'>
              <Label className='min-w-0 truncate'>{identity.name}</Label>
              <div className='px-2 pb-2 text-xs text-muted'>
                {identity.sizeLabel} / {identity.kindLabel} /{' '}
                <RelativeTime value={identity.updatedAt} />
              </div>
            </div>
            <Dropdown.Menu aria-label='操作'>
              {hasMenuActions ? <Separator /> : null}
              <FilePreviewToolbarMenuItems items={overflowItems} />
              {overflowItems.length > 0 && systemActions.length > 0 ? (
                <Separator />
              ) : null}
              {systemActions.map((action) => (
                <DrivePreviewHeaderMenuAction
                  key={action.id}
                  action={action}
                  selectedRendererId={selectedRendererId}
                  onRendererChange={onRendererChange}
                  onOpenVersions={onOpenVersions}
                />
              ))}
            </Dropdown.Menu>
            {showViewerStatus ? (
              <>
                {overflowItems.length > 0 || systemActions.length > 0 ? (
                  <Separator />
                ) : null}
                <div className='px-2 py-1.5'>
                  <DriveShareViewerStatus
                    snapshot={snapshot}
                    className='min-h-11 w-full justify-start'
                  />
                </div>
              </>
            ) : null}
          </Dropdown.Popover>
        </Dropdown>
      </div>
      {primaryItems.length > 0 ? (
        <div className='flex min-h-14 max-w-full items-center gap-2 overflow-x-auto border-t px-3 py-1.5'>
          {primaryItems.map((item) => (
            <DrivePreviewToolbarItemView key={item.id} item={item} compact />
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
      <Link
        className='gap-1'
        data-drive-telemetry-event='web.drive.preview.action'
        href={action.href}
        target={action.external ? '_blank' : undefined}
        rel={action.external ? 'noreferrer' : undefined}
      >
        <Link.Icon><action.icon className='size-full' /></Link.Icon>
        {action.label}
      </Link>
    )
  }
  if (action.kind === 'copy-share-link') {
    return (
      <Button
        data-drive-telemetry-event='web.drive.preview.copy-share-link'
        type='button'
        variant='outline'
        size='sm'
        onPress={() => {
          void copyDrivePreviewShareLink(action)
        }}
      >
        <action.icon data-icon='inline-start' />
        {action.label}
      </Button>
    )
  }
  if (action.kind === 'versions') {
    return (
      <Button
        data-drive-telemetry-event='web.drive.preview.versions'
        type='button'
        variant='outline'
        size='sm'
        onPress={() => onOpenVersions(action.itemId)}
      >
        <action.icon data-icon='inline-start' />
        {action.label}
      </Button>
    )
  }
  if (action.kind === 'pdf-export') {
    return (
      <Button
        data-drive-telemetry-event='web.drive.preview.export-pdf'
        type='button'
        variant='outline'
        size='sm'
        isDisabled={action.exporting || Boolean(action.disabledReason)}
        onPress={() => {
          void action.onExport()
        }}
      >
        <action.icon data-icon='inline-start' />
        {action.label}
      </Button>
    )
  }
  return (
    <Dropdown>
      <Button
        data-drive-telemetry-event='web.drive.preview.renderer-menu'
        type='button'
        variant='ghost'
        size='sm'
      >
        {action.label}
        <ChevronDown data-icon='inline-end' />
      </Button>
      <Dropdown.Popover isNonModal data-drive-telemetry-scope='portal'>
        <Dropdown.Menu aria-label='操作'>
          {action.options.map((option) => (
            <Dropdown.Section
              key={option.id}
              selectionMode='single'
              selectedKeys={option.id === selectedRendererId ? [option.id] : []}
            >
              <Dropdown.Item
                data-drive-telemetry-event='web.drive.renderer.select'
                key={option.id}
                isDisabled={Boolean(option.disabledReason)}
                id={option.id}
                onAction={() =>
                  (() => {
                    if (!option.disabledReason) onRendererChange(option.id)
                  })()
                }
              >
                <Dropdown.ItemIndicator />
                <DriveRendererOptionMenuLabel option={option} />
              </Dropdown.Item>
            </Dropdown.Section>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
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
      <Dropdown.Item
        data-drive-telemetry-event='web.drive.preview.action'
        href={action.href}
        target={action.external ? '_blank' : undefined}
        rel={action.external ? 'noreferrer' : undefined}
      >
        <action.icon data-icon='inline-start' />
        {action.label}
      </Dropdown.Item>
    )
  }
  if (action.kind === 'copy-share-link') {
    return (
      <Dropdown.Item
        data-drive-telemetry-event='web.drive.preview.copy-share-link'
        onAction={() => {
          void copyDrivePreviewShareLink(action)
        }}
      >
        <action.icon data-icon='inline-start' />
        {action.label}
      </Dropdown.Item>
    )
  }
  if (action.kind === 'versions') {
    return (
      <Dropdown.Item
        data-drive-telemetry-event='web.drive.preview.versions'
        onAction={() => onOpenVersions(action.itemId)}
      >
        <action.icon data-icon='inline-start' />
        {action.label}
      </Dropdown.Item>
    )
  }
  if (action.kind === 'pdf-export') {
    return (
      <Dropdown.Item
        data-drive-telemetry-event='web.drive.preview.export-pdf'
        isDisabled={action.exporting || Boolean(action.disabledReason)}
        onAction={() => {
          void action.onExport()
        }}
      >
        <action.icon data-icon='inline-start' />
        {action.disabledReason ? (
          <span className='flex min-w-0 flex-col gap-0.5'>
            <span>{action.label}</span>
            <span className='text-xs text-muted'>{action.disabledReason}</span>
          </span>
        ) : (
          action.label
        )}
      </Dropdown.Item>
    )
  }
  return action.options.map((option) => (
    <Dropdown.Section
      key={option.id}
      selectionMode='single'
      selectedKeys={option.id === selectedRendererId ? [option.id] : []}
    >
      <Dropdown.Item
        data-drive-telemetry-event='web.drive.renderer.select'
        key={option.id}
        isDisabled={Boolean(option.disabledReason)}
        id={option.id}
        onAction={() =>
          (() => {
            if (!option.disabledReason) onRendererChange(option.id)
          })()
        }
      >
        <Dropdown.ItemIndicator />
        <DriveRendererOptionMenuLabel option={option} />
      </Dropdown.Item>
    </Dropdown.Section>
  ))
}
export function DriveRendererOptionMenuLabel({
  option,
}: {
  readonly option: DriveRendererOption
}) {
  if (!option.disabledReason) return <>{option.label}</>
  return (
    <span className='flex min-w-0 flex-col gap-0.5'>
      <span>{option.label}</span>
      <span className='text-xs text-muted'>{option.disabledReason}</span>
    </span>
  )
}
export function DrivePreviewToolbarItemView({
  item,
  compact = false,
}: {
  readonly item: DriveRendererToolbarItem
  readonly compact?: boolean
}) {
  return (
    <FilePreviewToolbarItemView
      item={item}
      compact={compact}
      defaultButtonVariant='ghost'
    />
  )
}
