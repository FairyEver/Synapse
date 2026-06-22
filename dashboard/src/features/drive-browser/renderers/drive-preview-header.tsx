import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { ChevronDown, Loader2, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DriveBrowserItemIcon } from '../shared/drive-icons'
import { getDrivePreviewFileIdentity, getDrivePreviewSystemActions } from './drive-preview-actions'
import type { DrivePreviewSystemAction } from './drive-preview-actions'
import type { DriveRendererId, DriveRendererOption } from './drive-renderer-registry'
import type { DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

const DRIVE_PREVIEW_PRIMARY_ACTION_IDS = new Set<DrivePreviewSystemAction['id']>([
  'open-in-drive',
  'versions',
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
  const primaryActions = systemActions.filter((action) => DRIVE_PREVIEW_PRIMARY_ACTION_IDS.has(action.id))
  const overflowActions = systemActions.filter((action) => !DRIVE_PREVIEW_PRIMARY_ACTION_IDS.has(action.id))
  const hasHeaderActions = primaryActions.length > 0 || overflowActions.length > 0
  const showActionSeparator = rendererItems.length > 0 && hasHeaderActions

  return (
    <header data-drive-preview-header='true' className='flex shrink-0 flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between'>
      <div className='flex min-w-0 flex-col gap-1'>
        <div className='flex min-w-0 items-center gap-2 text-sm font-medium'>
          <DriveBrowserItemIcon item={snapshot.current} />
          <span className='min-w-0 truncate'>{identity.name}</span>
        </div>
        <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
          <span>{identity.sizeLabel}</span>
          <span>{identity.kindLabel}</span>
          <span>{identity.updatedAtLabel}</span>
        </div>
      </div>
      <div className='flex shrink-0 flex-wrap items-center gap-2'>
        {rendererItems.map((item) => <DrivePreviewToolbarItemView key={item.id} item={item} />)}
        {showActionSeparator ? (
          <span
            aria-hidden='true'
            data-drive-preview-action-separator='true'
            className='h-6 border-l border-border'
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
              <Button type='button' variant='outline' size='icon' className='h-8 w-8' aria-label='更多操作'>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
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
      </div>
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
        <a href={action.href} target={action.external ? '_blank' : undefined} rel={action.external ? 'noreferrer' : undefined}>
          <action.icon data-icon='inline-start' />
          {action.label}
        </a>
      </Button>
    )
  }
  if (action.kind === 'versions') {
    return (
      <Button type='button' variant='outline' size='sm' onClick={() => onOpenVersions(action.itemId)}>
        <action.icon data-icon='inline-start' />
        {action.label}
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type='button' variant='outline' size='sm'>
          {action.label}
          <ChevronDown data-icon='inline-end' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {action.options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={option.id === selectedRendererId}
            onCheckedChange={() => onRendererChange(option.id)}
          >
            {option.label}
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
        <a href={action.href} target={action.external ? '_blank' : undefined} rel={action.external ? 'noreferrer' : undefined}>
          <action.icon data-icon='inline-start' />
          {action.label}
        </a>
      </DropdownMenuItem>
    )
  }
  if (action.kind === 'versions') {
    return (
      <DropdownMenuItem onSelect={() => onOpenVersions(action.itemId)}>
        <action.icon data-icon='inline-start' />
        {action.label}
      </DropdownMenuItem>
    )
  }
  return action.options.map((option) => (
    <DropdownMenuCheckboxItem
      key={option.id}
      checked={option.id === selectedRendererId}
      onCheckedChange={() => onRendererChange(option.id)}
    >
      {option.label}
    </DropdownMenuCheckboxItem>
  ))
}

export function DrivePreviewToolbarItemView({ item }: { readonly item: DriveRendererToolbarItem }) {
  if (item.kind === 'status') return <span className='text-xs text-muted-foreground'>{item.label}</span>
  if (item.kind === 'button') {
    const content = (
      <>
        {item.loading ? <Loader2 className='animate-spin' /> : item.icon ? <item.icon data-icon='inline-start' /> : null}
        {item.label}
      </>
    )
    if (item.href) {
      return (
        <Button asChild variant={item.variant ?? 'outline'} size='sm' disabled={item.disabled}>
          <a href={item.href} target={item.external ? '_blank' : undefined} rel={item.external ? 'noreferrer' : undefined}>
            {content}
          </a>
        </Button>
      )
    }
    return (
      <Button type='button' variant={item.variant ?? 'outline'} size='sm' disabled={item.disabled} onClick={item.onClick}>
        {content}
      </Button>
    )
  }
  if (item.kind === 'toggle') {
    return (
      <Button type='button' variant={item.pressed ? 'secondary' : 'ghost'} size='sm' disabled={item.disabled} onClick={() => item.onPressedChange(!item.pressed)}>
        {item.icon ? <item.icon data-icon='inline-start' /> : null}
        {item.label}
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type='button' variant='outline' size='sm'>
          {item.icon ? <item.icon data-icon='inline-start' /> : null}
          {item.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {item.items.map((menuItem) => (
          <DropdownMenuItem key={menuItem.id} disabled={menuItem.disabled} onSelect={menuItem.onSelect}>
            {menuItem.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
