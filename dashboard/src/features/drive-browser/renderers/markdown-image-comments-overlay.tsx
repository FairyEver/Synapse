import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { DriveMarkdownProjectionImageDto } from '@synapse/shared'
import { MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'

const ACTION_HEIGHT = 32
const ACTION_WIDTH = 104
const ACTION_GAP = 6
const HOVER_CLOSE_DELAY = 120

type ImageElementPosition = {
  readonly imageId: string
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
  readonly action: { readonly top: number; readonly left: number } | null
}

export type MarkdownImageThreadMarker = {
  readonly imageId: string
  readonly threadIds: readonly string[]
}

export function MarkdownImageCommentsOverlay({
  contentKey,
  rootRef,
  containerRef,
  scrollRef,
  images,
  markers,
  activeImageId,
  canCreate,
  onAddComment,
  onFocusThreads,
}: {
  readonly contentKey: string
  readonly rootRef: RefObject<HTMLElement | null>
  readonly containerRef: RefObject<HTMLElement | null>
  readonly scrollRef: RefObject<HTMLElement | null>
  readonly images: readonly DriveMarkdownProjectionImageDto[]
  readonly markers: readonly MarkdownImageThreadMarker[]
  readonly activeImageId: string | null
  readonly canCreate: boolean
  readonly onAddComment: (image: DriveMarkdownProjectionImageDto) => void
  readonly onFocusThreads: (marker: MarkdownImageThreadMarker) => void
}) {
  const imageById = useMemo(() => new Map(images.map((image) => [image.imageId, image])), [images])
  const [hoveredImageId, setHoveredImageId] = useState<string | null>(null)
  const [positions, setPositions] = useState<readonly ImageElementPosition[]>([])
  const closeTimerRef = useRef<number | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current === null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])
  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setHoveredImageId(null)
    }, HOVER_CLOSE_DELAY)
  }, [cancelClose])

  useEffect(() => {
    const root = rootRef.current
    const container = containerRef.current
    if (!root || !container || images.length === 0) {
      setPositions((current) => current.length === 0 ? current : [])
      return
    }
    let frame: number | null = null
    const measure = () => {
      frame = null
      const currentRoot = rootRef.current
      const currentContainer = containerRef.current
      if (!currentRoot || !currentContainer) return
      const containerRect = currentContainer.getBoundingClientRect()
      const next = images.flatMap((image): ImageElementPosition[] => {
        const element = findVisibleMarkdownImageElement(currentRoot, image.imageId)
        if (!element) return []
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return []
        const clip = findImageClipRect(element, scrollRef.current)
        return [{
          imageId: image.imageId,
          top: rect.top - containerRect.top,
          left: rect.left - containerRect.left,
          width: rect.width,
          height: rect.height,
          action: resolveMarkdownImageCommentActionPlacement(rect, clip, containerRect),
        }]
      })
      setPositions((current) => samePositions(current, next) ? current : next)
    }
    const scheduleMeasure = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(measure)
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure)
    observer?.observe(root)
    observer?.observe(container)
    root.addEventListener('load', scheduleMeasure, true)
    root.addEventListener('scroll', scheduleMeasure, true)
    scrollRef.current?.addEventListener('scroll', scheduleMeasure, { passive: true })
    window.addEventListener('resize', scheduleMeasure)
    measure()
    return () => {
      observer?.disconnect()
      root.removeEventListener('load', scheduleMeasure, true)
      root.removeEventListener('scroll', scheduleMeasure, true)
      scrollRef.current?.removeEventListener('scroll', scheduleMeasure)
      window.removeEventListener('resize', scheduleMeasure)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [containerRef, contentKey, images, rootRef, scrollRef])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || images.length === 0) return
    const activateFromTarget = (target: EventTarget | null) => {
      const element = target instanceof Element ? target.closest<HTMLElement>('[data-drive-markdown-image-id]') : null
      if (!element || !root.contains(element) || element.hidden) return
      const imageId = element.dataset.driveMarkdownImageId
      if (!imageId || !imageById.has(imageId)) return
      cancelClose()
      setHoveredImageId(imageId)
    }
    const onPointerOver = (event: PointerEvent) => activateFromTarget(event.target)
    const onPointerOut = (event: PointerEvent) => {
      const from = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-drive-markdown-image-id]')
        : null
      if (!from) return
      const to = event.relatedTarget instanceof Element
        ? event.relatedTarget.closest<HTMLElement>('[data-drive-markdown-image-id]')
        : null
      if (to?.dataset.driveMarkdownImageId === from.dataset.driveMarkdownImageId) return
      scheduleClose()
    }
    const onFocusIn = (event: FocusEvent) => activateFromTarget(event.target)
    const onFocusOut = (event: FocusEvent) => {
      const from = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-drive-markdown-image-id]')
        : null
      if (!from) return
      const to = event.relatedTarget instanceof Element
        ? event.relatedTarget.closest<HTMLElement>('[data-drive-markdown-image-id]')
        : null
      if (to?.dataset.driveMarkdownImageId === from.dataset.driveMarkdownImageId) return
      scheduleClose()
    }
    root.addEventListener('pointerover', onPointerOver)
    root.addEventListener('pointerout', onPointerOut)
    root.addEventListener('focusin', onFocusIn)
    root.addEventListener('focusout', onFocusOut)
    return () => {
      root.removeEventListener('pointerover', onPointerOver)
      root.removeEventListener('pointerout', onPointerOut)
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('focusout', onFocusOut)
      cancelClose()
    }
  }, [cancelClose, imageById, images.length, rootRef, scheduleClose])

  const positionById = useMemo(() => new Map(positions.map((position) => [position.imageId, position])), [positions])
  const hoveredImage = hoveredImageId ? imageById.get(hoveredImageId) ?? null : null
  const hoveredPosition = hoveredImageId ? positionById.get(hoveredImageId) ?? null : null
  const activePosition = activeImageId ? positionById.get(activeImageId) ?? null : null

  return (
    <>
      {activePosition ? (
        <div
          aria-hidden
          data-drive-markdown-image-active='true'
          className='pointer-events-none absolute z-10 ring-2 ring-ring ring-offset-2 ring-offset-background'
          style={{ top: activePosition.top, left: activePosition.left, width: activePosition.width, height: activePosition.height }}
        />
      ) : null}
      {markers.map((marker) => {
        const position = positionById.get(marker.imageId)
        if (!position) return null
        return (
          <Button
            key={marker.imageId}
            type='button'
            variant='secondary'
            size='sm'
            data-drive-markdown-image-comment-count={marker.threadIds.length}
            className='absolute z-20 h-7 min-w-7 rounded-full px-2'
            style={{ top: position.top + 6, left: position.left + position.width - 30 }}
            aria-label={`${marker.threadIds.length} 条图片评论`}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              onFocusThreads(marker)
            }}
          >
            {marker.threadIds.length}
          </Button>
        )
      })}
      {canCreate && hoveredImage && hoveredPosition?.action ? (
        <div
          data-drive-markdown-image-comment-action='true'
          className='absolute z-30'
          style={hoveredPosition.action}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
          onFocus={cancelClose}
          onBlur={scheduleClose}
        >
          <Button
            type='button'
            size='sm'
            className='h-8 w-26'
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              onAddComment(hoveredImage)
            }}
          >
            <MessageSquarePlus />
            添加评论
          </Button>
        </div>
      ) : null}
    </>
  )
}

