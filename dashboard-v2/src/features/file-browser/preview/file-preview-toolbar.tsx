import { Button, Dropdown, Link, ToggleButton } from '@heroui/react'
import { Fragment } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
type FilePreviewToolbarItemBase = {
  readonly id: string
  readonly label: string
  readonly compactPlacement?: 'primary' | 'overflow'
  readonly group?: string
}
export type FilePreviewToolbarItem = FilePreviewToolbarItemBase &
  (
    | {
        readonly kind: 'status'
      }
    | {
        readonly kind: 'button'
        readonly icon?: LucideIcon
        readonly variant?: 'primary' | 'outline' | 'secondary' | 'ghost'
        readonly ariaKeyShortcuts?: string
        readonly disabled?: boolean
        readonly loading?: boolean
        readonly href?: string
        readonly external?: boolean
        readonly onClick?: () => void
      }
    | {
        readonly kind: 'toggle'
        readonly icon?: LucideIcon
        readonly pressed: boolean
        readonly disabled?: boolean
        readonly onPressedChange: (pressed: boolean) => void
      }
    | {
        readonly kind: 'menu'
        readonly icon?: LucideIcon
        readonly variant?: 'outline' | 'ghost'
        readonly selectedItemId?: string
        readonly items: readonly FilePreviewToolbarMenuItem[]
      }
  )
