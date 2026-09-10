import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  isDriveCommentableMarkdownItem,
  type DriveBrowserItemDto,
  type DriveMarkdownProjectionDto,
} from '@synapse/shared'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useFilePreviewLayoutMode } from '@/features/file-browser/preview/file-preview-layout'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { DriveCommentsRail, type DriveCommentsRailItem } from '../drive-comments-rail'
import { useDriveAnnotations, type DriveAnnotationContext } from '../use-drive-annotations'
import {
  useDriveEditorCommentGeometry,
  type DriveEditorCommentGeometryInput,
} from './drive-editor-comment-geometry'

const COMMENTS_PANEL_DEFAULT_SIZE = 22
const COMMENTS_PANEL_MIN_SIZE = 17
const COMMENTS_PANEL_MAX_SIZE = 32
const COMMENT_SCROLL_SAFE_INSET = 24

type ResizablePanelPercent = `${number}%`
type DataAttributeName = `data-${string}`

export type DriveDocumentEditorCommentsDataAttributes = {
  readonly layout: DataAttributeName
  readonly scroll: DataAttributeName
  readonly contentHost: DataAttributeName
  readonly overlay: DataAttributeName
  readonly overlayThreadId: DataAttributeName
  readonly bottomCompensation: DataAttributeName
  readonly editorPanel: DataAttributeName
  readonly commentsPanel: DataAttributeName
  readonly sheet: DataAttributeName
}

