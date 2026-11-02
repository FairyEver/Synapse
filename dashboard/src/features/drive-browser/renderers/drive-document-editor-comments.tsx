import {
  Panel,
  Separator as PanelSeparator,
  Group,
} from 'react-resizable-panels'
import { Drawer } from '@heroui/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  isDriveCommentableMarkdownItem,
  type DriveBrowserItemDto,
  type DriveMarkdownOutlineItemDto,
  type DriveMarkdownProjectionDto,
} from '@synapse/shared'
import { useFilePreviewLayoutMode } from '@/features/file-browser/preview/file-preview-layout'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import {
  DriveCommentsRail,
  type DriveCommentsRailItem,
} from '../drive-comments-rail'
import {
  DRIVE_DOCUMENT_OUTLINE_PANEL_DEFAULT_SIZE,
  DRIVE_DOCUMENT_OUTLINE_PANEL_MAX_SIZE,
  DRIVE_DOCUMENT_OUTLINE_PANEL_MIN_SIZE,
  DriveDocumentOutlineTree,
} from './drive-document-outline'
import {
  useDriveAnnotations,
  type DriveAnnotationContext,
} from '../use-drive-annotations'
import { usePendingDriveDiscussion } from '../use-drive-discussion-location'
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
  readonly outlinePanel?: DataAttributeName
  readonly outlineSheet?: DataAttributeName
}
export type DriveDocumentEditorOutlineController = {
  readonly activeItemId: string | null
  readonly compactOpen: boolean
  readonly enabled: boolean
  readonly items: readonly DriveMarkdownOutlineItemDto[]
  readonly open: boolean
  readonly outlineScrollRef: RefObject<HTMLElement | null>
  readonly handleEditorScroll: () => void
  readonly selectItem: (itemId: string) => void
  readonly setPanelOpen: (open: boolean) => void
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
}: {
  readonly current: DriveBrowserItemDto
  readonly currentVersionId?: string | null
  readonly annotationContext?: DriveAnnotationContext
  readonly projection?: DriveMarkdownProjectionDto | null
  readonly imagePreviewUrls: ReadonlyMap<string, string | null>
  readonly sourceMode: boolean
  readonly stateResetKey: string
  readonly preserveStateOnReset: boolean
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
  const [commentAnchoredDocumentHeight, setCommentAnchoredDocumentHeight] =
    useState(0)
  const [commentBaselineRevision, setCommentBaselineRevision] = useState(0)
  const layoutMode = useFilePreviewLayoutMode()
  const isCompact = layoutMode === 'compact'
  const isAuthenticated = useAuthStore((state) => state.auth.isAuthenticated)
  const annotationsEnabled = isDriveCommentableMarkdownItem(current)
  const effectiveAnnotationContext = annotationsEnabled
    ? annotationContext
    : undefined
  const annotations = useDriveAnnotations(effectiveAnnotationContext)
  const pendingDiscussion = usePendingDriveDiscussion()
  useEffect(() => {
    const target = pendingDiscussion?.location
    if (
      !pendingDiscussion ||
      target?.kind !== 'annotation' ||
      annotations.loading ||
      annotations.refreshing ||
      annotations.error
    )
      return
    if (!annotations.threads.some((thread) => thread.id === target.threadId)) {
      pendingDiscussion.unavailable('该评论已删除')
      return
    }
    setActiveThreadId(target.threadId)
    if (isCompact) setCompactCommentsOpen(true)
    else setCommentsOpen(true)
  }, [
    annotations.error,
    annotations.loading,
    annotations.refreshing,
    annotations.threads,
    isCompact,
    pendingDiscussion,
  ])
  const annotationThreads = useMemo(
    () => (annotationsEnabled ? annotations.threads : []),
    [annotations.threads, annotationsEnabled]
  )
  const annotationGeometryResetKey = useMemo(
    () =>
      [
        current.id,
        currentVersionId ?? '',
        commentBaselineRevision,
        ...annotationThreads.map((thread) =>
          [
            thread.id,
            thread.anchorStatus,
            thread.anchor?.lastResolvedVersionId ?? '',
            thread.anchor?.resolvedRenderedRange?.start ?? '',
            thread.anchor?.resolvedRenderedRange?.end ?? '',
          ].join(':')
        ),
      ].join('|'),
    [annotationThreads, commentBaselineRevision, current.id, currentVersionId]
  )
  const geometryInput: DriveEditorCommentGeometryInput = {
    enabled: annotationsEnabled && !sourceMode,
    layoutKey: `${layoutMode}:${commentsOpen}`,
    resetKey: annotationGeometryResetKey,
    threads: annotationThreads,
    projection,
    imagePreviewUrls,
    scrollRef: editorContainerRef,
    contentHostRef: editorContentHostRef,
  }
  const { geometry, notifyEditorUpdate, scheduleGeometry } =
    useDriveEditorCommentGeometry(geometryInput)
  const canCommentAnnotations =
    effectiveAnnotationContext?.context === 'owner' ||
    Boolean(effectiveAnnotationContext?.canComment)
  const canReplyToAnnotations =
    annotationsEnabled &&
    Boolean(effectiveAnnotationContext) &&
    canCommentAnnotations &&
    (effectiveAnnotationContext?.context === 'owner' || isAuthenticated)
  const railThreads = useMemo<readonly DriveCommentsRailItem[]>(
    () =>
      annotationThreads
        .map((thread) => {
          const anchorTop = sourceMode
            ? null
            : (geometry.anchorTopByThreadId[thread.id] ?? null)
          return {
            thread,
            placement:
              typeof anchorTop === 'number'
                ? { status: 'positioned' as const, anchorTop }
                : { status: 'unavailable' as const },
          }
        })
        .sort((left, right) => {
          const leftTop =
            left.placement.status === 'positioned'
              ? left.placement.anchorTop
              : null
          const rightTop =
            right.placement.status === 'positioned'
              ? right.placement.anchorTop
              : null
          if (leftTop !== null && rightTop !== null && leftTop !== rightTop)
            return leftTop - rightTop
          if (leftTop !== null) return -1
          if (rightTop !== null) return 1
          return (
            Date.parse(left.thread.createdAt) -
            Date.parse(right.thread.createdAt)
          )
        }),
    [annotationThreads, geometry.anchorTopByThreadId, sourceMode]
  )
  const navigableThreadIds = useMemo(
    () =>
      railThreads
        .filter(
          (item) =>
            item.placement.status === 'positioned' &&
            item.thread.anchorStatus !== 'orphaned'
        )
        .map((item) => item.thread.id),
    [railThreads]
  )
  const activeNavigableIndex = activeThreadId
    ? navigableThreadIds.indexOf(activeThreadId)
    : -1
  const previousThreadId =
    activeNavigableIndex > 0
      ? (navigableThreadIds[activeNavigableIndex - 1] ?? null)
      : null
  const nextThreadId =
    activeNavigableIndex === -1
      ? (navigableThreadIds[0] ?? null)
      : (navigableThreadIds[activeNavigableIndex + 1] ?? null)
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
    if (
      !activeThreadId ||
      annotationThreads.some((thread) => thread.id === activeThreadId)
    )
      return
    setActiveThreadId(null)
  }, [activeThreadId, annotationThreads])
  useLayoutEffect(() => {
    scheduleGeometry()
  }, [commentsOpen, isCompact, scheduleGeometry])
  const setCommentPanelOpen = useCallback(
    (open: boolean) => {
      commentsTouchedRef.current = true
      if (isCompact) setCompactCommentsOpen(open)
      else setCommentsOpen(open)
    },
    [isCompact]
  )
  const setCommentAnchorLayerRef = useCallback(
    (element: HTMLDivElement | null) => {
      commentAnchorLayerRef.current = element
      setCommentAnchorLayerScrollTransform(
        element,
        editorContainerRef.current?.scrollTop ?? 0
      )
    },
    []
  )
  const flushEditorScroll = useCallback(() => {
    editorScrollFrameRef.current = null
    setCommentAnchorLayerScrollTransform(
      commentAnchorLayerRef.current,
      editorContainerRef.current?.scrollTop ?? 0
    )
  }, [])
  const handleEditorScroll = useCallback(() => {
    if (editorScrollFrameRef.current !== null) return
    editorScrollFrameRef.current =
      window.requestAnimationFrame(flushEditorScroll)
  }, [flushEditorScroll])
  const scrollToThread = useCallback(
    (threadId: string) => {
      pendingDiscussion?.cancel()
      const scroller = editorContainerRef.current
      const anchorTop = geometry.anchorTopByThreadId[threadId]
      if (!scroller || typeof anchorTop !== 'number') return
      const top = Math.max(0, anchorTop - COMMENT_SCROLL_SAFE_INSET)
      setActiveThreadId(threadId)
      if (typeof scroller.scrollTo === 'function')
        scroller.scrollTo({ top, behavior: 'instant' })
      else scroller.scrollTop = top
      setCommentAnchorLayerScrollTransform(commentAnchorLayerRef.current, top)
    },
    [geometry.anchorTopByThreadId, pendingDiscussion?.cancel]
  )
  const focusThreadFromRail = useCallback(
    (threadId: string) => {
      pendingDiscussion?.cancel()
      setActiveThreadId(threadId)
      scrollToThread(threadId)
    },
    [scrollToThread, pendingDiscussion?.cancel]
  )
  const handleCommentsWheel = useCallback(
    (event: WheelEvent) => {
      if (event.deltaY === 0) return
      const scroller = editorContainerRef.current
      if (!scroller) return
      event.preventDefault()
      scroller.scrollTop += normalizeWheelDelta(event, scroller.clientHeight)
      handleEditorScroll()
    },
    [handleEditorScroll]
  )
  const refreshAfterSave = useCallback(async () => {
    await annotations.refresh()
    setCommentBaselineRevision((revision) => revision + 1)
  }, [annotations.refresh])
  useEffect(
    () => () => {
      if (editorScrollFrameRef.current !== null)
        window.cancelAnimationFrame(editorScrollFrameRef.current)
    },
    []
  )
  const commentBottomCompensation =
    commentsOpen && !isCompact && !sourceMode
      ? Math.max(
          0,
          Math.ceil(commentAnchoredDocumentHeight - geometry.naturalHeight)
        )
      : 0
  return {
    activeThreadId,
    cancelPendingLocation: pendingDiscussion?.cancel,
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
      loading:
        annotations.loading ||
        Boolean(pendingDiscussion?.location && annotations.refreshing),
      onAnchoredHeightChange: setCommentAnchoredDocumentHeight,
      onDeleteComment: annotations.deleteComment,
      onFocusThread: focusThreadFromRail,
      onNavigateNext: nextThreadId
        ? () => scrollToThread(nextThreadId)
        : undefined,
      onNavigatePrevious: previousThreadId
        ? () => scrollToThread(previousThreadId)
        : undefined,
      onRefresh: () => {
        void annotations.refresh()
      },
      onReply: annotations.reply,
      onUpdateComment: annotations.updateComment,
      onUpdateThreadStatus: annotations.updateThreadStatus,
      threads: railThreads,
    },
    scheduleGeometry,
    setCommentPanelOpen,
    sourceMode,
  }
}
export type DriveDocumentEditorCommentsController = ReturnType<
  typeof useDriveDocumentEditorComments
