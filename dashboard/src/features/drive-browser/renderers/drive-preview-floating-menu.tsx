import { Button, Dropdown, Label, Separator } from '@heroui/react'
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { Loader2, MoreHorizontal } from 'lucide-react'
import { RelativeTime } from '@/components/relative-time'
import { cn } from '@/lib/utils'
import { DriveBrowserItemIcon } from '../shared/drive-icons'
import { trackDriveEvent } from '../shared/drive-telemetry'
import {
  getDrivePreviewFileIdentity,
  getDrivePreviewSystemMenuSections,
} from './drive-preview-actions'
import { DriveRendererOptionMenuLabel } from './drive-preview-header'
import { copyDrivePreviewShareLink } from './drive-preview-share-clipboard'
import type {
  DriveRendererId,
  DriveRendererOption,
} from './drive-renderer-registry'
import type { DriveRendererToolbarItem } from './drive-renderer-toolbar-context'
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
  return (
    Math.hypot(current.left - start.left, current.top - start.top) >= threshold
  )
}
export function DrivePreviewFloatingMenu({
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
  const sections = getDrivePreviewSystemMenuSections(
    snapshot,
    selectedRendererId
  )
  const menuRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DriveFloatingMenuDragState | null>(null)
  const suppressClickRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] =
    useState<DriveFloatingMenuPoint | null>(null)
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
    const moved =
      drag.moved ||
      shouldSuppressDriveFloatingMenuOpen(drag.startPointer, currentPointer)
    if (!moved) return
    drag.moved = true
    const nextPosition = {
      left:
        drag.startPosition.left + currentPointer.left - drag.startPointer.left,
      top: drag.startPosition.top + currentPointer.top - drag.startPointer.top,
    }
    setMenuPosition(
      clampDriveFloatingMenuPosition(
        nextPosition,
        { width: window.innerWidth, height: window.innerHeight },
        getMenuSize()
      )
    )
  }
  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    event.preventDefault()
    suppressClickRef.current = true
    if (!drag.moved) {
      setOpen((current) => !current)
      return
    }
    trackDriveEvent({
      eventKey: 'web.drive.preview.menu-drag',
      component: 'drive-preview-menu',
      action: 'complete',
    })
  }
  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const handleClick = (
    event: Parameters<
      NonNullable<React.ComponentProps<typeof Button>['onClick']>
    >[0]
  ) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }
  return (
    <div
      ref={menuRef}
      className={cn(
        'fixed right-5 top-5 z-50',
        menuPosition && 'top-auto right-auto'
      )}
      style={menuStyle}
    >
      <Dropdown
        isOpen={open}
        onOpenChange={(nextOpen) => {
          if (!dragRef.current && !suppressClickRef.current) setOpen(nextOpen)
        }}
      >
        <Button
          data-drive-telemetry-event='web.drive.preview.menu'
          type='button'
          isIconOnly
          className={cn(
            'touch-none rounded-full cursor-grab transition-opacity duration-200 active:cursor-grabbing',
            idleDimmed && !open
              ? 'opacity-50 hover:opacity-100 focus-visible:opacity-100'
              : 'opacity-100'
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
        <Dropdown.Popover
          data-drive-telemetry-scope='portal'
          className='w-64'
        >
          <div className='px-3 py-2'>
            <Label className='flex min-w-0 items-center gap-2'>
              <DriveBrowserItemIcon item={snapshot.current} />
              <span className='min-w-0 truncate'>{identity.name}</span>
            </Label>
            <div className='px-2 pb-2 text-xs text-muted'>
              {identity.sizeLabel} / {identity.kindLabel} /{' '}
              <RelativeTime value={identity.updatedAt} />
            </div>
          </div>
          <Dropdown.Menu aria-label='操作'>
            {rendererItems.length > 0 ? <Separator /> : null}
            {rendererItems.map((item) => (
              <DrivePreviewFloatingRendererItem key={item.id} item={item} />
            ))}
            {sections.map((section, sectionIndex) => (
              <Fragment key={section.id}>
                {sectionIndex > 0 || rendererItems.length > 0 ? (
                  <Separator />
                ) : null}
                {section.items.map((action) => {
                  if (action.kind === 'link') {
                    return (
                      <Dropdown.Item
                        key={action.id}
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
                        key={action.id}
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
                        key={action.id}
                        onAction={() => onOpenVersions(action.itemId)}
                      >
                        <action.icon data-icon='inline-start' />
                        {action.label}
                      </Dropdown.Item>
                    )
                  }
                  return action.options.map((option) => (
                    <Dropdown.Section
                      key={option.id}
                      selectionMode='single'
                      selectedKeys={
                        option.id === selectedRendererId ? [option.id] : []
                      }
                    >
                      <Dropdown.Item
                        data-drive-telemetry-event='web.drive.renderer.select'
                        key={option.id}
                        isDisabled={Boolean(option.disabledReason)}
                        id={option.id}
                        onAction={() =>
                          (() => {
                            if (!option.disabledReason)
                              onRendererChange(option.id)
                          })()
                        }
                      >
                        <Dropdown.ItemIndicator />
                        <DriveRendererOptionMenuLabel option={option} />
                      </Dropdown.Item>
                    </Dropdown.Section>
                  ))
                })}
              </Fragment>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  )
}
function DrivePreviewFloatingRendererItem({
  item,
}: {
  readonly item: DriveRendererToolbarItem
}) {
  if (item.kind === 'status')
    return (
      <Dropdown.Item id={item.id} textValue={item.label} isDisabled>
        {item.label}
      </Dropdown.Item>
    )
  if (item.kind === 'button') {
    if (item.href) {
      return (
        <Dropdown.Item
          isDisabled={item.disabled}
          data-drive-telemetry-event='web.drive.renderer.action'
          href={item.href}
          target={item.external ? '_blank' : undefined}
          rel={item.external ? 'noreferrer' : undefined}
        >
          {item.loading ? (
            <Loader2 className='animate-spin' />
          ) : item.icon ? (
            <item.icon data-icon='inline-start' />
          ) : null}
          {item.label}
        </Dropdown.Item>
      )
    }
    return (
      <Dropdown.Item
        data-drive-telemetry-event='web.drive.renderer.action'
        isDisabled={item.disabled}
        onAction={item.onClick}
      >
        {item.loading ? (
          <Loader2 className='animate-spin' />
        ) : item.icon ? (
          <item.icon data-icon='inline-start' />
        ) : null}
        {item.label}
      </Dropdown.Item>
    )
  }
  if (item.kind === 'toggle') {
    return (
      <Dropdown.Section
        selectionMode='multiple'
        selectedKeys={item.pressed ? [item.id] : []}
      >
        <Dropdown.Item
          data-drive-telemetry-event='web.drive.renderer.action'
          isDisabled={item.disabled}
          id={item.id}
          onAction={() =>
            ((checked) => item.onPressedChange(Boolean(checked)))(!item.pressed)
          }
        >
          <Dropdown.ItemIndicator />
          {item.label}
        </Dropdown.Item>
      </Dropdown.Section>
    )
  }
  return (
    <>
      <Dropdown.Item id={item.id} textValue={item.label} isDisabled>
        {item.label}
      </Dropdown.Item>
      {item.items.map((menuItem) => (
        <Dropdown.Item
          data-drive-telemetry-event='web.drive.renderer.action'
          key={menuItem.id}
          isDisabled={menuItem.disabled}
          onAction={menuItem.onSelect}
        >
          {menuItem.label}
        </Dropdown.Item>
      ))}
    </>
  )
}
