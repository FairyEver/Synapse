import type { LucideIcon } from 'lucide-react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

type FilePreviewToolbarItemBase = {
  readonly id: string
  readonly label: string
  readonly compactPlacement?: 'primary' | 'overflow'
}

export type FilePreviewToolbarItem =
  & FilePreviewToolbarItemBase
  & (
    | {
        readonly kind: 'status'
      }
    | {
        readonly kind: 'button'
        readonly icon?: LucideIcon
        readonly variant?: 'default' | 'outline' | 'secondary' | 'ghost'
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
}: {
  readonly item: FilePreviewToolbarItem
  readonly compact?: boolean
  readonly defaultButtonVariant?: 'default' | 'outline' | 'ghost'
}) {
  if (item.kind === 'status') {
    return <span className='inline-flex h-8 items-center px-1 text-xs text-muted-foreground tabular-nums'>{item.label}</span>
  }
  const buttonClassName = cn(
    'shadow-none tabular-nums has-[>svg]:pl-2 has-[>svg]:pr-2.5',
    compact ? 'min-h-11' : "relative after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']"
  )
  if (item.kind === 'button') {
    const content = (
      <>
        {item.loading ? <Loader2 className='animate-spin' /> : item.icon ? <item.icon data-icon='inline-start' /> : null}
        {item.label}
      </>
    )
    const variant = compact && item.compactPlacement === 'primary'
      ? item.variant ?? 'default'
      : item.variant ?? defaultButtonVariant
    if (item.href) {
      return (
        <Button
          asChild
          variant={variant}
          size='sm'
          disabled={item.disabled}
          aria-keyshortcuts={item.ariaKeyShortcuts}
          className={buttonClassName}
        >
          <a href={item.href} target={item.external ? '_blank' : undefined} rel={item.external ? 'noreferrer' : undefined}>
            {content}
          </a>
        </Button>
      )
    }
    return (
      <Button
        type='button'
        variant={variant}
        size='sm'
        disabled={item.disabled || item.loading}
        aria-keyshortcuts={item.ariaKeyShortcuts}
        className={buttonClassName}
        onClick={item.onClick}
      >
        {content}
      </Button>
    )
  }
  if (item.kind === 'toggle') {
    return (
      <Button
        type='button'
        variant={item.pressed ? 'secondary' : 'ghost'}
        size='sm'
        disabled={item.disabled}
        aria-pressed={item.pressed}
        className={buttonClassName}
        onClick={() => item.onPressedChange(!item.pressed)}
      >
        {item.icon ? <item.icon data-icon='inline-start' /> : null}
        {item.label}
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          variant={item.variant ?? 'outline'}
          size='sm'
          className={cn(buttonClassName, 'has-[>svg]:pl-2.5 has-[>svg]:pr-2')}
        >
          {item.icon ? <item.icon data-icon='inline-start' /> : null}
          {item.label}
          <ChevronDown data-icon='inline-end' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <FilePreviewToolbarMenuOptions item={item} />
      </DropdownMenuContent>
    </DropdownMenu>
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
        <DropdownMenuLabel key={item.id} className='font-normal text-muted-foreground'>
          {item.label}
        </DropdownMenuLabel>
      )
    }
    if (item.kind === 'button') {
      const content = (
        <>
          {item.loading ? <Loader2 className='animate-spin' /> : item.icon ? <item.icon data-icon='inline-start' /> : null}
          {item.label}
        </>
      )
      if (item.href) {
        return (
          <DropdownMenuItem key={item.id} asChild disabled={item.disabled} aria-keyshortcuts={item.ariaKeyShortcuts}>
            <a href={item.href} target={item.external ? '_blank' : undefined} rel={item.external ? 'noreferrer' : undefined}>
              {content}
            </a>
          </DropdownMenuItem>
        )
      }
      return (
        <DropdownMenuItem
          key={item.id}
          disabled={item.disabled || item.loading}
          aria-keyshortcuts={item.ariaKeyShortcuts}
          onSelect={item.onClick}
        >
          {content}
        </DropdownMenuItem>
      )
    }
    if (item.kind === 'toggle') {
      return (
        <DropdownMenuCheckboxItem
          key={item.id}
          checked={item.pressed}
          disabled={item.disabled}
          onCheckedChange={(checked) => item.onPressedChange(Boolean(checked))}
        >
          {item.icon ? <item.icon data-icon='inline-start' /> : null}
          {item.label}
        </DropdownMenuCheckboxItem>
      )
    }
    return (
      <div key={item.id}>
        <DropdownMenuLabel className='flex items-center gap-2 text-muted-foreground'>
          {item.icon ? <item.icon className='size-4' /> : null}
          {item.label}
        </DropdownMenuLabel>
        <FilePreviewToolbarMenuOptions item={item} />
      </div>
    )
  })
}

function FilePreviewToolbarMenuOptions({
  item,
}: {
  readonly item: Extract<FilePreviewToolbarItem, { readonly kind: 'menu' }>
}) {
  if (item.selectedItemId) {
    return (
      <DropdownMenuRadioGroup
        value={item.selectedItemId}
        onValueChange={(itemId) => item.items.find((option) => option.id === itemId)?.onSelect()}
      >
        {item.items.map((option) => (
          <DropdownMenuRadioItem key={option.id} value={option.id} disabled={option.disabled}>
            {option.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    )
  }
  return item.items.map((option) => (
    <DropdownMenuItem key={option.id} disabled={option.disabled} onSelect={option.onSelect}>
      {option.label}
    </DropdownMenuItem>
  ))
}

export function getCompactPrimaryToolbarItems(
  items: readonly FilePreviewToolbarItem[],
): readonly FilePreviewToolbarItem[] {
  return items.filter((item) => item.kind !== 'status' && item.compactPlacement === 'primary')
}

export function getCompactOverflowToolbarItems(
  items: readonly FilePreviewToolbarItem[],
): readonly FilePreviewToolbarItem[] {
  return items.filter((item) => item.kind === 'status' || item.compactPlacement !== 'primary')
}
