import type { DriveMarkdownOutlineItemDto } from '@synapse/shared'
import { cn } from '@/lib/utils'

export const DRIVE_DOCUMENT_OUTLINE_PANEL_DEFAULT_SIZE = 16
export const DRIVE_DOCUMENT_OUTLINE_PANEL_MIN_SIZE = 12
export const DRIVE_DOCUMENT_OUTLINE_PANEL_MAX_SIZE = 22

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
}: {
  readonly items: readonly DriveMarkdownOutlineItemDto[]
  readonly compact?: boolean
  readonly activeItemId?: string | null
  readonly onSelect?: (itemId: string) => void
}) {
  return (
    <ul className='space-y-1'>
      {items.map((item) => (
        <DriveDocumentOutlineNode
          key={item.id}
          item={item}
          compact={compact}
          activeItemId={activeItemId}
          onSelect={onSelect}
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
}: {
  readonly item: DriveMarkdownOutlineItemDto
  readonly compact: boolean
  readonly activeItemId?: string | null
  readonly onSelect?: (itemId: string) => void
}) {
  const active = item.id === activeItemId
  return (
    <li>
      <a
        className={cn(
          'truncate rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          compact ? 'flex min-h-11 items-center py-2 text-sm' : 'block py-1 text-xs',
          active && 'bg-muted font-medium text-foreground',
          outlineDepthClassName(item.depth),
        )}
        data-markdown-outline-id={item.id}
        href={`#${item.id}`}
        aria-current={active ? 'location' : undefined}
        onClick={(event) => {
          if (!onSelect) return
          event.preventDefault()
          onSelect(item.id)
        }}
      >
        {item.text}
      </a>
      {item.children.length > 0 ? (
        <DriveDocumentOutlineTree
          items={item.children}
          compact={compact}
          activeItemId={activeItemId}
          onSelect={onSelect}
        />
      ) : null}
    </li>
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
