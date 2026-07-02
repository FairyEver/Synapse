import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  isDriveMarkdownItem,
  type DriveAnnotationTextRangeTargetV1,
  type DriveBrowserEditDto,
  type DriveBrowserItemDto,
  type DriveBrowserPreviewDto,
  type DriveMarkdownOutlineItemDto,
} from '@synapse/shared'
import { ListTree, Maximize2, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import type { DriveAnnotationContext } from '../use-drive-annotations'
import { useDriveAnnotations } from '../use-drive-annotations'
import { DriveCodeRenderer } from './code-renderer'
import { useDriveMarkdownImageSources, type DriveMarkdownImageSourceContext } from './drive-markdown-image-sources'
import type { DriveRendererEditContext } from './drive-renderer-shell'
import { renderMarkdownAnnotationHtml, resolveMarkdownAnnotationTextRange } from './markdown-annotation-render'
import { createMarkdownAnnotationTargetFromSelection } from './markdown-annotation-target'
import { getCommentActionErrorMessage, MarkdownCommentsRail, type MarkdownCommentsRailThread } from './markdown-comments-rail'
import { useRegisterDriveRendererToolbarItems, type DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

const MARKDOWN_BODY_CLASSNAME = 'max-w-full space-y-3 text-base leading-7 [&_a]:underline [&_blockquote]:border-l [&_blockquote]:pl-3 [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_h1]:scroll-mt-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:scroll-mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:scroll-mt-6 [&_h3]:font-medium [&_h4]:scroll-mt-6 [&_h5]:scroll-mt-6 [&_h6]:scroll-mt-6 [&_hr]:border-border [&_li]:ml-4 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_[data-drive-markdown-table-scroll="true"]]:max-w-full [&_[data-drive-markdown-table-scroll="true"]]:overflow-x-auto [&_table]:w-max [&_table]:min-w-full [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_td]:align-top [&_td:not(:first-child)]:min-w-56 [&_th]:border [&_th]:p-2 [&_th]:align-top [&_th:not(:first-child)]:min-w-56 [&_ul]:list-disc'
const MARKDOWN_OUTLINE_PANEL_DEFAULT_SIZE = 16
const MARKDOWN_OUTLINE_PANEL_MIN_SIZE = 12
const MARKDOWN_OUTLINE_PANEL_MAX_SIZE = 22
const MARKDOWN_COMMENTS_PANEL_DEFAULT_SIZE = 22
const MARKDOWN_COMMENTS_PANEL_MIN_SIZE = 17
const MARKDOWN_COMMENTS_PANEL_MAX_SIZE = 32

type ResizablePanelPercent = `${number}%`
type MarkdownWidthMode = 'reading' | 'wide'

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
  edit,
  annotationContext,
  editContext,
  imageSourceContext,
}: {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly annotationContext?: DriveAnnotationContext
  readonly editContext?: DriveRendererEditContext
  readonly imageSourceContext?: DriveMarkdownImageSourceContext
}) {
  const renderedHtml = preview.html?.trim()
  if (!renderedHtml) return <DriveCodeRenderer current={current} preview={preview} edit={edit} editContext={editContext} />
  const outline = preview.outline ?? []
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const documentScrollRef = useRef<HTMLDivElement | null>(null)
  const commentAnchorLayerRef = useRef<HTMLDivElement | null>(null)
  const commentsTouchedRef = useRef(false)
  const isAuthenticated = useAuthStore((state) => state.auth.isAuthenticated)
  const annotationsEnabled = isDriveMarkdownItem(current)
  const effectiveAnnotationContext = annotationsEnabled ? annotationContext : undefined
  const annotations = useDriveAnnotations(effectiveAnnotationContext)
  const resolvedImageSourceContext = useMemo(
    () => imageSourceContext ?? driveMarkdownImageSourceContextFromAnnotation(current, annotationContext),
    [annotationContext, current, imageSourceContext]
  )
  const imageSources = useDriveMarkdownImageSources({
    context: resolvedImageSourceContext,
    edit,
    editContext,
  })
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [widthMode, setWidthMode] = useState<MarkdownWidthMode>('reading')
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [pendingTarget, setPendingTarget] = useState<DriveAnnotationTextRangeTargetV1 | null>(null)
  const [selectionPopover, setSelectionPopover] = useState<SelectionPopoverPosition | null>(null)
  const [commentDialogOpen, setCommentDialogOpen] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [commentCreateError, setCommentCreateError] = useState<string | null>(null)
  const [commentAnchorBaseOffset, setCommentAnchorBaseOffset] = useState(0)
  const [threadAnchorTopById, setThreadAnchorTopById] = useState<Record<string, number>>({})
  const [annotationOverlayRects, setAnnotationOverlayRects] = useState<readonly MarkdownAnnotationOverlayRect[]>([])
  const annotated = useMemo(
    () => renderMarkdownAnnotationHtml(renderedHtml, annotations.threads),
    [annotations.threads, renderedHtml]
  )
  const canCommentAnnotations = effectiveAnnotationContext?.context === 'owner' || Boolean(effectiveAnnotationContext?.canComment)
  const canCreateAnnotation = annotationsEnabled
    && Boolean(effectiveAnnotationContext)
    && canCommentAnnotations
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
  const commentCount = useMemo(() => countMarkdownComments(railThreads), [railThreads])

  const measureAnnotationLayout = useCallback(() => {
    const root = bodyRef.current
    if (!root) return
    const rootRect = root.getBoundingClientRect()
    const layoutRect = layoutRef.current?.getBoundingClientRect()
    if (layoutRect) {
      const nextBaseOffset = Math.round(rootRect.top - layoutRect.top + (documentScrollRef.current?.scrollTop ?? 0))
      setCommentAnchorBaseOffset((current) => current === nextBaseOffset ? current : nextBaseOffset)
    }
    const renderedTextSegments = collectRenderedTextSegments(root)
    const renderedText = getRenderedTextFromSegments(renderedTextSegments)
    const nextAnchors: Record<string, number> = {}
    const nextRects: MarkdownAnnotationOverlayRect[] = []

    for (const item of annotated.resolved) {
      if (item.anchorStatus === 'orphaned' || !item.range) continue
      const rects = measureRenderedTextRange(root, renderedTextSegments, item.range, rootRect)
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
        measureRenderedTextRange(root, renderedTextSegments, pending.range, rootRect).forEach((rect, index) => {
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
  }, [annotated.resolved, pendingTarget])

  useLayoutEffect(() => {
    measureAnnotationLayout()
  }, [commentsOpen, measureAnnotationLayout, outlineOpen, widthMode])

  useEffect(() => {
    const root = bodyRef.current
    if (!root || typeof ResizeObserver === 'undefined') return
    let frame: number | null = null
    const scheduleMeasurement = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        measureAnnotationLayout()
      })
    }
    const observer = new ResizeObserver(scheduleMeasurement)
    observer.observe(root)
    return () => {
      observer.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [measureAnnotationLayout])

  const syncCommentScrollTransform = useCallback(() => {
    setCommentAnchorLayerScrollTransform(commentAnchorLayerRef.current, documentScrollRef.current?.scrollTop ?? 0)
  }, [])

  const setCommentAnchorLayer = useCallback((element: HTMLDivElement | null) => {
    commentAnchorLayerRef.current = element
    syncCommentScrollTransform()
  }, [syncCommentScrollTransform])

  useEffect(() => {
    const scroller = documentScrollRef.current
    if (!scroller) return
    let frame: number | null = null
    const scheduleScrollSync = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        syncCommentScrollTransform()
      })
    }
    syncCommentScrollTransform()
    scroller.addEventListener('scroll', scheduleScrollSync, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', scheduleScrollSync)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [syncCommentScrollTransform])

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
    setCommentCreateError(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  const clearPendingSelectionAction = useCallback(() => {
    setPendingTarget(null)
    setSelectionPopover(null)
    setCommentCreateError(null)
  }, [])

  const toolbarItems = useMemo<readonly DriveRendererToolbarItem[]>(() => {
    const items: DriveRendererToolbarItem[] = [
      {
        kind: 'button',
        id: 'markdown-width-mode',
        label: widthMode === 'reading' ? '宽屏' : '阅读',
        icon: Maximize2,
        variant: widthMode === 'wide' ? 'secondary' : 'ghost',
        onClick: () => setWidthMode((current) => current === 'reading' ? 'wide' : 'reading'),
      },
    ]
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
          label: `评论 ${commentCount}`,
          icon: MessageSquare,
          pressed: commentsOpen,
          onPressedChange: setCommentPanelOpen,
        }
      )
    }
    if (imageSources.toolbarItem) items.push(imageSources.toolbarItem)
    return items
  }, [
    annotationsEnabled,
    commentCount,
    commentsOpen,
    imageSources.toolbarItem,
    outline.length,
    outlineOpen,
    setCommentPanelOpen,
    widthMode,
  ])

  useRegisterDriveRendererToolbarItems('markdown', toolbarItems)

  const focusThread = (threadId: string) => {
    setActiveThreadId(threadId)
    setCommentPanelOpen(true)
    const root = bodyRef.current
    const overlayRect = findOverlayRectByThreadId(annotationOverlayRects, threadId, root)
    if (!root || !overlayRect) return
    scrollPreviewContainerToRect(root, overlayRect)
  }

  const syncSelectionActionFromCurrentSelection = useCallback(() => {
    if (!canCreateAnnotation) return
    const root = bodyRef.current
    if (!root) return
    const selection = window.getSelection()
    const target = createMarkdownAnnotationTargetFromSelection(root, selection)
    if (!target || !selection || selection.rangeCount === 0) {
      if (!commentDialogOpen) clearPendingSelectionAction()
      return
    }
    const rect = getSelectionRect(selection.getRangeAt(0))
    if (!rect) {
      if (!commentDialogOpen) clearPendingSelectionAction()
      return
    }
    setPendingTarget(target)
    setSelectionPopover({
      top: Math.max(8, rect.top - 40),
      left: rect.left + rect.width / 2,
    })
  }, [canCreateAnnotation, clearPendingSelectionAction, commentDialogOpen])

  useEffect(() => {
    if (!canCreateAnnotation) return
    let frame: number | null = null
    const scheduleSelectionSync = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        syncSelectionActionFromCurrentSelection()
      })
    }
    const syncSelection = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
        frame = null
      }
      syncSelectionActionFromCurrentSelection()
    }
    document.addEventListener('selectionchange', scheduleSelectionSync)
    document.addEventListener('pointerup', syncSelection)
    document.addEventListener('keyup', syncSelection)
    return () => {
      document.removeEventListener('selectionchange', scheduleSelectionSync)
      document.removeEventListener('pointerup', syncSelection)
      document.removeEventListener('keyup', syncSelection)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [canCreateAnnotation, syncSelectionActionFromCurrentSelection])

  const handleBodyClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const threadId = findOverlayThreadAtPoint(annotationOverlayRects, event.clientX, event.clientY, bodyRef.current)
      ?? findRenderedOverlayThreadAtPoint(event.clientX, event.clientY, bodyRef.current)
    if (!threadId) return
    focusThread(threadId)
  }

  const outlinePanelOpen = outline.length > 0 && outlineOpen
  const outlinePanelSize = outlinePanelOpen ? MARKDOWN_OUTLINE_PANEL_DEFAULT_SIZE : 0
  const commentsPanelSize = commentsOpen ? MARKDOWN_COMMENTS_PANEL_DEFAULT_SIZE : 0
  const documentPanelSize = 100 - outlinePanelSize - commentsPanelSize
  const outlinePanelDefaultSize = resizablePanelPercent(MARKDOWN_OUTLINE_PANEL_DEFAULT_SIZE)
  const outlinePanelMinSize = resizablePanelPercent(MARKDOWN_OUTLINE_PANEL_MIN_SIZE)
  const outlinePanelMaxSize = resizablePanelPercent(MARKDOWN_OUTLINE_PANEL_MAX_SIZE)
  const documentPanelDefaultSize = resizablePanelPercent(documentPanelSize)
  const commentsPanelDefaultSize = resizablePanelPercent(MARKDOWN_COMMENTS_PANEL_DEFAULT_SIZE)
  const commentsPanelMinSize = resizablePanelPercent(MARKDOWN_COMMENTS_PANEL_MIN_SIZE)
  const commentsPanelMaxSize = resizablePanelPercent(MARKDOWN_COMMENTS_PANEL_MAX_SIZE)

  const createThread = async () => {
    if (!pendingTarget || !commentBody.trim()) return
    setCommentCreateError(null)
    try {
      const thread = await annotations.createThread({
        ...(edit?.currentVersionId ? { baseVersionId: edit.currentVersionId } : {}),
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
    } catch (cause) {
      setCommentCreateError(getCommentActionErrorMessage(cause))
    }
  }

  return (
    <div className='h-full min-h-0 overflow-hidden bg-background'>
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
            onChange={(event) => {
              setCommentBody(event.currentTarget.value)
              if (commentCreateError) setCommentCreateError(null)
            }}
            className='min-h-24'
            autoFocus
          />
          {commentCreateError ? <div role='status' className='text-sm text-destructive'>{commentCreateError}</div> : null}
          <DialogFooter>
            <Button type='button' variant='ghost' onClick={clearPendingComment}>取消</Button>
            <Button type='button' disabled={!commentBody.trim() || annotations.creatingThread} onClick={() => { void createThread() }}>
              评论
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div ref={layoutRef} data-testid='markdown-layout' className='h-full min-h-0 w-full overflow-hidden'>
        <ResizablePanelGroup orientation='horizontal' className='h-full min-h-0'>
          {outlinePanelOpen ? (
            <>
              <ResizablePanel
                defaultSize={outlinePanelDefaultSize}
                minSize={outlinePanelMinSize}
                maxSize={outlinePanelMaxSize}
                data-panel-size={outlinePanelDefaultSize}
                data-panel-min-size={outlinePanelMinSize}
                data-panel-max-size={outlinePanelMaxSize}
                data-markdown-resizable-panel='outline'
                className='h-full min-h-0 !overflow-visible'
              >
                <aside className='h-full overflow-hidden px-4 py-6 md:px-6'>
                  <nav className='sticky top-6 max-h-[calc(100vh-3rem)] overflow-auto' aria-label='目录'>
                    <p className='mb-2 text-xs font-medium text-muted-foreground'>目录</p>
                    <MarkdownOutlineTree items={outline} />
                  </nav>
                </aside>
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          ) : null}
          <ResizablePanel
            defaultSize={documentPanelDefaultSize}
            minSize='35%'
            data-markdown-resizable-panel='document'
            className='h-full min-h-0 min-w-0 !overflow-visible'
          >
            <div ref={documentScrollRef} data-testid='markdown-document-scroll' className='h-full min-w-0 overflow-auto px-4 py-6 md:px-6'>
              <div
                data-markdown-width-mode={widthMode}
                className={cn(
                  'relative mx-auto',
                  widthMode === 'reading' ? 'max-w-3xl' : 'w-full max-w-none'
                )}
              >
                <div
                  ref={bodyRef}
                  data-testid='markdown-body'
                  className={MARKDOWN_BODY_CLASSNAME}
                  onClick={handleBodyClick}
                  onMouseUp={syncSelectionActionFromCurrentSelection}
                  onPointerUp={syncSelectionActionFromCurrentSelection}
                  onKeyUp={syncSelectionActionFromCurrentSelection}
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
                            ? 'bg-amber-200/55 ring-1 ring-amber-300/70 dark:bg-amber-800/40 dark:ring-amber-600/60'
                            : rect.threadId === activeThreadId
                              ? 'bg-amber-200/70 ring-1 ring-amber-400/70 dark:bg-amber-800/45 dark:ring-amber-600/70'
                              : 'bg-amber-200/55 dark:bg-amber-800/35'
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
          </ResizablePanel>
          {commentsOpen ? (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel
                defaultSize={commentsPanelDefaultSize}
                minSize={commentsPanelMinSize}
                maxSize={commentsPanelMaxSize}
                data-panel-size={commentsPanelDefaultSize}
                data-panel-min-size={commentsPanelMinSize}
                data-panel-max-size={commentsPanelMaxSize}
                data-markdown-resizable-panel='comments'
                className='h-full min-h-0 !overflow-visible'
              >
                <aside className='h-full min-h-0 self-stretch overflow-hidden border-l bg-background'>
                  <MarkdownCommentsRail
                    threads={railThreads}
                    activeThreadId={activeThreadId}
                    canReply={canCreateAnnotation}
                    loading={annotations.loading}
                    anchorBaseOffset={commentAnchorBaseOffset}
                    anchoredLayerRef={setCommentAnchorLayer}
                    onFocusThread={focusThread}
                    onRefresh={() => { void annotations.refresh() }}
                    onReply={annotations.reply}
                    onUpdateComment={annotations.updateComment}
                    onDeleteComment={annotations.deleteComment}
                    onDeleteThread={annotations.deleteThread}
                  />
                </aside>
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
      </div>
      {annotations.error ? (
        <div className='border-t px-3 py-2 text-xs text-muted-foreground'>{annotations.error}</div>
      ) : null}
      {imageSources.panel}
      {annotated.resolved.some((item) => item.anchorStatus === 'orphaned') ? (
        <div className='sr-only'>位置已变化</div>
      ) : null}
    </div>
  )
}

function resizablePanelPercent(value: number): ResizablePanelPercent {
  return `${value}%`
}

function driveMarkdownImageSourceContextFromAnnotation(
  current: DriveBrowserItemDto,
  annotationContext?: DriveAnnotationContext
): DriveMarkdownImageSourceContext | undefined {
  if (current.type !== 'file') return undefined
  if (annotationContext?.context === 'share') {
    return {
      context: 'share',
      shareId: annotationContext.shareId,
      itemId: annotationContext.itemId ?? current.id,
    }
  }
  return { context: 'owner', itemId: current.id }
}

function countMarkdownComments(threads: readonly MarkdownCommentsRailThread[]): number {
  return threads.reduce((total, { thread }) => total + thread.comments.length, 0)
}

function setCommentAnchorLayerScrollTransform(element: HTMLElement | null, scrollTop: number): void {
  if (!element) return
  const offset = Math.max(0, Math.round(scrollTop))
  element.dataset.markdownCommentScrollOffset = String(offset)
  element.style.transform = offset === 0 ? '' : `translate3d(0px, -${offset}px, 0px)`
}

function getSelectionRect(range: Range): DOMRect | null {
  const rects = typeof range.getClientRects === 'function'
    ? Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0)
    : []
  const rect = rects[0] ?? range.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0 ? rect : null
}

type RenderedTextSegment = {
  readonly node: Text
  readonly text: string
  readonly start: number
  readonly end: number
}

function measureRenderedTextRange(
  root: HTMLElement,
  segments: readonly RenderedTextSegment[],
  range: { readonly start: number; readonly end: number },
  rootRect: DOMRect,
): Array<Omit<MarkdownAnnotationOverlayRect, 'key' | 'kind' | 'threadId'>> {
  const domRange = createRenderedTextRange(root, segments, range.start, range.end)
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

function createRenderedTextRange(
  root: HTMLElement,
  segments: readonly RenderedTextSegment[],
  start: number,
  end: number,
): Range | null {
  if (start >= end) return null
  const startPoint = findRenderedTextPoint(segments, start)
  const endPoint = findRenderedTextPoint(segments, end)
  if (!startPoint || !endPoint) return null
  const range = root.ownerDocument.createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  return range
}

function collectRenderedTextSegments(root: HTMLElement): RenderedTextSegment[] {
  const segments: RenderedTextSegment[] = []
  let offset = 0
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isMarkdownAnnotationMarkerText(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })
  let current = walker.nextNode()
  while (current) {
    const text = current.textContent ?? ''
    const length = text.length
    segments.push({ node: current as Text, text, start: offset, end: offset + length })
    offset += length
    current = walker.nextNode()
  }
  return segments
}

function getRenderedTextFromSegments(segments: readonly RenderedTextSegment[]): string {
  return segments.map((segment) => segment.text).join('')
}

function findRenderedTextPoint(
  segments: readonly RenderedTextSegment[],
  offset: number,
): { readonly node: Text; readonly offset: number } | null {
  for (const segment of segments) {
    if (offset < segment.start || offset > segment.end) continue
    if (offset === segment.end && offset !== segment.start) return { node: segment.node, offset: segment.node.data.length }
    return { node: segment.node, offset: Math.max(0, offset - segment.start) }
  }
  return null
}

function isMarkdownAnnotationMarkerText(node: Node): boolean {
  const parent = node.parentElement
  return Boolean(parent?.closest('[data-drive-annotation-marker="true"]'))
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

function findOverlayRectByThreadId(
  rects: readonly MarkdownAnnotationOverlayRect[],
  threadId: string,
  root: HTMLElement | null,
): MarkdownAnnotationOverlayRect | null {
  const match = rects.find((rect) => rect.kind === 'thread' && rect.threadId === threadId)
  if (match) return match
  if (!root) return null
  const element = findRenderedOverlayByThreadId(root, threadId)
  if (!element) return null
  const rect = readRenderedOverlayRect(element)
  if (!rect) return null
  return {
    key: `rendered-${threadId}`,
    kind: 'thread',
    threadId,
    ...rect,
  }
}

function findRenderedOverlayThreadAtPoint(clientX: number, clientY: number, root: HTMLElement | null): string | null {
  if (!root) return null
  const rootRect = root.getBoundingClientRect()
  const x = clientX - rootRect.left
  const y = clientY - rootRect.top
  const overlays = root.parentElement?.querySelectorAll<HTMLElement>('[data-drive-annotation-overlay-kind="thread"]') ?? []
  for (const element of overlays) {
    const rect = readRenderedOverlayRect(element)
    const threadId = element.getAttribute('data-drive-annotation-overlay-thread-id')
    if (!rect || !threadId) continue
    if (x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height) return threadId
  }
  return null
}

function findRenderedOverlayByThreadId(root: HTMLElement, threadId: string): HTMLElement | null {
  const overlays = root.parentElement?.querySelectorAll<HTMLElement>('[data-drive-annotation-overlay-kind="thread"]') ?? []
  return Array.from(overlays).find((element) => element.getAttribute('data-drive-annotation-overlay-thread-id') === threadId) ?? null
}

function readRenderedOverlayRect(element: HTMLElement): Omit<MarkdownAnnotationOverlayRect, 'key' | 'kind' | 'threadId'> | null {
  const top = Number.parseFloat(element.style.top)
  const left = Number.parseFloat(element.style.left)
  const width = Number.parseFloat(element.style.width)
  const height = Number.parseFloat(element.style.height)
  if (![top, left, width, height].every(Number.isFinite)) return null
  return { top, left, width, height }
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
    if (!isResizableLayoutElement(current) && /(auto|scroll|overlay)/u.test(`${style.overflowY} ${style.overflow}`)) return current
    current = current.parentElement
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null
}

function isResizableLayoutElement(element: HTMLElement): boolean {
  const slot = element.getAttribute('data-slot')
  return element.classList.contains('!overflow-visible')
    || element.hasAttribute('data-markdown-resizable-panel')
    || slot === 'resizable-panel'
    || slot === 'resizable-panel-group'
    || slot === 'resizable-handle'
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
