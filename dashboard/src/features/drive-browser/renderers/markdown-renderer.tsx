import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type {
  DriveAnnotationTextRangeTargetV1,
  DriveBrowserItemDto,
  DriveBrowserPreviewDto,
  DriveMarkdownOutlineItemDto,
} from '@synapse/shared'
import { ListTree, MessageSquare, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import type { DriveAnnotationContext } from '../use-drive-annotations'
import { useDriveAnnotations } from '../use-drive-annotations'
import { DriveCodeRenderer } from './code-renderer'
import { renderMarkdownAnnotationHtml, resolveMarkdownAnnotationTextRange } from './markdown-annotation-render'
import { createMarkdownAnnotationTargetFromSelection, getMarkdownRenderedText } from './markdown-annotation-target'
import { MarkdownCommentsRail, type MarkdownCommentsRailThread } from './markdown-comments-rail'
import { useRegisterDriveRendererToolbarItems, type DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

const MARKDOWN_BODY_CLASSNAME = 'max-w-full space-y-3 text-base leading-7 [&_a]:underline [&_blockquote]:border-l [&_blockquote]:pl-3 [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_h1]:scroll-mt-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:scroll-mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:scroll-mt-6 [&_h3]:font-medium [&_h4]:scroll-mt-6 [&_h5]:scroll-mt-6 [&_h6]:scroll-mt-6 [&_hr]:border-border [&_li]:ml-4 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_ul]:list-disc'

type SelectionPopoverPosition = {
  readonly top: number
  readonly left: number
}

type MarkdownAnnotationOverlayRect = {
  readonly key: string
  readonly kind: 'thread' | 'pending'
  readonly threadId: string | null
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

export function DriveMarkdownRenderer({
  current,
  preview,
  annotationContext,
}: {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly annotationContext?: DriveAnnotationContext
}) {
  const renderedHtml = preview.html?.trim()
  if (!renderedHtml) return <DriveCodeRenderer current={current} preview={preview} />
  const outline = preview.outline ?? []
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const commentsTouchedRef = useRef(false)
  const isAuthenticated = useAuthStore((state) => state.auth.isAuthenticated)
  const annotationsEnabled = current.name.toLowerCase().endsWith('.md')
  const effectiveAnnotationContext = annotationsEnabled ? annotationContext : undefined
  const annotations = useDriveAnnotations(effectiveAnnotationContext)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [pendingTarget, setPendingTarget] = useState<DriveAnnotationTextRangeTargetV1 | null>(null)
  const [selectionPopover, setSelectionPopover] = useState<SelectionPopoverPosition | null>(null)
  const [commentDialogOpen, setCommentDialogOpen] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [threadAnchorTopById, setThreadAnchorTopById] = useState<Record<string, number>>({})
  const [annotationOverlayRects, setAnnotationOverlayRects] = useState<readonly MarkdownAnnotationOverlayRect[]>([])
  const annotated = useMemo(
    () => renderMarkdownAnnotationHtml(renderedHtml, annotations.threads),
    [annotations.threads, renderedHtml]
  )
  const canWriteAnnotations = effectiveAnnotationContext?.context === 'owner' || Boolean(effectiveAnnotationContext?.canWrite)
  const canCreateAnnotation = annotationsEnabled
    && Boolean(effectiveAnnotationContext)
    && canWriteAnnotations
    && (effectiveAnnotationContext?.context === 'owner' || isAuthenticated)
  const resolvedByThreadId = useMemo(
    () => new Map(annotated.resolved.map((item) => [item.threadId, item])),
    [annotated.resolved]
  )
  const sortedThreads = useMemo(() => {
    return [...annotations.threads].sort((a, b) => {
      const first = resolvedByThreadId.get(a.id)
      const second = resolvedByThreadId.get(b.id)
      const firstPosition = first?.range?.start
      const secondPosition = second?.range?.start
      if (typeof firstPosition === 'number' && typeof secondPosition === 'number' && firstPosition !== secondPosition) {
        return firstPosition - secondPosition
      }
      if (typeof firstPosition === 'number' && typeof secondPosition !== 'number') return -1
      if (typeof firstPosition !== 'number' && typeof secondPosition === 'number') return 1
      return Date.parse(a.createdAt) - Date.parse(b.createdAt)
    })
  }, [annotations.threads, resolvedByThreadId])
  const railThreads = useMemo(
    (): readonly MarkdownCommentsRailThread[] => sortedThreads.map((thread) => {
      const resolved = resolvedByThreadId.get(thread.id)
      const effectiveThread = !resolved || resolved.anchorStatus === thread.anchorStatus
        ? thread
        : { ...thread, anchorStatus: resolved.anchorStatus }
      return {
        thread: effectiveThread,
        anchorTop: resolved?.anchorStatus === 'orphaned' ? null : threadAnchorTopById[thread.id] ?? null,
      }
    }),
    [resolvedByThreadId, sortedThreads, threadAnchorTopById]
  )

  useLayoutEffect(() => {
    const root = bodyRef.current
    if (!root) return
    const rootRect = root.getBoundingClientRect()
    const renderedText = getMarkdownRenderedText(root)
    const nextAnchors: Record<string, number> = {}
    const nextRects: MarkdownAnnotationOverlayRect[] = []

    for (const item of annotated.resolved) {
      if (item.anchorStatus === 'orphaned' || !item.range) continue
      const rects = measureRenderedTextRange(root, item.range, rootRect)
      if (rects.length === 0) continue
      nextAnchors[item.threadId] = rects[0].top
      rects.forEach((rect, index) => {
        nextRects.push({
          key: `${item.threadId}-${index}`,
          kind: 'thread',
          threadId: item.threadId,
          ...rect,
        })
      })
    }

    if (pendingTarget) {
      const pending = resolveMarkdownAnnotationTextRange(pendingTarget, renderedText)
      if (pending.range) {
        measureRenderedTextRange(root, pending.range, rootRect).forEach((rect, index) => {
          nextRects.push({
            key: `pending-${index}`,
            kind: 'pending',
            threadId: null,
            ...rect,
          })
        })
      }
    }

    setThreadAnchorTopById((current) => sameNumberRecord(current, nextAnchors) ? current : nextAnchors)
    setAnnotationOverlayRects((current) => sameOverlayRects(current, nextRects) ? current : nextRects)
  }, [annotated.resolved, commentsOpen, outlineOpen, pendingTarget])

  useEffect(() => {
    if (commentsTouchedRef.current || annotations.threads.length === 0) return
    setCommentsOpen(true)
  }, [annotations.threads.length])

  const setCommentPanelOpen = useCallback((open: boolean) => {
    commentsTouchedRef.current = true
    setCommentsOpen(open)
  }, [])

  const clearPendingComment = useCallback(() => {
    setPendingTarget(null)
    setSelectionPopover(null)
    setCommentDialogOpen(false)
    setCommentBody('')
    window.getSelection()?.removeAllRanges()
  }, [])

  const toolbarItems = useMemo<readonly DriveRendererToolbarItem[]>(() => {
    const items: DriveRendererToolbarItem[] = []
    if (outline.length > 0) {
      items.push({
        kind: 'toggle',
        id: 'markdown-outline',
        label: '目录',
        icon: ListTree,
        pressed: outlineOpen,
        onPressedChange: setOutlineOpen,
      })
    }
    if (annotationsEnabled) {
      items.push(
        {
          kind: 'toggle',
          id: 'markdown-comments',
          label: `评论 ${annotations.threads.length}`,
          icon: MessageSquare,
          pressed: commentsOpen,
          onPressedChange: setCommentPanelOpen,
        },
        {
          kind: 'button',
          id: 'markdown-refresh-comments',
          label: '刷新评论',
          icon: RefreshCw,
          variant: 'ghost',
          onClick: () => { void annotations.refresh() },
        },
      )
    }
    return items
  }, [
    annotations.refresh,
    annotations.threads.length,
    annotationsEnabled,
    commentsOpen,
    outline.length,
    outlineOpen,
    setCommentPanelOpen,
  ])

  useRegisterDriveRendererToolbarItems('markdown', toolbarItems)

  const focusThread = (threadId: string) => {
    setActiveThreadId(threadId)
    setCommentPanelOpen(true)
    const root = bodyRef.current
    const overlayRect = annotationOverlayRects.find((rect) => rect.kind === 'thread' && rect.threadId === threadId)
    if (!root || !overlayRect) return
    scrollPreviewContainerToRect(root, overlayRect)
  }

  const handleBodyMouseUp = () => {
    if (!canCreateAnnotation) return
    const root = bodyRef.current
    if (!root) return
    const selection = window.getSelection()
    const target = createMarkdownAnnotationTargetFromSelection(root, window.getSelection())
    if (!target || !selection || selection.rangeCount === 0) {
      if (!commentDialogOpen) clearPendingComment()
      return
    }
    const rect = getSelectionRect(selection.getRangeAt(0))
    if (!rect) {
      if (!commentDialogOpen) clearPendingComment()
      return
    }
    setPendingTarget(target)
    setSelectionPopover({
      top: Math.max(8, rect.top - 40),
      left: rect.left + rect.width / 2,
    })
  }

  const handleBodyClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const threadId = findOverlayThreadAtPoint(annotationOverlayRects, event.clientX, event.clientY, bodyRef.current)
    if (!threadId) return
    focusThread(threadId)
  }

  const createThread = async () => {
    if (!pendingTarget || !commentBody.trim()) return
    const thread = await annotations.createThread({
      targetKind: 'textRange',
      target: pendingTarget,
      body: commentBody,
    })
    setActiveThreadId(thread.id)
    setCommentPanelOpen(true)
    setPendingTarget(null)
    setSelectionPopover(null)
    setCommentDialogOpen(false)
    setCommentBody('')
    window.getSelection()?.removeAllRanges()
  }

  return (
    <div className='min-h-0 bg-background'>
      {selectionPopover && pendingTarget && !commentDialogOpen ? (
        <div
          data-drive-annotation-selection-action
          className='fixed z-50 -translate-x-1/2'
          style={{ top: selectionPopover.top, left: selectionPopover.left }}
        >
          <Button
            type='button'
            className='shadow-md'
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setCommentDialogOpen(true)}
          >
            添加评论
          </Button>
        </div>
      ) : null}
      <Dialog
        open={commentDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setCommentDialogOpen(true)
            return
          }
          clearPendingComment()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加评论</DialogTitle>
            <DialogDescription className='sr-only'>为选中的文字添加评论</DialogDescription>
          </DialogHeader>
          <Textarea
            value={commentBody}
            onChange={(event) => setCommentBody(event.currentTarget.value)}
            className='min-h-24'
            autoFocus
          />
          <DialogFooter>
            <Button type='button' variant='ghost' onClick={clearPendingComment}>取消</Button>
            <Button type='button' disabled={!commentBody.trim() || annotations.creatingThread} onClick={() => { void createThread() }}>
              评论
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div data-testid='markdown-layout' className='flex min-h-0 w-full gap-6'>
        {outline.length > 0 && outlineOpen ? (
          <aside className='w-52 shrink-0 px-4 py-6 md:px-6'>
            <nav className='sticky top-6 max-h-[calc(100vh-3rem)] overflow-auto' aria-label='目录'>
              <p className='mb-2 text-xs font-medium text-muted-foreground'>目录</p>
              <MarkdownOutlineTree items={outline} />
            </nav>
          </aside>
        ) : null}
        <div className='min-w-0 flex-1 px-4 py-6 md:px-6'>
          <div className='relative mx-auto max-w-3xl'>
            <div
              ref={bodyRef}
              data-testid='markdown-body'
              className={MARKDOWN_BODY_CLASSNAME}
              onClick={handleBodyClick}
              onMouseUp={handleBodyMouseUp}
              dangerouslySetInnerHTML={{ __html: annotated.html }}
            />
            {annotationOverlayRects.length > 0 ? (
              <div aria-hidden className='pointer-events-none absolute inset-0'>
                {annotationOverlayRects.map((rect) => (
                  <div
                    key={rect.key}
                    data-drive-annotation-overlay-kind={rect.kind}
                    data-drive-annotation-overlay-thread-id={rect.threadId ?? undefined}
                    className={cn(
                      'absolute mix-blend-multiply dark:mix-blend-screen',
                      rect.kind === 'pending'
                        ? 'bg-amber-200/45 ring-1 ring-amber-300/60 dark:bg-amber-900/30 dark:ring-amber-700/50'
                        : 'bg-amber-100/60 dark:bg-amber-900/25'
                    )}
                    style={{
                      top: rect.top,
                      left: rect.left,
                      width: rect.width,
                      height: rect.height,
                    }}
                  />
                ))}
              </div>
            ) : null}
            {preview.truncated ? (
              <div className='mt-4 border-t pt-2 text-xs text-muted-foreground'>内容已截断</div>
            ) : null}
          </div>
        </div>
        {commentsOpen ? (
          <MarkdownCommentsRail
            threads={railThreads}
            activeThreadId={activeThreadId}
            canReply={canCreateAnnotation}
            onFocusThread={focusThread}
            onReply={annotations.reply}
            onUpdateComment={annotations.updateComment}
            onDeleteComment={annotations.deleteComment}
            onDeleteThread={annotations.deleteThread}
          />
        ) : null}
      </div>
      {annotations.error ? (
        <div className='border-t px-3 py-2 text-xs text-muted-foreground'>{annotations.error}</div>
      ) : null}
      {annotated.resolved.some((item) => item.anchorStatus === 'orphaned') ? (
        <div className='sr-only'>位置已变化</div>
      ) : null}
    </div>
  )
}

function getSelectionRect(range: Range): DOMRect | null {
  const rects = typeof range.getClientRects === 'function'
    ? Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0)
    : []
  const rect = rects[0] ?? range.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0 ? rect : null
}

