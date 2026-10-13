import { useCallback, useState } from 'react'
import type { DriveMarkdownOutlineItemDto } from '@synapse/shared'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

export const DRIVE_DOCUMENT_OUTLINE_PANEL_DEFAULT_SIZE = 16
export const DRIVE_DOCUMENT_OUTLINE_PANEL_MIN_SIZE = 12
export const DRIVE_DOCUMENT_OUTLINE_PANEL_MAX_SIZE = 22

type DriveDocumentOutlineTreeProps = {
  readonly items: readonly DriveMarkdownOutlineItemDto[]
  readonly compact?: boolean
  readonly activeItemId?: string | null
  readonly onSelect?: (itemId: string) => void
}

type DriveDocumentOutlineListProps = DriveDocumentOutlineTreeProps & {
  readonly compact: boolean
  readonly collapsedItemIds: ReadonlySet<string>
  readonly onOpenChange: (itemId: string, open: boolean) => void
}

export function flattenDriveDocumentOutline(
  items: readonly DriveMarkdownOutlineItemDto[],
): DriveMarkdownOutlineItemDto[] {
  return items.flatMap((item) => [item, ...flattenDriveDocumentOutline(item.children)])
}

export function DriveDocumentOutlineTree({
  items,
  compact = false,
  activeItemId,
  onSelect,
}: DriveDocumentOutlineTreeProps) {
  const [collapsedItemIds, setCollapsedItemIds] = useState<ReadonlySet<string>>(() => new Set())
  const onOpenChange = useCallback((itemId: string, open: boolean) => {
    setCollapsedItemIds((current) => {
      const next = new Set(current)
      if (open) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }, [])

  return (
    <DriveDocumentOutlineList
      items={items}
      compact={compact}
      activeItemId={activeItemId}
      onSelect={onSelect}
      collapsedItemIds={collapsedItemIds}
      onOpenChange={onOpenChange}
    />
  )
}

function DriveDocumentOutlineList({ items, ...props }: DriveDocumentOutlineListProps) {
  return (
    <ul className='flex flex-col gap-1'>
      {items.map((item) => (
        <DriveDocumentOutlineNode
          key={item.id}
          item={item}
          {...props}
        />
      ))}
    </ul>
  )
}

function DriveDocumentOutlineNode({
  item,
  compact,
  activeItemId,
  onSelect,
  collapsedItemIds,
  onOpenChange,
}: Omit<DriveDocumentOutlineListProps, 'items'> & {
  readonly item: DriveMarkdownOutlineItemDto
}) {
  const active = item.id === activeItemId
  const hasChildren = item.children.length > 0
  const open = !collapsedItemIds.has(item.id)
  const toggleSizeClassName = compact ? 'size-11' : 'size-6'

  return (
    <Collapsible asChild open={open} onOpenChange={(nextOpen) => onOpenChange(item.id, nextOpen)}>
      <li>
        <div
          data-markdown-outline-row
          className={cn('flex items-center gap-1 rounded-sm', outlineDepthClassName(item.depth), active && 'bg-muted')}
        >
          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className={toggleSizeClassName}
                aria-label={`${open ? '折叠' : '展开'} ${item.text}`}
              >
                {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
              </Button>
            </CollapsibleTrigger>
          ) : <span aria-hidden className={cn('shrink-0', toggleSizeClassName)} />}
          <a
            className={cn(
              'flex min-w-0 flex-1 items-center self-stretch rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              compact ? 'min-h-11 py-2 text-sm' : 'py-1 text-xs',
              active && 'font-medium text-foreground',
            )}
            data-markdown-outline-id={item.id}
            href={`#${item.id}`}
            title={item.text}
            aria-current={active ? 'location' : undefined}
            onClick={(event) => {
              if (!onSelect) return
              event.preventDefault()
              onSelect(item.id)
            }}
          >
            <span className='truncate'>{item.text}</span>
          </a>
        </div>
        {hasChildren ? (
          <CollapsibleContent className='mt-1'>
            <DriveDocumentOutlineList
              items={item.children}
              compact={compact}
              activeItemId={activeItemId}
              onSelect={onSelect}
              collapsedItemIds={collapsedItemIds}
              onOpenChange={onOpenChange}
            />
          </CollapsibleContent>
        ) : null}
      </li>
    </Collapsible>
  )
}

function outlineDepthClassName(depth: number): string {
  if (depth <= 1) return 'pl-0'
  if (depth === 2) return 'pl-3'
  if (depth === 3) return 'pl-6'
  if (depth === 4) return 'pl-9'
  if (depth === 5) return 'pl-12'
  return 'pl-14'
}
