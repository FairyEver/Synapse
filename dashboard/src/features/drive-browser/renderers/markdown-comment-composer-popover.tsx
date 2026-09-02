import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const COMMENT_COMPOSER_GAP = 8
const COMMENT_COMPOSER_VIEWPORT_INSET = 8

type CommentComposerRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>

export type CommentComposerPosition = {
  readonly top: number
  readonly left: number
}

export function MarkdownCommentComposerPopover({
  anchor,
  boundaryRef,
  value,
  submitting,
  error,
  onValueChange,
  onSubmit,
  onCancel,
}: {
  readonly anchor: Element | Range | null
  readonly boundaryRef: RefObject<HTMLElement | null>
  readonly value: string
  readonly submitting: boolean
  readonly error: string | null
  readonly onValueChange: (value: string) => void
  readonly onSubmit: () => void
  readonly onCancel: () => void
}) {
  const composerRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const hasFocusedRef = useRef(false)
  const [position, setPosition] = useState<CommentComposerPosition | null>(null)

  const measure = useCallback(() => {
    const composer = composerRef.current
    const anchorRect = getCommentComposerAnchorRect(anchor)
    if (!composer || !anchorRect) {
      setPosition((current) => current === null ? current : null)
      return
    }
    const composerRect = composer.getBoundingClientRect()
    if (composerRect.width <= 0 || composerRect.height <= 0) return
    const boundaryRect = getCommentComposerBoundaryRect(boundaryRef.current)
    const next = resolveCommentComposerPosition(anchorRect, boundaryRect, composerRect)
    setPosition((current) => samePosition(current, next) ? current : next)
  }, [anchor, boundaryRef])

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      measure()
    })
  }, [measure])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  useLayoutEffect(() => {
    if (!position || hasFocusedRef.current) return
    hasFocusedRef.current = true
    textareaRef.current?.focus({ preventScroll: true })
  }, [position])

  useEffect(() => {
    const composer = composerRef.current
    if (!composer) return
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure)
    observer?.observe(composer)
    if (anchor instanceof Element) observer?.observe(anchor)
    if (boundaryRef.current) observer?.observe(boundaryRef.current)
    document.addEventListener('scroll', scheduleMeasure, true)
    window.addEventListener('resize', scheduleMeasure)
    return () => {
      observer?.disconnect()
      document.removeEventListener('scroll', scheduleMeasure, true)
      window.removeEventListener('resize', scheduleMeasure)
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    }
  }, [anchor, boundaryRef, scheduleMeasure])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSubmit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  return createPortal(
    <div
      ref={composerRef}
      role='dialog'
      aria-label='添加评论'
      aria-hidden={position ? undefined : true}
      data-markdown-comment-composer-popover='true'
      data-markdown-comment-draft-composer='true'
      className={cn(
        'fixed z-50 w-72 rounded-lg border bg-popover p-3 text-popover-foreground',
        !position && 'invisible pointer-events-none',
      )}
      style={position ?? { top: 0, left: 0 }}
      onClick={(event) => event.stopPropagation()}
    >
      <Textarea
        ref={textareaRef}
        rows={3}
        value={value}
        aria-label='添加评论'
        placeholder='添加评论'
        disabled={submitting}
        className='min-h-20 resize-none'
        onChange={(event) => onValueChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      {error ? <div role='status' className='mt-2 text-sm text-destructive'>{error}</div> : null}
      <div className='mt-2 flex justify-end gap-1'>
        <Button type='button' variant='ghost' size='sm' disabled={submitting} onClick={onCancel}>取消</Button>
        <Button
          data-drive-telemetry-event='web.drive.comment.create'
          type='button'
          size='sm'
          disabled={!value.trim() || submitting}
          onClick={onSubmit}
        >
          {submitting ? '提交中' : '评论'}
        </Button>
      </div>
    </div>,
    document.body,
  )
}

export function resolveCommentComposerPosition(
  anchorRect: CommentComposerRect,
  boundaryRect: CommentComposerRect,
  composerSize: Pick<DOMRect, 'width' | 'height'>,
  gap = COMMENT_COMPOSER_GAP,
): CommentComposerPosition | null {
  const maxLeft = boundaryRect.right - composerSize.width
  const maxTop = boundaryRect.bottom - composerSize.height
  if (maxLeft < boundaryRect.left || maxTop < boundaryRect.top) return null

  const centeredTop = clamp(
    anchorRect.top + (anchorRect.height - composerSize.height) / 2,
    boundaryRect.top,
    maxTop,
  )
  const centeredLeft = clamp(
    anchorRect.left + (anchorRect.width - composerSize.width) / 2,
    boundaryRect.left,
    maxLeft,
  )
  const candidates = [
    {
      available: boundaryRect.right - anchorRect.right,
      required: composerSize.width + gap,
      position: { top: centeredTop, left: anchorRect.right + gap },
    },
    {
      available: anchorRect.left - boundaryRect.left,
      required: composerSize.width + gap,
      position: { top: centeredTop, left: anchorRect.left - gap - composerSize.width },
    },
    {
      available: boundaryRect.bottom - anchorRect.bottom,
      required: composerSize.height + gap,
      position: { top: anchorRect.bottom + gap, left: centeredLeft },
    },
    {
      available: anchorRect.top - boundaryRect.top,
      required: composerSize.height + gap,
      position: { top: anchorRect.top - gap - composerSize.height, left: centeredLeft },
    },
  ]
  const fitting = candidates.find((candidate) => candidate.available >= candidate.required)
  if (fitting) return fitting.position

  const fallback = candidates.reduce((best, candidate) => candidate.available > best.available ? candidate : best)
  return {
    top: clamp(fallback.position.top, boundaryRect.top, maxTop),
    left: clamp(fallback.position.left, boundaryRect.left, maxLeft),
  }
}

function getCommentComposerAnchorRect(anchor: Element | Range | null): CommentComposerRect | null {
  if (!anchor) return null
  const rect = anchor.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0 ? rect : null
}

function getCommentComposerBoundaryRect(boundary: HTMLElement | null): CommentComposerRect {
  const viewport = {
    top: COMMENT_COMPOSER_VIEWPORT_INSET,
    right: window.innerWidth - COMMENT_COMPOSER_VIEWPORT_INSET,
    bottom: window.innerHeight - COMMENT_COMPOSER_VIEWPORT_INSET,
    left: COMMENT_COMPOSER_VIEWPORT_INSET,
  }
  const boundaryRect = boundary?.getBoundingClientRect()
  const top = Math.max(viewport.top, boundaryRect?.top ?? viewport.top)
  const right = Math.min(viewport.right, boundaryRect?.right ?? viewport.right)
  const bottom = Math.min(viewport.bottom, boundaryRect?.bottom ?? viewport.bottom)
  const left = Math.max(viewport.left, boundaryRect?.left ?? viewport.left)
  return {
    top,
    right,
    bottom,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function samePosition(left: CommentComposerPosition | null, right: CommentComposerPosition | null): boolean {
  return left === right || Boolean(left && right && left.top === right.top && left.left === right.left)
}