function measureRenderedTextRange(
  root: HTMLElement,
  range: { readonly start: number; readonly end: number },
  rootRect: DOMRect,
): Array<Omit<MarkdownAnnotationOverlayRect, 'key' | 'kind' | 'threadId'>> {
  const domRange = createRenderedTextRange(root, range.start, range.end)
  if (!domRange) return []
  const rects = typeof domRange.getClientRects === 'function'
    ? Array.from(domRange.getClientRects())
    : [domRange.getBoundingClientRect()]
  domRange.detach()
  return removeContainerOverlayRects(rects.filter((rect) => isUsableOverlayRect(rect, rootRect)))
    .map((rect) => ({
      top: rect.top - rootRect.top,
      left: rect.left - rootRect.left,
      width: rect.width,
      height: rect.height,
    }))
}

function createRenderedTextRange(root: HTMLElement, start: number, end: number): Range | null {
  if (start >= end) return null
  const segments = collectRenderedTextSegments(root)
  const startPoint = findRenderedTextPoint(segments, start)
  const endPoint = findRenderedTextPoint(segments, end)
  if (!startPoint || !endPoint) return null
  const range = root.ownerDocument.createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  return range
}

function collectRenderedTextSegments(root: HTMLElement): Array<{ readonly node: Text; readonly start: number; readonly end: number }> {
  const segments: Array<{ readonly node: Text; readonly start: number; readonly end: number }> = []
  let offset = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    const text = current.textContent ?? ''
    const length = text.length
    segments.push({ node: current as Text, start: offset, end: offset + length })
    offset += length
    current = walker.nextNode()
  }
  return segments
}