export type FilePreviewToolbarMenuItem = {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
  readonly onSelect: () => void
}
export function FilePreviewToolbarItemView({
  item,
  compact = false,
  defaultButtonVariant = 'outline',
  showIcons = true,
}: {
  readonly item: FilePreviewToolbarItem
  readonly compact?: boolean
  readonly defaultButtonVariant?: 'primary' | 'outline' | 'ghost'
  readonly showIcons?: boolean
}) {
  if (item.kind === 'status') {
    return (
      <span className='inline-flex h-8 items-center px-1 text-xs text-muted tabular-nums'>
        {item.label}
      </span>
    )
  }
  const buttonClassName = cn('tabular-nums', compact && 'min-h-11')
  if (item.kind === 'button') {
    const content = (
      <>
        {item.loading ? (
          <Loader2 className='animate-spin' />
        ) : showIcons && item.icon ? (
          <item.icon data-icon='inline-start' />
        ) : null}
        {item.label}
      </>
    )
    const variant =
      compact && item.compactPlacement === 'primary'
        ? (item.variant ?? 'primary')
        : (item.variant ?? defaultButtonVariant)
    if (item.href) {
      return (
        <Link
          isDisabled={item.disabled}
          aria-keyshortcuts={item.ariaKeyShortcuts}
          className={cn('gap-1', buttonClassName)}
          href={item.href}
          target={item.external ? '_blank' : undefined}
          rel={item.external ? 'noreferrer' : undefined}
        >
          {item.loading ? (<Link.Icon><Loader2 className='size-full animate-spin' /></Link.Icon>)
            : showIcons && item.icon ? (<Link.Icon><item.icon className='size-full' /></Link.Icon>) : null}
          {item.label}
        </Link>
      )
    }
    return (
      <Button
        render={(props) => (
          <button {...props} aria-keyshortcuts={item.ariaKeyShortcuts} />
        )}
        type='button'
        variant={variant}
        size='sm'
        isDisabled={item.disabled || item.loading}
        aria-keyshortcuts={item.ariaKeyShortcuts}
        className={buttonClassName}
        onPress={item.onClick}
      >
        {content}
      </Button>
    )
  }
  if (item.kind === 'toggle') {
    return (
      <ToggleButton
        variant='ghost'
        size='sm'
        isDisabled={item.disabled}
        isSelected={item.pressed}
        className={buttonClassName}
        onChange={item.onPressedChange}
      >
        {showIcons && item.icon ? <item.icon data-icon='inline-start' /> : null}
        {item.label}
      </ToggleButton>
    )
  }
  return (
    <Dropdown>
      <Button
        type='button'
        variant={item.variant ?? 'outline'}
        size='sm'
        className={buttonClassName}
      >
        {showIcons && item.icon ? <item.icon data-icon='inline-start' /> : null}
        {item.label}
        {showIcons ? <ChevronDown data-icon='inline-end' /> : null}
      </Button>
      <Dropdown.Popover isNonModal>
        <Dropdown.Menu aria-label='操作'>
          <FilePreviewToolbarMenuOptions item={item} />
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}
export function FilePreviewToolbarMenuItems({
  items,
}: {
  readonly items: readonly FilePreviewToolbarItem[]
}) {
  return items.map((item) => {
    if (item.kind === 'status') {
      return (
        <Dropdown.Item
          key={item.id}
          id={item.id}
          textValue={item.label}
          isDisabled
        >
          {item.label}
        </Dropdown.Item>
      )
    }
    if (item.kind === 'button') {
      const content = (
        <>
          {item.loading ? (
            <Loader2 className='animate-spin' />
          ) : item.icon ? (
            <item.icon data-icon='inline-start' />
          ) : null}
          {item.label}
        </>
      )
      if (item.href) {
        return (
          <Dropdown.Item
            key={item.id}
            isDisabled={item.disabled}
            aria-keyshortcuts={item.ariaKeyShortcuts}
            href={item.href}
            target={item.external ? '_blank' : undefined}
            rel={item.external ? 'noreferrer' : undefined}
          >
            {content}
          </Dropdown.Item>
        )
      }
      return (
        <Dropdown.Item
          key={item.id}
          isDisabled={item.disabled || item.loading}
          aria-keyshortcuts={item.ariaKeyShortcuts}
          onAction={item.onClick}
        >
          {content}
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
            key={item.id}
            isDisabled={item.disabled}
            id={item.id}
            onAction={() =>
              ((checked) => item.onPressedChange(Boolean(checked)))(
                !item.pressed
              )
            }
          >
            <Dropdown.ItemIndicator />
            {item.icon ? <item.icon data-icon='inline-start' /> : null}
            {item.label}
          </Dropdown.Item>
        </Dropdown.Section>
      )
    }
    return (
      <Fragment key={item.id}>
        <Dropdown.Item
          id={`${item.id}-label`}
          textValue={item.label}
          isDisabled
        >
          {item.icon ? <item.icon className='size-4' /> : null}
          {item.label}
        </Dropdown.Item>
        <FilePreviewToolbarMenuOptions item={item} />
      </Fragment>
    )
  })
}
function FilePreviewToolbarMenuOptions({
  item,
}: {
  readonly item: Extract<
    FilePreviewToolbarItem,
    {
      readonly kind: 'menu'
    }
  >
}) {
  if (item.selectedItemId) {
    return (
      <Dropdown.Section
        selectionMode='single'
        selectedKeys={[item.selectedItemId]}
        onSelectionChange={(keys) =>
          ((itemId) =>
            item.items.find((option) => option.id === itemId)?.onSelect())(
            String(Array.from(keys)[0])
          )
        }
      >
        {item.items.map((option) => (
          <Dropdown.Item
            key={option.id}
            id={option.id}
            isDisabled={option.disabled}
          >
            <Dropdown.ItemIndicator type='dot' />
            {option.label}
          </Dropdown.Item>
        ))}
      </Dropdown.Section>
    )
  }
  return item.items.map((option) => (
    <Dropdown.Item
      key={option.id}
      isDisabled={option.disabled}
      onAction={option.onSelect}
    >
      {option.label}
    </Dropdown.Item>
  ))
}
export function getCompactPrimaryToolbarItems(
  items: readonly FilePreviewToolbarItem[]
): readonly FilePreviewToolbarItem[] {
  return items.filter(
    (item) => item.kind !== 'status' && item.compactPlacement === 'primary'
  )
}
export function getCompactOverflowToolbarItems(
  items: readonly FilePreviewToolbarItem[]
): readonly FilePreviewToolbarItem[] {
  return items.filter(
    (item) => item.kind === 'status' || item.compactPlacement !== 'primary'
  )
}