>
export function DriveDocumentEditorCommentsFrame({
  comments,
  dataAttributes,
  editorView,
  afterEditorView,
  onEditorContentHostChange,
  onEditorContainerChange,
  outline,
  outlineDividerAlwaysVisible = false,
}: {
  readonly comments: DriveDocumentEditorCommentsController
  readonly dataAttributes: DriveDocumentEditorCommentsDataAttributes
  readonly editorView: ReactNode
  readonly afterEditorView?: ReactNode
  readonly onEditorContentHostChange?: (element: HTMLDivElement | null) => void
  readonly onEditorContainerChange?: (element: HTMLDivElement | null) => void
  readonly outline?: DriveDocumentEditorOutlineController
  readonly outlineDividerAlwaysVisible?: boolean
}) {
  const setEditorContainerRef = useCallback(
    (element: HTMLDivElement | null) => {
      comments.editorContainerRef.current = element
      onEditorContainerChange?.(element)
    },
    [comments.editorContainerRef, onEditorContainerChange]
  )
  const setEditorContentHostRef = useCallback(
    (element: HTMLDivElement | null) => {
      comments.editorContentHostRef.current = element
      onEditorContentHostChange?.(element)
    },
    [comments.editorContentHostRef, onEditorContentHostChange]
  )
  const renderCommentsRail = (mode: 'anchored' | 'list') => (
    <DriveCommentsRail
      {...comments.renderRailProps}
      mode={mode}
      anchorLayerRef={
        mode === 'anchored'
          ? comments.renderRailProps.anchorLayerRef
          : undefined
      }
      onAnchoredHeightChange={
        mode === 'anchored'
          ? comments.renderRailProps.onAnchoredHeightChange
          : undefined
      }
      onAnchoredWheel={
        mode === 'anchored' ? comments.handleCommentsWheel : undefined
      }
    />
  )
  const selectOutlineItem = (id: string) => {
    comments.cancelPendingLocation?.()
    outline?.selectItem(id)
  }
  const editorSurface = (
    <div
      ref={setEditorContainerRef}
      {...{ [dataAttributes.scroll]: 'true' }}
      className='h-full min-h-0 overflow-auto overscroll-contain bg-surface'
      onWheelCapture={() => comments.cancelPendingLocation?.()}
      onScroll={() => {
        comments.handleEditorScroll()
        outline?.handleEditorScroll()
      }}
    >
      <div
        ref={setEditorContentHostRef}
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
                  'absolute mix-blend-multiply',
                  rect.threadId === comments.activeThreadId
                    ? 'bg-amber-300/80 ring-2 ring-amber-500/90'
                    : 'bg-amber-200/45'
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
      </div>
      {afterEditorView}
      {comments.commentBottomCompensation > 0 ? (
        <div
          aria-hidden
          {...{ [dataAttributes.bottomCompensation]: 'true' }}
          style={{ height: comments.commentBottomCompensation }}
        />
      ) : null}
    </div>
  )
  const commentsPanelDefaultSize = resizablePanelPercent(
    COMMENTS_PANEL_DEFAULT_SIZE
  )
  const commentsPanelMinSize = resizablePanelPercent(COMMENTS_PANEL_MIN_SIZE)
  const commentsPanelMaxSize = resizablePanelPercent(COMMENTS_PANEL_MAX_SIZE)
  const outlinePanelDefaultSize = resizablePanelPercent(
    DRIVE_DOCUMENT_OUTLINE_PANEL_DEFAULT_SIZE
  )
  const outlinePanelMinSize = resizablePanelPercent(
    DRIVE_DOCUMENT_OUTLINE_PANEL_MIN_SIZE
  )
  const outlinePanelMaxSize = resizablePanelPercent(
    DRIVE_DOCUMENT_OUTLINE_PANEL_MAX_SIZE
  )
  const outlinePanelOpen = Boolean(
    !comments.isCompact && outline?.enabled && outline.open
  )
  const commentsPanelOpen = !comments.isCompact && comments.commentsOpen
  const editorPanelDefaultSize = resizablePanelPercent(
    100 -
      (outlinePanelOpen ? DRIVE_DOCUMENT_OUTLINE_PANEL_DEFAULT_SIZE : 0) -
      (commentsPanelOpen ? COMMENTS_PANEL_DEFAULT_SIZE : 0)
  )
  return (
    <>
      <div
        {...{ [dataAttributes.layout]: 'true' }}
        className='min-h-0 flex-1 overflow-hidden'
      >
        <Group
          data-markdown-resizable-group='true'
          orientation='horizontal'
          className='h-full min-h-0 overflow-hidden'
        >
          {outlinePanelOpen && outline ? (
            <>
              <Panel
                data-markdown-resizable-panel='true'
                defaultSize={outlinePanelDefaultSize}
                minSize={outlinePanelMinSize}
                maxSize={outlinePanelMaxSize}
                data-panel-size={outlinePanelDefaultSize}
                data-panel-min-size={outlinePanelMinSize}
                data-panel-max-size={outlinePanelMaxSize}
                {...(dataAttributes.outlinePanel
                  ? { [dataAttributes.outlinePanel]: 'outline' }
                  : {})}
                className='h-full min-h-0 overflow-hidden'
              >
                <aside className='flex h-full min-h-0 flex-col overflow-hidden py-6'>
                  <p className='mb-2 shrink-0 px-4 text-xs font-medium text-muted md:px-6'>
                    目录
                  </p>
                  <nav
                    ref={outline.outlineScrollRef}
                    className='min-h-0 flex-1 overflow-y-auto px-4 md:px-6'
                    aria-label='目录'
                  >
                    <DriveDocumentOutlineTree
                      items={outline.items}
                      activeItemId={outline.activeItemId}
                      onSelect={selectOutlineItem}
                    />
                  </nav>
                </aside>
              </Panel>
              <PanelSeparator
                data-markdown-resizable-divider='true'
                className={cn(
                  'drive-document-divider',
                  outlineDividerAlwaysVisible &&
                    'drive-document-divider-visible'
                )}
              />
            </>
          ) : null}
          <Panel
            data-markdown-resizable-panel='true'
            defaultSize={editorPanelDefaultSize}
            minSize='35%'
            {...{ [dataAttributes.editorPanel]: 'editor' }}
            className='h-full min-h-0 min-w-0 overflow-hidden'
          >
            {editorSurface}
          </Panel>
          {commentsPanelOpen ? (
            <>
              <PanelSeparator
                data-markdown-resizable-divider='true'
                className='drive-document-divider'
              />
              <Panel
                data-markdown-resizable-panel='true'
                defaultSize={commentsPanelDefaultSize}
                minSize={commentsPanelMinSize}
                maxSize={commentsPanelMaxSize}
                {...{ [dataAttributes.commentsPanel]: 'comments' }}
                className='h-full min-h-0 overflow-hidden'
              >
                <aside className='h-full min-h-0 overflow-hidden bg-background'>
                  {renderCommentsRail(
                    comments.sourceMode ? 'list' : 'anchored'
                  )}
                </aside>
              </Panel>
            </>
          ) : null}
        </Group>
      </div>
      {comments.isCompact && outline?.enabled ? (
        <Drawer.Backdrop
          isOpen={outline.compactOpen}
          onOpenChange={outline.setPanelOpen}
        >
          <Drawer.Content placement={'left'}>
            <Drawer.Dialog
              data-drive-telemetry-scope='portal'
              {...(dataAttributes.outlineSheet
                ? { [dataAttributes.outlineSheet]: 'outline' }
                : {})}
              className='gap-0 overflow-hidden'
            >
              <Drawer.CloseTrigger />
              <Drawer.Header className='pr-14'>
                <Drawer.Heading>目录</Drawer.Heading>
                <p className='sr-only'>跳转到文档标题</p>
              </Drawer.Header>
              <nav
                ref={outline.outlineScrollRef}
                className='min-h-0 flex-1 overflow-auto px-4 pb-4'
                aria-label='目录'
              >
                <DriveDocumentOutlineTree
                  items={outline.items}
                  compact
                  activeItemId={outline.activeItemId}
                  onSelect={selectOutlineItem}
                />
              </nav>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      ) : null}
      {comments.isCompact && comments.annotationsEnabled ? (
        <Drawer.Backdrop
          isOpen={comments.compactCommentsOpen}
          onOpenChange={comments.setCommentPanelOpen}
        >
          <Drawer.Content placement={'right'}>
            <Drawer.Dialog
              data-drive-telemetry-scope='portal'
              {...{ [dataAttributes.sheet]: 'comments' }}
              className='gap-0 overflow-hidden'
            >
              <Drawer.CloseTrigger />
              <Drawer.Header className='sr-only'>
                <Drawer.Heading>评论</Drawer.Heading>
                <p>查看和管理文档评论</p>
              </Drawer.Header>
              <div className='min-h-0 flex-1 overflow-auto'>
                {renderCommentsRail('list')}
              </div>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      ) : null}
    </>
  )
}
function setCommentAnchorLayerScrollTransform(
  element: HTMLElement | null,
  scrollTop: number
): void {
  if (!element) return
  element.style.transform = `translate3d(0, ${-scrollTop}px, 0)`
}
function normalizeWheelDelta(
  event: Pick<WheelEvent, 'deltaMode' | 'deltaY'>,
  pageHeight: number
): number {
  if (event.deltaMode === 1) return event.deltaY * 16
  if (event.deltaMode === 2) return event.deltaY * pageHeight
  return event.deltaY
}
function resizablePanelPercent(value: number): ResizablePanelPercent {
  return `${value}%`
}