function findRenderedTextPoint(
  segments: readonly { readonly node: Text; readonly start: number; readonly end: number }[],
  offset: number,
): { readonly node: Text; readonly offset: number } | null {
  for (const segment of segments) {
    if (offset < segment.start || offset > segment.end) continue
    if (offset === segment.end && offset !== segment.start) return { node: segment.node, offset: segment.node.data.length }
    return { node: segment.node, offset: Math.max(0, offset - segment.start) }
  }
  return null
}

function isUsableOverlayRect(rect: DOMRect, rootRect: DOMRect): boolean {
  if (rect.width <= 2 || rect.height <= 0) return false
  if (rootRect.width <= 0 && rootRect.height <= 0) return true
  return rect.right >= rootRect.left
    && rect.left <= rootRect.right
    && rect.bottom >= rootRect.top
    && rect.top <= rootRect.bottom
}

function removeContainerOverlayRects(rects: readonly DOMRect[]): readonly DOMRect[] {
  return rects.filter((rect, index) => {
    return !rects.some((other, otherIndex) => {
      return index !== otherIndex
        && containsOverlayRect(rect, other)
        && isMeaningfullyBroaderRect(rect, other)
    })
  })
}

function containsOverlayRect(container: DOMRect, inner: DOMRect): boolean {
  return inner.left >= container.left - 0.5
    && inner.right <= container.right + 0.5
    && inner.top >= container.top - 0.5
    && inner.bottom <= container.bottom + 0.5
}

