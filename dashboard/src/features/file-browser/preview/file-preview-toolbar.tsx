import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
  readonly defaultButtonVariant?: 'default' | 'outline'
}) {
  if (item.kind === 'status') return <span className='text-xs text-muted-foreground'>{item.label}</span>
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
          className={cn(compact && 'min-h-11')}
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
        className={cn(compact && 'min-h-11')}
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
        className={cn(compact && 'min-h-11')}
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
          variant='outline'
          size='sm'
          className={cn(compact && 'min-h-11')}
        >
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
          <DropdownMenuItem key={item.id} asChild disabled={item.disabled}>
            <a href={item.href} target={item.external ? '_blank' : undefined} rel={item.external ? 'noreferrer' : undefined}>
              {content}
            </a>
          </DropdownMenuItem>
        )
      }
      return (
        <DropdownMenuItem key={item.id} disabled={item.disabled || item.loading} onSelect={item.onClick}>
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
        {item.items.map((menuItem) => (
          <DropdownMenuItem key={menuItem.id} disabled={menuItem.disabled} onSelect={menuItem.onSelect}>
            {menuItem.label}
          </DropdownMenuItem>
        ))}
      </div>
    )
  })
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