export function useDriveDocumentEditorComments({
  current,
  currentVersionId,
  annotationContext,
  projection,
  imagePreviewUrls,
  sourceMode,
  stateResetKey,
  preserveStateOnReset,
  contentRootSelector,
  ignoredElementSelector,
}: {
  readonly current: DriveBrowserItemDto
  readonly currentVersionId?: string | null
  readonly annotationContext?: DriveAnnotationContext
  readonly projection?: DriveMarkdownProjectionDto | null
  readonly imagePreviewUrls: ReadonlyMap<string, string | null>
  readonly sourceMode: boolean
  readonly stateResetKey: string
  readonly preserveStateOnReset: boolean
  readonly contentRootSelector?: string
  readonly ignoredElementSelector?: string
}) {
  const editorContainerRef = useRef<HTMLDivElement | null>(null)
  const editorContentHostRef = useRef<HTMLDivElement | null>(null)
  const commentAnchorLayerRef = useRef<HTMLDivElement | null>(null)
  const editorScrollFrameRef = useRef<number | null>(null)
  const commentsTouchedRef = useRef(false)
  const preserveStateOnResetRef = useRef(preserveStateOnReset)
  preserveStateOnResetRef.current = preserveStateOnReset
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [compactCommentsOpen, setCompactCommentsOpen] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [commentAnchoredDocumentHeight, setCommentAnchoredDocumentHeight] = useState(0)
  const [commentBaselineRevision, setCommentBaselineRevision] = useState(0)
  const layoutMode = useFilePreviewLayoutMode()
  const isCompact = layoutMode === 'compact'
  const isAuthenticated = useAuthStore((state) => state.auth.isAuthenticated)
  const annotationsEnabled = isDriveCommentableMarkdownItem(current)
  const effectiveAnnotationContext = annotationsEnabled ? annotationContext : undefined
  const annotations = useDriveAnnotations(effectiveAnnotationContext)
  const annotationThreads = useMemo(
    () => annotationsEnabled ? annotations.threads : [],
    [annotations.threads, annotationsEnabled]
  )
  const annotationGeometryResetKey = useMemo(() => [
    current.id,
    currentVersionId ?? '',
    commentBaselineRevision,
    ...annotationThreads.map((thread) => [
      thread.id,
      thread.anchorStatus,
      thread.anchor?.lastResolvedVersionId ?? '',
      thread.anchor?.resolvedRenderedRange?.start ?? '',
      thread.anchor?.resolvedRenderedRange?.end ?? '',
    ].join(':')),
  ].join('|'), [annotationThreads, commentBaselineRevision, current.id, currentVersionId])
  const geometryInput: DriveEditorCommentGeometryInput = {
    enabled: annotationsEnabled && !sourceMode,
    layoutKey: `${layoutMode}:${commentsOpen}`,
    resetKey: annotationGeometryResetKey,
    threads: annotationThreads,
    projection,
    imagePreviewUrls,
    scrollRef: editorContainerRef,
    contentHostRef: editorContentHostRef,
    contentRootSelector,
    ignoredElementSelector,
  }
  const { geometry, notifyEditorUpdate, scheduleGeometry } = useDriveEditorCommentGeometry(geometryInput)
  const canCommentAnnotations = effectiveAnnotationContext?.context === 'owner'
    || Boolean(effectiveAnnotationContext?.canComment)
  const canReplyToAnnotations = annotationsEnabled
    && Boolean(effectiveAnnotationContext)
    && canCommentAnnotations
    && (effectiveAnnotationContext?.context === 'owner' || isAuthenticated)
  const railThreads = useMemo<readonly DriveCommentsRailItem[]>(() => annotationThreads
    .map((thread) => {
      const anchorTop = sourceMode ? null : geometry.anchorTopByThreadId[thread.id] ?? null
      return {
        thread,
        placement: typeof anchorTop === 'number'
          ? { status: 'positioned' as const, anchorTop }
          : { status: 'unavailable' as const },
      }
    })
    .sort((left, right) => {
      const leftTop = left.placement.status === 'positioned' ? left.placement.anchorTop : null
      const rightTop = right.placement.status === 'positioned' ? right.placement.anchorTop : null
      if (leftTop !== null && rightTop !== null && leftTop !== rightTop) return leftTop - rightTop
      if (leftTop !== null) return -1
      if (rightTop !== null) return 1
      return Date.parse(left.thread.createdAt) - Date.parse(right.thread.createdAt)
    }), [annotationThreads, geometry.anchorTopByThreadId, sourceMode])
  const navigableThreadIds = useMemo(() => railThreads
    .filter((item) => item.placement.status === 'positioned' && item.thread.anchorStatus !== 'orphaned')
    .map((item) => item.thread.id), [railThreads])
  const activeNavigableIndex = activeThreadId ? navigableThreadIds.indexOf(activeThreadId) : -1
  const previousThreadId = activeNavigableIndex > 0 ? navigableThreadIds[activeNavigableIndex - 1] ?? null : null
  const nextThreadId = activeNavigableIndex === -1
    ? navigableThreadIds[0] ?? null
    : navigableThreadIds[activeNavigableIndex + 1] ?? null

  useEffect(() => {
    if (preserveStateOnResetRef.current) return
    setActiveThreadId(null)
    setCommentsOpen(false)
    setCompactCommentsOpen(false)
    setCommentAnchoredDocumentHeight(0)
    commentsTouchedRef.current = false
  }, [current.id, currentVersionId, stateResetKey])

  useEffect(() => {
    if (commentsTouchedRef.current || annotationThreads.length === 0) return
    if (isCompact) setCompactCommentsOpen(true)
    else setCommentsOpen(true)
  }, [annotationThreads.length, isCompact])

  useEffect(() => {
    if (!activeThreadId || annotationThreads.some((thread) => thread.id === activeThreadId)) return
    setActiveThreadId(null)
  }, [activeThreadId, annotationThreads])

  useLayoutEffect(() => {
    scheduleGeometry()
  }, [commentsOpen, isCompact, scheduleGeometry])

  const setCommentPanelOpen = useCallback((open: boolean) => {
    commentsTouchedRef.current = true
    if (isCompact) setCompactCommentsOpen(open)
    else setCommentsOpen(open)
  }, [isCompact])
  const setCommentAnchorLayerRef = useCallback((element: HTMLDivElement | null) => {
    commentAnchorLayerRef.current = element
    setCommentAnchorLayerScrollTransform(element, editorContainerRef.current?.scrollTop ?? 0)
  }, [])
  const flushEditorScroll = useCallback(() => {
    editorScrollFrameRef.current = null
    setCommentAnchorLayerScrollTransform(commentAnchorLayerRef.current, editorContainerRef.current?.scrollTop ?? 0)
  }, [])
  const handleEditorScroll = useCallback(() => {
    if (editorScrollFrameRef.current !== null) return
    editorScrollFrameRef.current = window.requestAnimationFrame(flushEditorScroll)
  }, [flushEditorScroll])
  const scrollToThread = useCallback((threadId: string) => {
    const scroller = editorContainerRef.current
    const anchorTop = geometry.anchorTopByThreadId[threadId]
    if (!scroller || typeof anchorTop !== 'number') return
    const top = Math.max(0, anchorTop - COMMENT_SCROLL_SAFE_INSET)
    setActiveThreadId(threadId)
    if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top, behavior: 'instant' })
    else scroller.scrollTop = top
    setCommentAnchorLayerScrollTransform(commentAnchorLayerRef.current, top)
  }, [geometry.anchorTopByThreadId])
  const focusThreadFromRail = useCallback((threadId: string) => {
    setActiveThreadId(threadId)
    scrollToThread(threadId)
  }, [scrollToThread])
  const handleCommentsWheel = useCallback((event: WheelEvent) => {
    if (event.deltaY === 0) return
    const scroller = editorContainerRef.current
    if (!scroller) return
    event.preventDefault()
    scroller.scrollTop += normalizeWheelDelta(event, scroller.clientHeight)
    handleEditorScroll()
  }, [handleEditorScroll])
  const refreshAfterSave = useCallback(async () => {
    await annotations.refresh()
    setCommentBaselineRevision((revision) => revision + 1)
  }, [annotations.refresh])

  useEffect(() => () => {
    if (editorScrollFrameRef.current !== null) window.cancelAnimationFrame(editorScrollFrameRef.current)
  }, [])

  const commentBottomCompensation = commentsOpen && !isCompact && !sourceMode
    ? Math.max(0, Math.ceil(commentAnchoredDocumentHeight - geometry.naturalHeight))
    : 0

  return {
    activeThreadId,
    annotationError: annotations.error,
    annotationsEnabled,
    commentBottomCompensation,
    commentsOpen,
    compactCommentsOpen,
    editorContainerRef,
    editorContentHostRef,
    geometry,
    handleCommentsWheel,
    handleEditorScroll,
    isCompact,
    notifyEditorUpdate,
    railThreads,
    refreshAfterSave,
    renderRailProps: {
      activeThreadId,
      anchorLayerRef: setCommentAnchorLayerRef,
      canReply: canReplyToAnnotations,
      loading: annotations.loading,
      onAnchoredHeightChange: setCommentAnchoredDocumentHeight,
      onDeleteComment: annotations.deleteComment,
      onFocusThread: focusThreadFromRail,
      onNavigateNext: nextThreadId ? () => scrollToThread(nextThreadId) : undefined,
      onNavigatePrevious: previousThreadId ? () => scrollToThread(previousThreadId) : undefined,
      onRefresh: () => { void annotations.refresh() },
      onReply: annotations.reply,
      onUpdateComment: annotations.updateComment,
      threads: railThreads,
    },
    scheduleGeometry,
    setCommentPanelOpen,
    sourceMode,
  }
}