function isMeaningfullyBroaderRect(container: DOMRect, inner: DOMRect): boolean {
  const containerArea = container.width * container.height
  const innerArea = inner.width * inner.height
  return containerArea > innerArea * 1.2
    && (container.width > inner.width + 4 || container.height > inner.height + 4)
}

function findOverlayThreadAtPoint(
  rects: readonly MarkdownAnnotationOverlayRect[],
  clientX: number,
  clientY: number,
  root: HTMLElement | null,
): string | null {
  if (!root) return null
  const rootRect = root.getBoundingClientRect()
  const x = clientX - rootRect.left
  const y = clientY - rootRect.top
  const hit = rects.find((rect) => rect.kind === 'thread'
    && rect.threadId
    && x >= rect.left
    && x <= rect.left + rect.width
    && y >= rect.top
    && y <= rect.top + rect.height)
  return hit?.threadId ?? null
}

function scrollPreviewContainerToRect(root: HTMLElement, rect: MarkdownAnnotationOverlayRect): void {
  const container = findNearestScrollContainer(root)
  if (!container) return
  const rootRect = root.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const targetTop = Math.max(
    0,
    container.scrollTop
      + rootRect.top
      - containerRect.top
      + rect.top
      + rect.height / 2
      - container.clientHeight / 2
  )
  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top: targetTop, behavior: 'smooth' })
    return
  }
  container.scrollTop = targetTop
}