export function resolveMarkdownImageCommentActionPlacement(
  imageRect: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width'>,
  clipRect: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>,
  containerRect: Pick<DOMRect, 'top' | 'left'>,
): { readonly top: number; readonly left: number } | null {
  const horizontalLeft = Math.max(clipRect.left, Math.min(
    imageRect.left + imageRect.width / 2 - ACTION_WIDTH / 2,
    clipRect.right - ACTION_WIDTH,
  ))
  if (horizontalLeft < clipRect.left || horizontalLeft + ACTION_WIDTH > clipRect.right) return null
  const topEdgeVisible = imageRect.top >= clipRect.top && imageRect.top <= clipRect.bottom
  const bottomEdgeVisible = imageRect.bottom >= clipRect.top && imageRect.bottom <= clipRect.bottom
  if (topEdgeVisible && imageRect.top - ACTION_GAP - ACTION_HEIGHT >= clipRect.top) {
    return { top: imageRect.top - containerRect.top - ACTION_GAP - ACTION_HEIGHT, left: horizontalLeft - containerRect.left }
  }
  if (bottomEdgeVisible && imageRect.bottom + ACTION_GAP + ACTION_HEIGHT <= clipRect.bottom) {
    return { top: imageRect.bottom - containerRect.top + ACTION_GAP, left: horizontalLeft - containerRect.left }
  }
  return null
}

function findVisibleMarkdownImageElement(root: HTMLElement, imageId: string): HTMLElement | null {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-drive-markdown-image-id]'))
    .filter((element) => element.dataset.driveMarkdownImageId === imageId && !element.hidden)
  return candidates.find((element) => element.hasAttribute('data-drive-markdown-image-fallback-host'))
    ?? candidates.find((element) => element.tagName === 'IMG')
    ?? null
}

type ImageClipRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>

function findImageClipRect(element: HTMLElement, requiredScroller: HTMLElement | null): ImageClipRect {
  let clip: ImageClipRect = { top: 0, right: window.innerWidth, bottom: window.innerHeight, left: 0 }
  let ancestor: HTMLElement | null = element.parentElement
  while (ancestor) {
    const style = window.getComputedStyle(ancestor)
    const clips = ancestor === requiredScroller || [style.overflowX, style.overflowY]
      .some((value) => value === 'auto' || value === 'scroll' || value === 'hidden' || value === 'clip')
    if (clips) clip = intersectRects(clip, ancestor.getBoundingClientRect())
    ancestor = ancestor.parentElement
  }
  return clip
}

function intersectRects(left: ImageClipRect, right: ImageClipRect): ImageClipRect {
  const rightEdge = Math.min(left.right, right.right)
  const bottomEdge = Math.min(left.bottom, right.bottom)
  return {
    top: Math.max(left.top, right.top),
    right: rightEdge,
    bottom: bottomEdge,
    left: Math.max(left.left, right.left),
  }
}

function samePositions(left: readonly ImageElementPosition[], right: readonly ImageElementPosition[]): boolean {
  return left.length === right.length && left.every((value, index) => {
    const candidate = right[index]
    return Boolean(candidate
      && value.imageId === candidate.imageId
      && value.top === candidate.top
      && value.left === candidate.left
      && value.width === candidate.width
      && value.height === candidate.height
      && value.action?.top === candidate.action?.top
      && value.action?.left === candidate.action?.left)
  })
}
