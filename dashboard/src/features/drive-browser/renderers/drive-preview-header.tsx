import {
  Button,
  ButtonGroup,
  Description,
  Dropdown,
  Header,
  Label,
  Link,
  Separator,
  Toolbar,
  Tooltip,
} from '@heroui/react'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { ChevronDown } from 'lucide-react'
import { RelativeTime } from '@/components/relative-time'
import { cn } from '@/lib/utils'
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
  getDrivePreviewDisplayName,
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
  const displayName = getDrivePreviewDisplayName(snapshot, selectedRendererId)
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
            {displayName}
          </Tooltip.Trigger>
          <Tooltip.Content placement='bottom' offset={6}>
            <span
              data-drive-preview-file-metadata='true'
              className='flex max-w-sm flex-col gap-1'
            >
              <span className='break-words'>{identity.name}</span>
              <span className='flex items-center gap-2'>
                <span>{identity.sizeLabel}</span>
                <span>{identity.kindLabel}</span>
                <RelativeTime value={identity.updatedAt} />
              </span>
            </span>
          </Tooltip.Content>
        </Tooltip>
      </div>
      <Toolbar
        aria-label='文档工具栏'
        className='flex shrink-0 flex-wrap items-center gap-2'
      >
        {rendererItems.length > 0 ? (
          <div
            data-drive-preview-renderer-actions='true'
            className='flex items-center gap-1'
          >
            <DrivePreviewToolbarItems items={rendererItems} />
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
              size='sm'
              aria-label='更多操作'
            >
              更多
              <ChevronDown data-icon='inline-end' />
            </Button>
            <Dropdown.Popover data-drive-telemetry-scope='portal'>
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
      </Toolbar>
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
  const displayName = getDrivePreviewDisplayName(snapshot, selectedRendererId)
  const primaryItems = getCompactPrimaryToolbarItems(rendererItems)
  const overflowItems = getCompactOverflowToolbarItems(rendererItems)
  const showViewerStatus = snapshot.context === 'share'
  const fileActions = systemActions.filter(
    (action) => action.kind !== 'renderer-select'
  )
  const rendererAction = systemActions.find(
    (action) => action.kind === 'renderer-select'
  )
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
          {displayName}
        </span>
        <Dropdown>
          <Button
            data-drive-telemetry-event='web.drive.preview.menu'
            type='button'
            variant='outline'
            className='min-h-11'
            aria-label='更多操作'
          >
            更多
            <ChevronDown data-icon='inline-end' />
          </Button>
          <Dropdown.Popover
            data-drive-telemetry-scope='portal'
            className='w-72'
          >
            <div
              data-drive-preview-file-metadata='true'
              className='min-w-0 space-y-1 px-4 py-3'
            >
              <p
                data-drive-preview-menu-file-name
                className='truncate text-sm font-medium'
                title={identity.name}
              >
                {identity.name}
              </p>
              <Description>
                {identity.sizeLabel} · {identity.kindLabel} ·{' '}
                <RelativeTime value={identity.updatedAt} />
              </Description>
            </div>
            <Dropdown.Menu aria-label='操作'>
              {hasMenuActions ? <Separator /> : null}
              <FilePreviewToolbarMenuItems items={overflowItems} />
              {overflowItems.length > 0 && fileActions.length > 0 ? (
                <Separator />
              ) : null}
              {fileActions.map((action) => (
                <DrivePreviewHeaderMenuAction
                  key={action.id}
                  action={action}
                  selectedRendererId={selectedRendererId}
                  onRendererChange={onRendererChange}
                  onOpenVersions={onOpenVersions}
                />
              ))}
              {rendererAction ? (
                <>
                  {overflowItems.length > 0 || fileActions.length > 0 ? (
                    <Separator />
                  ) : null}
                  <DrivePreviewHeaderMenuAction
                    action={rendererAction}
                    selectedRendererId={selectedRendererId}
                    onRendererChange={onRendererChange}
                    onOpenVersions={onOpenVersions}
                    showRendererHeading
                  />
                </>
              ) : null}
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
        <Toolbar
          aria-label='文档工具栏'
          className='flex min-h-14 w-full max-w-full items-center gap-2 overflow-x-auto border-t px-3 py-1.5'
        >
          <DrivePreviewToolbarItems items={primaryItems} compact />
        </Toolbar>
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
      <Dropdown.Popover data-drive-telemetry-scope='portal'>
        <Dropdown.Menu aria-label='操作'>
          <DrivePreviewHeaderMenuAction
            action={action}
            selectedRendererId={selectedRendererId}
            onRendererChange={onRendererChange}
            onOpenVersions={onOpenVersions}
          />
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
  showRendererHeading = false,
}: {
  readonly action: DrivePreviewSystemAction
  readonly selectedRendererId: DriveRendererId | null
  readonly onRendererChange: (id: DriveRendererId) => void
  readonly onOpenVersions: (itemId: string) => void
  readonly showRendererHeading?: boolean
}) {
  if (action.kind === 'link') {
    return (
      <Dropdown.Item
        textValue={action.label}
        data-drive-telemetry-event='web.drive.preview.action'
        href={action.href}
        target={action.external ? '_blank' : undefined}
        rel={action.external ? 'noreferrer' : undefined}
      >
        <action.icon aria-hidden className='size-4 shrink-0 text-muted' />
        <Label>{action.label}</Label>
      </Dropdown.Item>
    )
  }
  if (action.kind === 'copy-share-link') {
    return (
      <Dropdown.Item
        textValue={action.label}
        data-drive-telemetry-event='web.drive.preview.copy-share-link'
        onAction={() => {
          void copyDrivePreviewShareLink(action)
        }}
      >
        <action.icon aria-hidden className='size-4 shrink-0 text-muted' />
        <Label>{action.label}</Label>
      </Dropdown.Item>
    )
  }
  if (action.kind === 'versions') {
    return (
      <Dropdown.Item
        textValue={action.label}
        data-drive-telemetry-event='web.drive.preview.versions'
        onAction={() => onOpenVersions(action.itemId)}
      >
        <action.icon aria-hidden className='size-4 shrink-0 text-muted' />
        <Label>{action.label}</Label>
      </Dropdown.Item>
    )
  }
  if (action.kind === 'pdf-export') {
    return (
      <Dropdown.Item
        textValue={action.label}
        data-drive-telemetry-event='web.drive.preview.export-pdf'
        isDisabled={action.exporting || Boolean(action.disabledReason)}
        onAction={() => {
          void action.onExport()
        }}
      >
        <action.icon aria-hidden className='size-4 shrink-0 text-muted' />
        {action.disabledReason ? (
          <span className='flex min-w-0 flex-col gap-0.5'>
            <Label>{action.label}</Label>
            <Description>{action.disabledReason}</Description>
          </span>
        ) : (
          <Label>{action.label}</Label>
        )}
      </Dropdown.Item>
    )
  }
  return (
    <Dropdown.Section
      aria-label='打开方式'
      selectionMode='single'
      selectedKeys={selectedRendererId ? [selectedRendererId] : []}
    >
      {showRendererHeading ? <Header>打开方式</Header> : null}
      {action.options.map((option) => (
        <Dropdown.Item
          data-drive-telemetry-event='web.drive.renderer.select'
          key={option.id}
          isDisabled={Boolean(option.disabledReason)}
          id={option.id}
          textValue={option.label}
          onAction={() => {
            if (!option.disabledReason) onRendererChange(option.id)
          }}
        >
          <Dropdown.ItemIndicator />
          <DriveRendererOptionMenuLabel
            option={option}
            alignWithActionIcons={showRendererHeading}
          />
        </Dropdown.Item>
      ))}
    </Dropdown.Section>
  )
}
export function DriveRendererOptionMenuLabel({
  option,
  alignWithActionIcons = false,
}: {
  readonly option: DriveRendererOption
  readonly alignWithActionIcons?: boolean
}) {
  return (
    <span
      className={cn(
        'flex min-w-0 flex-col gap-0.5',
        // Native selection padding reserves 10px less than a 16px action icon plus the menu gap.
        alignWithActionIcons && 'ps-2.5'
      )}
    >
      <Label>{option.label}</Label>
      {option.disabledReason ? <Description>{option.disabledReason}</Description> : null}
    </span>
  )
}
function DrivePreviewToolbarItems({
  items,
  compact = false,
}: {
  readonly items: readonly DriveRendererToolbarItem[]
  readonly compact?: boolean
}) {
  const groups: { label?: string; items: DriveRendererToolbarItem[] }[] = []
  for (const item of items) {
    const previous = groups.at(-1)
    if (item.group && previous?.label === item.group) {
      previous.items.push(item)
    } else {
      groups.push({ label: item.group, items: [item] })
    }
  }
  return groups.map(({ label, items: groupItems }) => {
    const controls = groupItems.map((item) => (
      <DrivePreviewToolbarItemView key={item.id} item={item} compact={compact} />
    ))
    return label ? (
      <ButtonGroup
        key={groupItems[0].id}
        aria-label={label}
        size='sm'
        variant='tertiary'
        className='shrink-0'
      >
        {controls}
      </ButtonGroup>
    ) : controls
  })
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
      showIcons={false}
    />
  )
}