function findNearestScrollContainer(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement
  while (current) {
    const style = window.getComputedStyle(current)
    if (/(auto|scroll|overlay)/u.test(`${style.overflowY} ${style.overflow}`)) return current
    current = current.parentElement
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null
}

function sameNumberRecord(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => left[key] === right[key])
}

function sameOverlayRects(left: readonly MarkdownAnnotationOverlayRect[], right: readonly MarkdownAnnotationOverlayRect[]): boolean {
  if (left.length !== right.length) return false
  return left.every((item, index) => {
    const other = right[index]
    return Boolean(other)
      && item.key === other.key
      && item.kind === other.kind
      && item.threadId === other.threadId
      && item.top === other.top
      && item.left === other.left
      && item.width === other.width
      && item.height === other.height
  })
}

export function MarkdownOutlineTree({ items }: { readonly items: readonly DriveMarkdownOutlineItemDto[] }) {
  return (
    <ul className='space-y-1'>
      {items.map((item) => (
        <MarkdownOutlineNode key={item.id} item={item} />
      ))}
    </ul>
  )
}

function MarkdownOutlineNode({ item }: { readonly item: DriveMarkdownOutlineItemDto }) {
  return (
    <li>
      <a
        className={cn(
          'block truncate rounded-sm py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          outlineDepthClassName(item.depth)
        )}
        href={`#${item.id}`}
      >
        {item.text}
      </a>
      {item.children.length > 0 ? <MarkdownOutlineTree items={item.children} /> : null}
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
