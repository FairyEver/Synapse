import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type RefObject,
} from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const INLINE_TOOLBAR_GAP = 6
const INLINE_TOOLBAR_VIEWPORT_INSET = 8

type InlineToolbarRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>
type InlineToolbarSize = Pick<DOMRect, 'width' | 'height'>
type InlineToolbarPlacement = 'auto' | 'above' | 'below'

export type InlineToolbarAction = {
  readonly id: string
  readonly label: string
  readonly ariaLabel?: string
  readonly icon: ComponentType<{ readonly className?: string; readonly 'aria-hidden'?: boolean }>
  readonly disabled?: boolean
  readonly onSelect: () => void
}

type InlineToolbarProps = Omit<ComponentProps<'div'>, 'children' | 'style'> & {
  readonly anchor: Element | Range | null
  readonly actions: readonly InlineToolbarAction[]
  readonly containerRef?: RefObject<HTMLElement | null>
  readonly boundaryRef?: RefObject<HTMLElement | null>
  readonly placement?: InlineToolbarPlacement
  readonly boundaryInset?: number
}

type InlineToolbarPosition = {
  readonly top: number
  readonly left: number
}

export const InlineToolbar = memo(function InlineToolbar({
  anchor,
  actions,
  containerRef,
  boundaryRef,
  placement = 'auto',
  boundaryInset = containerRef ? 0 : INLINE_TOOLBAR_VIEWPORT_INSET,
  className,
  'aria-label': ariaLabel = '行内工具栏',
  ...props
}: InlineToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const [position, setPosition] = useState<InlineToolbarPosition | null>(null)

  const measure = useCallback(() => {
    const toolbar = toolbarRef.current
    const anchorRect = getInlineToolbarAnchorRect(anchor)
    if (!toolbar || !anchorRect) {
      setPosition((current) => current === null ? current : null)
      return
    }
    const toolbarRect = toolbar.getBoundingClientRect()
    if (toolbarRect.width <= 0 || toolbarRect.height <= 0) return
    const boundaryRect = getInlineToolbarBoundaryRect(anchor, boundaryRef?.current ?? null, boundaryInset)
    const containerRect = containerRef?.current?.getBoundingClientRect() ?? { top: 0, left: 0 }
    const next = resolveInlineToolbarPosition(
      anchorRect,
      boundaryRect,
      toolbarRect,
      containerRect,
      placement,
    )
    setPosition((current) => samePosition(current, next) ? current : next)
  }, [anchor, boundaryInset, boundaryRef, containerRef, placement])

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      measure()
    })
  }, [measure])

  useLayoutEffect(() => {
    measure()
  }, [actions, measure])

  useEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar) return
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure)
    observer?.observe(toolbar)
    if (anchor instanceof Element) observer?.observe(anchor)
    if (containerRef?.current) observer?.observe(containerRef.current)
    if (boundaryRef?.current) observer?.observe(boundaryRef.current)
    document.addEventListener('scroll', scheduleMeasure, true)
    window.addEventListener('resize', scheduleMeasure)
    return () => {
      observer?.disconnect()
      document.removeEventListener('scroll', scheduleMeasure, true)
      window.removeEventListener('resize', scheduleMeasure)
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    }
  }, [anchor, boundaryRef, containerRef, scheduleMeasure])

  return (
    <div
      ref={toolbarRef}
      role='toolbar'
      aria-label={ariaLabel}
      aria-hidden={position ? undefined : true}
      data-inline-toolbar='true'
      className={cn(
        'flex items-center gap-1',
        containerRef ? 'absolute z-30' : 'fixed z-50',
        !position && 'invisible pointer-events-none',
        className,
      )}
      style={position ?? { top: 0, left: 0 }}
      {...props}
    >
      {actions.map((action) => {
        const Icon = action.icon
        return (
          <Button
            key={action.id}
            type='button'
            size='sm'
            disabled={action.disabled}
            aria-label={action.ariaLabel}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              action.onSelect()
            }}
          >
            <Icon aria-hidden />
            {action.label}
          </Button>
        )
      })}
    </div>
  )
})

export function resolveInlineToolbarPosition(
  anchorRect: InlineToolbarRect,
  boundaryRect: InlineToolbarRect,
  toolbarSize: InlineToolbarSize,
  containerRect: Pick<DOMRect, 'top' | 'left'> = { top: 0, left: 0 },
  placement: InlineToolbarPlacement = 'auto',
  gap = INLINE_TOOLBAR_GAP,
): InlineToolbarPosition | null {
  const maxLeft = boundaryRect.right - toolbarSize.width
  if (maxLeft < boundaryRect.left) return null
  const viewportLeft = Math.min(
    Math.max(anchorRect.left + (anchorRect.right - anchorRect.left - toolbarSize.width) / 2, boundaryRect.left),
    maxLeft,
  )
  const aboveTop = anchorRect.top - gap - toolbarSize.height
  const belowTop = anchorRect.bottom + gap
  const canPlaceAbove = anchorRect.top >= boundaryRect.top && aboveTop >= boundaryRect.top
  const canPlaceBelow = anchorRect.bottom <= boundaryRect.bottom && belowTop + toolbarSize.height <= boundaryRect.bottom
  const viewportTop = placement === 'above'
    ? canPlaceAbove ? aboveTop : null
    : placement === 'below'
      ? canPlaceBelow ? belowTop : null
      : canPlaceAbove ? aboveTop : canPlaceBelow ? belowTop : null
  return viewportTop === null
    ? null
    : { top: viewportTop - containerRect.top, left: viewportLeft - containerRect.left }
}

function getInlineToolbarAnchorRect(anchor: Element | Range | null): DOMRect | null {
  if (!anchor) return null
  if (anchor instanceof Element) {
    const rect = anchor.getBoundingClientRect()
    return rect.width > 0 || rect.height > 0 ? rect : null
  }
  const rects = typeof anchor.getClientRects === 'function'
    ? Array.from(anchor.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0)
    : []
  const rect = rects[0] ?? anchor.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0 ? rect : null
}

function getInlineToolbarBoundaryRect(
  anchor: Element | Range | null,
  requiredBoundary: HTMLElement | null,
  inset: number,
): InlineToolbarRect {
  let boundary: InlineToolbarRect = {
    top: inset,
    right: window.innerWidth - inset,
    bottom: window.innerHeight - inset,
    left: inset,
  }
  let ancestor = getAnchorElement(anchor)?.parentElement ?? null
  while (ancestor) {
    const style = window.getComputedStyle(ancestor)
    const clips = ancestor === requiredBoundary || [style.overflowX, style.overflowY]
      .some((value) => value === 'auto' || value === 'scroll' || value === 'hidden' || value === 'clip')
    if (clips) boundary = intersectRects(boundary, ancestor.getBoundingClientRect())
    ancestor = ancestor.parentElement
  }
  return boundary
}

function getAnchorElement(anchor: Element | Range | null): Element | null {
  if (anchor instanceof Element) return anchor
  if (!anchor) return null
  return anchor.commonAncestorContainer instanceof Element
    ? anchor.commonAncestorContainer
    : anchor.commonAncestorContainer.parentElement
}

function intersectRects(left: InlineToolbarRect, right: InlineToolbarRect): InlineToolbarRect {
  return {
    top: Math.max(left.top, right.top),
    right: Math.min(left.right, right.right),
    bottom: Math.min(left.bottom, right.bottom),
    left: Math.max(left.left, right.left),
  }
}

function samePosition(left: InlineToolbarPosition | null, right: InlineToolbarPosition | null): boolean {
  return left === right || Boolean(left && right && left.top === right.top && left.left === right.left)
}