export type DriveDocumentEditorCommentsController = ReturnType<typeof useDriveDocumentEditorComments>

export function DriveDocumentEditorCommentsFrame({
  comments,
  dataAttributes,
  editorView,
  onEditorContainerChange,
}: {
  readonly comments: DriveDocumentEditorCommentsController
  readonly dataAttributes: DriveDocumentEditorCommentsDataAttributes
  readonly editorView: ReactNode
  readonly onEditorContainerChange?: (element: HTMLDivElement | null) => void
}) {
  const setEditorContainerRef = useCallback((element: HTMLDivElement | null) => {
    comments.editorContainerRef.current = element
    onEditorContainerChange?.(element)
  }, [comments.editorContainerRef, onEditorContainerChange])
  const renderCommentsRail = (mode: 'anchored' | 'list') => (
    <DriveCommentsRail
      {...comments.renderRailProps}
      mode={mode}
      anchorLayerRef={mode === 'anchored' ? comments.renderRailProps.anchorLayerRef : undefined}
      onAnchoredHeightChange={mode === 'anchored' ? comments.renderRailProps.onAnchoredHeightChange : undefined}
      onAnchoredWheel={mode === 'anchored' ? comments.handleCommentsWheel : undefined}
    />
  )
  const editorSurface = (
    <div
      ref={setEditorContainerRef}
      {...{ [dataAttributes.scroll]: 'true' }}
      className='h-full min-h-0 overflow-auto overscroll-contain'
      onScroll={comments.handleEditorScroll}
    >
      <div
        ref={comments.editorContentHostRef}
        {...{ [dataAttributes.contentHost]: 'true' }}
        className='relative min-h-full'
      >
        {editorView}
        {!comments.sourceMode && comments.geometry.overlayRects.length > 0 ? (
          <div
            aria-hidden
            {...{ [dataAttributes.overlay]: 'true' }}
            className='pointer-events-none absolute inset-0'
          >
            {comments.geometry.overlayRects.map((rect) => (
              <div
                key={rect.key}
                {...{ [dataAttributes.overlayThreadId]: rect.threadId }}
                className={cn(
                  'absolute mix-blend-multiply dark:mix-blend-screen',
                  rect.threadId === comments.activeThreadId
                    ? 'bg-amber-300/80 ring-2 ring-amber-500/90 dark:bg-amber-700/55 dark:ring-amber-400/90'
                    : 'bg-amber-200/45 dark:bg-amber-800/30'
                )}
                style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
              />
            ))}
          </div>
        ) : null}
      </div>
      {comments.commentBottomCompensation > 0 ? (
        <div
          aria-hidden
          {...{ [dataAttributes.bottomCompensation]: 'true' }}
          style={{ height: comments.commentBottomCompensation }}
        />
      ) : null}
    </div>
  )
  const commentsPanelDefaultSize = resizablePanelPercent(COMMENTS_PANEL_DEFAULT_SIZE)
  const commentsPanelMinSize = resizablePanelPercent(COMMENTS_PANEL_MIN_SIZE)
  const commentsPanelMaxSize = resizablePanelPercent(COMMENTS_PANEL_MAX_SIZE)
  const editorPanelDefaultSize = resizablePanelPercent(
    comments.commentsOpen ? 100 - COMMENTS_PANEL_DEFAULT_SIZE : 100
  )

  return (
    <>
      <div {...{ [dataAttributes.layout]: 'true' }} className='min-h-0 flex-1 overflow-hidden'>
        {comments.isCompact ? editorSurface : (
          <ResizablePanelGroup orientation='horizontal' className='h-full min-h-0 overflow-hidden'>
            <ResizablePanel
              defaultSize={editorPanelDefaultSize}
              minSize='35%'
              {...{ [dataAttributes.editorPanel]: 'editor' }}
              className='h-full min-h-0 min-w-0 overflow-hidden'
            >
              {editorSurface}
            </ResizablePanel>
            {comments.commentsOpen ? (
              <>
                <ResizableHandle />
                <ResizablePanel
                  defaultSize={commentsPanelDefaultSize}
                  minSize={commentsPanelMinSize}
                  maxSize={commentsPanelMaxSize}
                  {...{ [dataAttributes.commentsPanel]: 'comments' }}
                  className='h-full min-h-0 overflow-hidden'
                >
                  <aside className='h-full min-h-0 overflow-hidden bg-background'>
                    {renderCommentsRail(comments.sourceMode ? 'list' : 'anchored')}
                  </aside>
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        )}
      </div>
      {comments.isCompact && comments.annotationsEnabled ? (
        <Sheet open={comments.compactCommentsOpen} onOpenChange={comments.setCommentPanelOpen}>
          <SheetContent
            data-drive-telemetry-scope='portal'
            side='right'
            {...{ [dataAttributes.sheet]: 'comments' }}
            className='gap-0 overflow-hidden'
          >
            <SheetHeader className='sr-only'>
              <SheetTitle>评论</SheetTitle>
              <SheetDescription>查看和管理文档评论</SheetDescription>
            </SheetHeader>
            <div className='min-h-0 flex-1 overflow-auto'>{renderCommentsRail('list')}</div>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  )
}

function setCommentAnchorLayerScrollTransform(element: HTMLElement | null, scrollTop: number): void {
  if (!element) return
  element.style.transform = `translate3d(0, ${-scrollTop}px, 0)`
}

function normalizeWheelDelta(event: Pick<WheelEvent, 'deltaMode' | 'deltaY'>, pageHeight: number): number {
  if (event.deltaMode === 1) return event.deltaY * 16
  if (event.deltaMode === 2) return event.deltaY * pageHeight
  return event.deltaY
}

function resizablePanelPercent(value: number): ResizablePanelPercent {
  return `${value}%`
}
