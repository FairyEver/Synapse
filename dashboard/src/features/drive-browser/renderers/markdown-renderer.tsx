import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import 'github-markdown-css/github-markdown-light.css'
import {
  isDriveCommentableMarkdownItem,
  type DriveAnnotationSelectorsV2,
  type DriveAnnotationTargetDto,
  type DriveBrowserCollaborationCapabilityDto,
  type DriveBrowserEditDto,
  type DriveBrowserItemDto,
  type DriveBrowserPreviewDto,
  type DriveMarkdownProjectionImageDto,
  type DriveCollaborationJoinContext,
} from '@synapse/shared'
import { ListTree, MessageSquare, MessageSquarePlus } from 'lucide-react'
import * as Y from 'yjs'
import { ImageLightbox, type ImageLightboxPreview } from '@/components/image-lightbox'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useTheme } from '@/context/theme-provider'
import { useFilePreviewLayoutMode } from '@/features/file-browser/preview/file-preview-layout'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import type { DriveAnnotationContext } from '../use-drive-annotations'
import { useDriveAnnotations } from '../use-drive-annotations'
import { useDriveCollaboration } from '../collaboration/use-drive-collaboration'
import { DriveCodeRenderer } from './code-renderer'
import {
  DRIVE_HIERARCHICAL_LIST_MARKER_CLASSNAME,
  syncDriveHierarchicalListMarkers,
} from './drive-hierarchical-list-markers'
import type { DriveRendererEditContext } from './drive-renderer-shell'
import { renderMarkdownAnnotationHtml, resolveMarkdownAnnotationTextRange } from './markdown-annotation-render'
import { createMarkdownAnnotationAnchorFromSelection, createMarkdownImageAnnotationAnchor } from './markdown-annotation-target'
import { DriveCommentsRail, getCommentActionErrorMessage, type DriveCommentsRailItem } from '../drive-comments-rail'
import { MarkdownImageFallbacks } from './markdown-image-fallback'
import { MarkdownImageCommentsOverlay, type MarkdownImageThreadMarker } from './markdown-image-comments-overlay'
import { MarkdownCommentComposerPopover } from './markdown-comment-composer-popover'
import { InlineToolbar, type InlineToolbarAction } from './inline-toolbar'
import { renderDriveMermaidDiagrams, restoreDriveMermaidDiagrams } from './markdown-mermaid-renderer'
import {
  createMarkdownRenderedDomRange,
  createMarkdownRenderedTextModel,
  type MarkdownRenderedTextSegment,
} from './markdown-rendered-text'
import {
  DRIVE_DOCUMENT_OUTLINE_PANEL_DEFAULT_SIZE as MARKDOWN_OUTLINE_PANEL_DEFAULT_SIZE,
  DRIVE_DOCUMENT_OUTLINE_PANEL_MAX_SIZE as MARKDOWN_OUTLINE_PANEL_MAX_SIZE,
  DRIVE_DOCUMENT_OUTLINE_PANEL_MIN_SIZE as MARKDOWN_OUTLINE_PANEL_MIN_SIZE,
  DriveDocumentOutlineTree,
  flattenDriveDocumentOutline,
} from './drive-document-outline'
import { useRegisterDriveRendererToolbarItems, type DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

const MARKDOWN_BODY_CLASSNAME = cn(
  'markdown-body max-w-full [&_ul]:list-disc [&_ol]:list-decimal! [&_ul]:pl-6 [&_ol]:pl-6 [&_[data-drive-markdown-table-scroll="true"]]:max-w-full [&_[data-drive-markdown-table-scroll="true"]]:overflow-x-auto [&_table]:w-max [&_table]:min-w-full [&_table]:max-w-none [&_td:first-child]:whitespace-nowrap [&_th:first-child]:whitespace-nowrap [&_td:not(:first-child)]:min-w-56 [&_th:not(:first-child)]:min-w-56 [&_h4]:text-base! [&_h4]:leading-tight! [&_h5]:text-base! [&_h5]:leading-tight! [&_h6]:text-base! [&_h6]:leading-tight! [&_img[role="button"]]:cursor-zoom-in [&_img[role="button"]]:focus-visible:outline-none [&_img[role="button"]]:focus-visible:ring-2 [&_img[role="button"]]:focus-visible:ring-ring [&_img[role="button"]]:focus-visible:ring-offset-2',
  DRIVE_HIERARCHICAL_LIST_MARKER_CLASSNAME,
)
const MARKDOWN_COMMENTS_PANEL_DEFAULT_SIZE = 22
const MARKDOWN_COMMENTS_PANEL_MIN_SIZE = 17
const MARKDOWN_COMMENTS_PANEL_MAX_SIZE = 32
const COMMENT_SCROLL_SAFE_INSET = 24
const USER_DOCUMENT_SCROLL_IDLE_DELAY_MS = 160

type MarkdownDocumentScrollSource = 'idle' | 'user' | 'outline'

type ResizablePanelPercent = `${number}%`
type MarkdownWidthMode = 'reading' | 'wide'

type MarkdownAnnotationOverlayRect = {
  readonly key: string
  readonly kind: 'thread' | 'pending'
  readonly threadId: string | null
  readonly visible: boolean
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

type DriveMarkdownRendererProps = {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly annotationContext?: DriveAnnotationContext
  readonly editContext?: DriveRendererEditContext
  readonly collaboration?: DriveBrowserCollaborationCapabilityDto | null
  readonly collaborationContext?: DriveCollaborationJoinContext
}

export function DriveMarkdownRenderer(props: DriveMarkdownRendererProps) {
  const renderedHtml = props.preview.html?.trim()
  if (!renderedHtml) {
    return <DriveCodeRenderer current={props.current} preview={props.preview} edit={props.edit} editContext={props.editContext} collaboration={props.collaboration} collaborationContext={props.collaborationContext} />
  }
  return <DriveMarkdownBody {...props} renderedHtml={renderedHtml} />
}

function DriveMarkdownBody({
  current,
  preview,
  edit,
  annotationContext,
  editContext,
  collaboration,
  collaborationContext,
  renderedHtml,
}: DriveMarkdownRendererProps & { readonly renderedHtml: string }) {
  const liveCollaboration = useDriveCollaboration({
    itemId: current.id,
    context: collaborationContext ?? { kind: 'owner', itemId: current.id },
    capability: collaboration,
    onEpochReloadRequired: editContext?.reload,
  })
  const effectiveRenderedHtml = useMemo(
    () => restoreDriveMarkdownRelativeImageSources(
      liveCollaboration.state?.preview?.html ?? renderedHtml,
      preview.relativeImages ?? [],
    ),
    [liveCollaboration.state?.preview?.html, preview.relativeImages, renderedHtml]
  )
  const outline = liveCollaboration.state?.preview?.outline ?? preview.outline ?? []
  const projection = liveCollaboration.state?.preview?.projection ?? preview.markdownProjection
  const collaborationTextMatchesProjection = Boolean(liveCollaboration.session) && (
    liveCollaboration.state?.preview
      ? liveCollaboration.state.preview.stateVector === encodeStateVector(liveCollaboration.session!.doc)
      : preview.text === liveCollaboration.session!.text.toString()
  )
  const documentScrollRef = useRef<HTMLDivElement | null>(null)
  const documentInnerRef = useRef<HTMLDivElement | null>(null)
  const documentContentRef = useRef<HTMLDivElement | null>(null)
  const outlineScrollRef = useRef<HTMLElement | null>(null)
  const commentAnchorLayerRef = useRef<HTMLDivElement | null>(null)
  const documentScrollFrameRef = useRef<number | null>(null)
  const documentScrollSourceRef = useRef<MarkdownDocumentScrollSource>('idle')
  const userDocumentScrollIdleTimerRef = useRef<number | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const selectionRangeRef = useRef<Range | null>(null)
  const commentsTouchedRef = useRef(false)
  const layoutMode = useFilePreviewLayoutMode()
  const isCompact = layoutMode === 'compact'
  const { resolvedTheme } = useTheme()
  const outlineItems = useMemo(() => flattenDriveDocumentOutline(outline), [outline])
  const isAuthenticated = useAuthStore((state) => state.auth.isAuthenticated)
  const annotationsEnabled = isDriveCommentableMarkdownItem(current)
  const effectiveAnnotationContext = annotationsEnabled ? annotationContext : undefined
  const annotationStateKey = driveMarkdownAnnotationStateKey(current.id, edit?.currentVersionId ?? null, effectiveAnnotationContext)
  const annotations = useDriveAnnotations(effectiveAnnotationContext)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [compactPanel, setCompactPanel] = useState<'outline' | 'comments' | null>(null)
  const [widthMode, setWidthMode] = useState<MarkdownWidthMode>('reading')
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [pendingTarget, setPendingTarget] = useState<{
    readonly target: DriveAnnotationTargetDto
    readonly selectors: DriveAnnotationSelectorsV2
  } | null>(null)
  const [commentDraftOpen, setCommentDraftOpen] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [commentCreateError, setCommentCreateError] = useState<string | null>(null)
  const [commentAnchorBaseOffset, setCommentAnchorBaseOffset] = useState(0)
  const [commentAnchoredDocumentHeight, setCommentAnchoredDocumentHeight] = useState(0)
  const [documentNaturalHeight, setDocumentNaturalHeight] = useState(0)
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null)
  const [threadAnchorTopById, setThreadAnchorTopById] = useState<Record<string, number>>({})
  const [annotationOverlayRects, setAnnotationOverlayRects] = useState<readonly MarkdownAnnotationOverlayRect[]>([])
  const [textSelectionActive, setTextSelectionActive] = useState(false)
  const [previewImage, setPreviewImage] = useState<ImageLightboxPreview | null>(null)

  useEffect(() => {
    setActiveThreadId(null)
    setPendingTarget(null)
    selectionRangeRef.current = null
    setCommentDraftOpen(false)
    setCommentBody('')
    setCommentCreateError(null)
    setCommentAnchoredDocumentHeight(0)
    setDocumentNaturalHeight(0)
    setThreadAnchorTopById({})
    setAnnotationOverlayRects([])
    setTextSelectionActive(false)
    setPreviewImage(null)
    window.getSelection()?.removeAllRanges()
  }, [annotationStateKey])

  useEffect(() => {
    setActiveOutlineId((current) => current && outlineItems.some((item) => item.id === current)
      ? current
      : outlineItems[0]?.id ?? null)
  }, [outlineItems])

  useEffect(() => {
    setCompactPanel(null)
  }, [layoutMode])

  const annotated = useMemo(
    () => renderMarkdownAnnotationHtml(
      effectiveRenderedHtml,
      annotations.threads,
      liveCollaboration.state?.checkpointVersionId ?? edit?.currentVersionId ?? null,
      collaborationTextMatchesProjection && liveCollaboration.session && projection
        ? {
            sourceText: liveCollaboration.session.text.toString(),
            projection,
            resolveCrdtRange: liveCollaboration.session.resolveRelativeRange,
          }
        : null,
      projection,
    ),
    [
      annotations.threads,
      collaborationTextMatchesProjection,
      edit?.currentVersionId,
      effectiveRenderedHtml,
      liveCollaboration.session,
      liveCollaboration.state?.checkpointVersionId,
      liveCollaboration.state?.preview?.stateVector,
      projection,
    ]
  )
  const annotatedHtmlProperty = useMemo(
    () => ({ __html: annotated.html }),
    [annotated.html]
  )

  useLayoutEffect(() => {
    const root = bodyRef.current
    if (root) syncDriveHierarchicalListMarkers(root)
  }, [annotated.html, isCompact])

  useEffect(() => {
    const root = bodyRef.current
    if (!root) return
    const controller = new AbortController()
    void renderDriveMermaidDiagrams({ root, resolvedTheme, signal: controller.signal })
    return () => {
      controller.abort()
      restoreDriveMermaidDiagrams(root)
    }
  }, [annotated.html, isCompact, resolvedTheme])

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
    (): readonly DriveCommentsRailItem[] => sortedThreads.map((thread) => {
      const resolved = resolvedByThreadId.get(thread.id)
      const effectiveAnchor = thread.anchor && resolved?.positionStatus
        ? {
            ...thread.anchor,
            positionStatus: resolved.positionStatus,
            quoteStatus: resolved.quoteStatus ?? thread.anchor.quoteStatus,
            resolvedSourceRange: resolved.sourceRange ?? null,
            resolvedRenderedRange: resolved.renderedRange ?? thread.anchor.resolvedRenderedRange,
            confidence: resolved.confidence ?? thread.anchor.confidence,
          }
        : thread.anchor
      const effectiveThread = !resolved
        ? thread
        : { ...thread, anchorStatus: resolved.anchorStatus, anchor: effectiveAnchor }
      return {
        thread: effectiveThread,
        placement: resolved?.anchorStatus !== 'orphaned' && typeof threadAnchorTopById[thread.id] === 'number'
          ? { status: 'positioned', anchorTop: threadAnchorTopById[thread.id] }
          : { status: 'unavailable' },
      }
    }),
    [resolvedByThreadId, sortedThreads, threadAnchorTopById]
  )
  const navigableThreadIds = useMemo(
    () => railThreads
      .filter((item) => item.placement.status === 'positioned' && item.thread.anchorStatus !== 'orphaned')
      .map((item) => item.thread.id),
    [railThreads]
  )
  const activeNavigableIndex = activeThreadId ? navigableThreadIds.indexOf(activeThreadId) : -1
  const previousThreadId = activeNavigableIndex > 0
    ? navigableThreadIds[activeNavigableIndex - 1] ?? null
    : null
  const nextThreadId = activeNavigableIndex === -1
    ? navigableThreadIds[0] ?? null
    : navigableThreadIds[activeNavigableIndex + 1] ?? null
  const commentCount = railThreads.length
  const imageThreadMarkers = useMemo<readonly MarkdownImageThreadMarker[]>(() => {
    const threadIdsByImageId = new Map<string, string[]>()
    for (const thread of sortedThreads) {
      const resolved = resolvedByThreadId.get(thread.id)
      if (thread.target.kind !== 'image' || resolved?.anchorStatus !== 'attached' || !resolved.imageId) continue
      const threadIds = threadIdsByImageId.get(resolved.imageId) ?? []
      threadIds.push(thread.id)
      threadIdsByImageId.set(resolved.imageId, threadIds)
    }
    return [...threadIdsByImageId].map(([imageId, threadIds]) => ({ imageId, threadIds }))
  }, [resolvedByThreadId, sortedThreads])
  const activeImageId = activeThreadId ? resolvedByThreadId.get(activeThreadId)?.imageId ?? null : null

  useEffect(() => {
    if (!activeThreadId || railThreads.some((item) => item.thread.id === activeThreadId)) return
    setActiveThreadId(null)
  }, [activeThreadId, railThreads])

  const measureAnnotationLayout = useCallback(() => {
    const root = bodyRef.current
    if (!root) return
    const rootRect = root.getBoundingClientRect()
    const documentScroller = documentScrollRef.current
    const scrollerRect = documentScroller?.getBoundingClientRect()
    if (documentScroller && scrollerRect) {
      const nextBaseOffset = Math.round(rootRect.top - scrollerRect.top + documentScroller.scrollTop)
      setCommentAnchorBaseOffset((current) => current === nextBaseOffset ? current : nextBaseOffset)
      const contentHeight = documentContentRef.current?.getBoundingClientRect().height ?? 0
      const documentInnerStyle = documentInnerRef.current ? window.getComputedStyle(documentInnerRef.current) : null
      const paddingBottom = documentInnerStyle ? Number.parseFloat(documentInnerStyle.paddingBottom) || 0 : 0
      const nextNaturalHeight = Math.ceil(nextBaseOffset + contentHeight + paddingBottom)
      setDocumentNaturalHeight((current) => current === nextNaturalHeight ? current : nextNaturalHeight)
    }
    const renderedTextModel = createMarkdownRenderedTextModel(root, projection)
    const renderedTextSegments = renderedTextModel.segments
    const renderedText = renderedTextModel.text
    const nextAnchors: Record<string, number> = {}
    const nextRects: MarkdownAnnotationOverlayRect[] = []

    for (const item of annotated.resolved) {
      if (item.anchorStatus === 'orphaned') continue
      if (item.imageId) {
        const imageElement = findVisibleMarkdownCommentImage(root, item.imageId)
        if (imageElement) nextAnchors[item.threadId] = imageElement.getBoundingClientRect().top - rootRect.top
        continue
      }
      if (!item.range) continue
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

    if (pendingTarget?.target.kind === 'textRange') {
      const pending = resolveMarkdownAnnotationTextRange(pendingTarget.target, renderedText)
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
  }, [annotated.resolved, pendingTarget, projection])

  useEffect(() => {
    if (!liveCollaboration.state?.annotationRevision) return
    void annotations.refresh()
  }, [liveCollaboration.state?.annotationRevision])

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
    root.addEventListener('scroll', scheduleMeasurement, { capture: true, passive: true })
    return () => {
      observer.disconnect()
      root.removeEventListener('scroll', scheduleMeasurement, true)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [measureAnnotationLayout])

  useEffect(() => {
    if (isCompact || commentsTouchedRef.current || annotations.threads.length === 0) return
    setCommentsOpen(true)
  }, [annotations.threads.length, isCompact])

  const setCommentPanelOpen = useCallback((open: boolean) => {
    if (isCompact) {
      setCompactPanel(open ? 'comments' : null)
      return
    }
    commentsTouchedRef.current = true
    setCommentsOpen(open)
  }, [isCompact])

  const setOutlinePanelOpen = useCallback((open: boolean) => {
    if (isCompact) {
      setCompactPanel(open ? 'outline' : null)
      return
    }
    setOutlineOpen(open)
  }, [isCompact])

  const clearPendingComment = useCallback(() => {
    setPendingTarget(null)
    selectionRangeRef.current = null
    setTextSelectionActive(false)
    setCommentDraftOpen(false)
    setCommentBody('')
    setCommentCreateError(null)
    window.getSelection()?.removeAllRanges()
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(
        '[data-markdown-comments-header="true"] button[aria-label="刷新评论"]'
      )?.focus({ preventScroll: true })
    })
  }, [])

  const clearPendingSelectionAction = useCallback(() => {
    setPendingTarget(null)
    selectionRangeRef.current = null
    setTextSelectionActive(false)
    setCommentCreateError(null)
  }, [])

  const selectionToolbarActions = useMemo<readonly InlineToolbarAction[]>(() => [{
    id: 'add-comment',
    label: '添加评论',
    icon: MessageSquarePlus,
    onSelect: () => {
      setTextSelectionActive(false)
      window.getSelection()?.removeAllRanges()
      setCommentDraftOpen(true)
    },
  }], [])

  const toolbarItems = useMemo<readonly DriveRendererToolbarItem[]>(() => {
    const items: DriveRendererToolbarItem[] = []
    if (outline.length > 0) {
      items.push({
        kind: 'toggle',
        id: 'markdown-outline',
        label: '目录',
        icon: ListTree,
        compactPlacement: 'primary',
        pressed: isCompact ? compactPanel === 'outline' : outlineOpen,
        onPressedChange: setOutlinePanelOpen,
      })
    }
    if (annotationsEnabled) {
      items.push(
        {
          kind: 'toggle',
          id: 'markdown-comments',
          label: `评论 ${commentCount}`,
          icon: MessageSquare,
          compactPlacement: 'primary',
          pressed: isCompact ? compactPanel === 'comments' : commentsOpen,
          onPressedChange: setCommentPanelOpen,
        }
      )
    }
    if (!isCompact) {
      items.push({
        kind: 'menu',
        id: 'markdown-width-mode',
        label: '宽度',
        compactPlacement: 'primary',
        variant: 'ghost',
        selectedItemId: widthMode,
        items: [
          { id: 'reading', label: '阅读', onSelect: () => setWidthMode('reading') },
          { id: 'wide', label: '宽屏', onSelect: () => setWidthMode('wide') },
        ],
      })
    }
    return items
  }, [
    annotationsEnabled,
    commentCount,
    commentsOpen,
    compactPanel,
    isCompact,
    outline.length,
    outlineOpen,
    setCommentPanelOpen,
    setOutlinePanelOpen,
    widthMode,
  ])

  useRegisterDriveRendererToolbarItems('markdown', toolbarItems)

  const scrollToThread = (threadId: string) => {
    setActiveThreadId(threadId)
    const root = bodyRef.current
    const imageId = resolvedByThreadId.get(threadId)?.imageId
    const imageElement = root && imageId ? findVisibleMarkdownCommentImage(root, imageId) : null
    if (root && imageElement) {
      const rootRect = root.getBoundingClientRect()
      const imageRect = imageElement.getBoundingClientRect()
      scrollPreviewContainerToRect(root, {
        top: imageRect.top - rootRect.top,
        height: imageRect.height,
      })
      return
    }
    const overlayRect = findOverlayRectByThreadId(annotationOverlayRects, threadId, root)
    if (!root || !overlayRect) return
    scrollPreviewContainerToRect(root, overlayRect)
  }

  const focusThreadFromDocument = (threadId: string) => {
    setCommentPanelOpen(true)
    setActiveThreadId(threadId)
  }

  const focusThreadFromRail = (threadId: string) => {
    if (resolvedByThreadId.get(threadId)?.anchorStatus === 'orphaned') {
      setActiveThreadId(threadId)
      return
    }
    scrollToThread(threadId)
  }

  const syncSelectionActionFromCurrentSelection = useCallback(() => {
    if (!canCreateAnnotation || commentDraftOpen) return
    const root = bodyRef.current
    if (!root) return
    const selection = window.getSelection()
    const target = createMarkdownAnnotationAnchorFromSelection({
      root,
      selection,
      projection,
      epoch: liveCollaboration.state?.epoch,
      yText: liveCollaboration.session && collaborationTextMatchesProjection
        ? liveCollaboration.session.text
        : null,
    })
    if (!target || !selection || selection.rangeCount === 0) {
      if (!commentDraftOpen) clearPendingSelectionAction()
      return
    }
    selectionRangeRef.current = selection.getRangeAt(0).cloneRange()
    setPendingTarget(target)
  }, [canCreateAnnotation, clearPendingSelectionAction, collaborationTextMatchesProjection, commentDraftOpen, liveCollaboration.session, liveCollaboration.state?.epoch, projection])

  useEffect(() => {
    if (!canCreateAnnotation) return
    document.addEventListener('keyup', syncSelectionActionFromCurrentSelection)
    return () => {
      document.removeEventListener('keyup', syncSelectionActionFromCurrentSelection)
    }
  }, [canCreateAnnotation, syncSelectionActionFromCurrentSelection])

  useEffect(() => {
    const root = bodyRef.current
    if (!root) return
    const syncTextSelectionState = () => setTextSelectionActive(hasSelectionWithin(root))
    document.addEventListener('selectionchange', syncTextSelectionState)
    return () => document.removeEventListener('selectionchange', syncTextSelectionState)
  }, [])

  const updateActiveOutline = useCallback(() => {
    const scroller = documentScrollRef.current
    const body = bodyRef.current
    if (!scroller || !body || outlineItems.length === 0) return
    const threshold = scroller.getBoundingClientRect().top + 24
    let nextActiveId = outlineItems[0]?.id ?? null
    for (const item of outlineItems) {
      const heading = findMarkdownHeadingById(body, item.id)
      if (!heading) continue
      if (heading.getBoundingClientRect().top > threshold) break
      nextActiveId = item.id
    }
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) {
      nextActiveId = outlineItems[outlineItems.length - 1]?.id ?? nextActiveId
    }
    setActiveOutlineId((current) => current === nextActiveId ? current : nextActiveId)
  }, [outlineItems])

  const scheduleUserDocumentScrollIdle = useCallback(() => {
    if (userDocumentScrollIdleTimerRef.current !== null) {
      window.clearTimeout(userDocumentScrollIdleTimerRef.current)
    }
    userDocumentScrollIdleTimerRef.current = window.setTimeout(() => {
      userDocumentScrollIdleTimerRef.current = null
      if (documentScrollSourceRef.current === 'user') documentScrollSourceRef.current = 'idle'
    }, USER_DOCUMENT_SCROLL_IDLE_DELAY_MS)
  }, [])

  const markDocumentScrollAsUserControlled = useCallback(() => {
    documentScrollSourceRef.current = 'user'
    scheduleUserDocumentScrollIdle()
  }, [scheduleUserDocumentScrollIdle])

  const flushDocumentScrollEffects = useCallback(() => {
    documentScrollFrameRef.current = null
    const scroller = documentScrollRef.current
    if (!scroller) return
    setCommentAnchorLayerScrollTransform(commentAnchorLayerRef.current, scroller.scrollTop)
    if (documentScrollSourceRef.current === 'user') updateActiveOutline()
    if (documentScrollSourceRef.current === 'outline') documentScrollSourceRef.current = 'idle'
  }, [updateActiveOutline])

  const scheduleDocumentScrollEffects = useCallback(() => {
    if (documentScrollFrameRef.current !== null) return
    documentScrollFrameRef.current = window.requestAnimationFrame(flushDocumentScrollEffects)
  }, [flushDocumentScrollEffects])

  const handleDocumentScroll = useCallback(() => {
    if (documentScrollSourceRef.current === 'user') scheduleUserDocumentScrollIdle()
    scheduleDocumentScrollEffects()
  }, [scheduleDocumentScrollEffects, scheduleUserDocumentScrollIdle])

  const handleDocumentScrollKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isMarkdownDocumentScrollKey(event.key)) markDocumentScrollAsUserControlled()
  }, [markDocumentScrollAsUserControlled])

  useEffect(() => () => {
    if (documentScrollFrameRef.current !== null) window.cancelAnimationFrame(documentScrollFrameRef.current)
    if (userDocumentScrollIdleTimerRef.current !== null) window.clearTimeout(userDocumentScrollIdleTimerRef.current)
  }, [])

  useLayoutEffect(() => {
    setCommentAnchorLayerScrollTransform(commentAnchorLayerRef.current, documentScrollRef.current?.scrollTop ?? 0)
  }, [commentsOpen, isCompact, outlineOpen, widthMode])

  useEffect(() => {
    if (!activeOutlineId) return
    const outlineScroller = outlineScrollRef.current
    const activeLink = outlineScroller
      ? Array.from(outlineScroller.querySelectorAll<HTMLElement>('[data-markdown-outline-id]'))
        .find((element) => element.dataset.markdownOutlineId === activeOutlineId)
      : null
    if (!outlineScroller || !activeLink) return
    const scrollerRect = outlineScroller.getBoundingClientRect()
    const linkRect = activeLink.getBoundingClientRect()
    if (linkRect.top < scrollerRect.top || linkRect.bottom > scrollerRect.bottom) {
      activeLink.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    }
  }, [activeOutlineId])

  const scrollToOutlineItem = useCallback((itemId: string) => {
    const scroller = documentScrollRef.current
    const body = bodyRef.current
    const heading = body ? findMarkdownHeadingById(body, itemId) : null
    if (!scroller || !heading) return
    const targetTop = Math.max(
      0,
      scroller.scrollTop
        + heading.getBoundingClientRect().top
        - scroller.getBoundingClientRect().top
        - 24
    )
    setActiveOutlineId(itemId)
    if (userDocumentScrollIdleTimerRef.current !== null) {
      window.clearTimeout(userDocumentScrollIdleTimerRef.current)
      userDocumentScrollIdleTimerRef.current = null
    }
    documentScrollSourceRef.current = 'outline'
    if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top: targetTop, behavior: 'instant' })
    } else {
      scroller.scrollTop = targetTop
    }
    scheduleDocumentScrollEffects()
  }, [scheduleDocumentScrollEffects])

  const setCommentAnchorLayerRef = useCallback((element: HTMLDivElement | null) => {
    commentAnchorLayerRef.current = element
    setCommentAnchorLayerScrollTransform(element, documentScrollRef.current?.scrollTop ?? 0)
  }, [])

  const handleCommentsWheel = useCallback((event: WheelEvent) => {
    if (event.deltaY === 0) return
    const scroller = documentScrollRef.current
    if (!scroller) return
    event.preventDefault()
    scroller.scrollTop += normalizeWheelDelta(event, scroller.clientHeight)
    scheduleDocumentScrollEffects()
  }, [scheduleDocumentScrollEffects])

  const startImageComment = useCallback((image: DriveMarkdownProjectionImageDto) => {
    if (!projection) return
    const pending = createMarkdownImageAnnotationAnchor({
      image,
      projection,
      epoch: liveCollaboration.state?.epoch,
      yText: liveCollaboration.session && collaborationTextMatchesProjection
        ? liveCollaboration.session.text
        : null,
    })
    setPendingTarget(pending)
    selectionRangeRef.current = null
    setCommentCreateError(null)
    setCommentDraftOpen(true)
  }, [collaborationTextMatchesProjection, liveCollaboration.session, liveCollaboration.state?.epoch, projection])

  const focusImageThreads = useCallback((marker: MarkdownImageThreadMarker) => {
    setCommentPanelOpen(true)
    const currentThreadIsOnImage = activeThreadId
      ? marker.threadIds.includes(activeThreadId)
      : false
    if (!currentThreadIsOnImage) setActiveThreadId(marker.threadIds[0] ?? null)
  }, [activeThreadId, setCommentPanelOpen])

  const openImagePreview = (image: HTMLImageElement) => {
    const root = bodyRef.current
    if (!root) return
    const entries = Array.from(root.querySelectorAll<HTMLImageElement>('img[src]')).flatMap((element) => {
      const src = element.currentSrc || element.getAttribute('src')
      return src ? [{ element, image: { alt: element.alt, src } }] : []
    })
    const initialIndex = entries.findIndex((entry) => entry.element === image)
    if (initialIndex < 0) return
    setPreviewImage({ images: entries.map((entry) => entry.image), initialIndex, trigger: image })
  }

  const handleBodyClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const image = findMarkdownPreviewImage(event.target, event.currentTarget)
    if (image) {
      event.preventDefault()
      openImagePreview(image)
      return
    }
    if (hasSelectionWithin(event.currentTarget)) return
    const threadId = findOverlayThreadAtPoint(annotationOverlayRects, event.clientX, event.clientY, bodyRef.current)
      ?? findRenderedOverlayThreadAtPoint(event.clientX, event.clientY, bodyRef.current)
    if (!threadId) return
    focusThreadFromDocument(threadId)
  }

  const handleBodyKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const image = findMarkdownPreviewImage(event.target, event.currentTarget)
    if (!image) return
    event.preventDefault()
    openImagePreview(image)
  }

  const closeImagePreview = () => {
    setPreviewImage(null)
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
  const commentBottomCompensation = commentsOpen && !isCompact
    ? Math.max(0, Math.ceil(commentAnchoredDocumentHeight - documentNaturalHeight))
    : 0

  const createThread = async () => {
    if (!pendingTarget || !commentBody.trim()) return
    setCommentCreateError(null)
    try {
      const thread = await annotations.createThread({
        ...((liveCollaboration.state?.checkpointVersionId ?? edit?.currentVersionId)
          ? { baseVersionId: liveCollaboration.state?.checkpointVersionId ?? edit?.currentVersionId }
          : {}),
        epoch: liveCollaboration.state?.epoch ?? null,
        stateVector: liveCollaboration.session ? encodeStateVector(liveCollaboration.session.doc) : null,
        selectors: pendingTarget.selectors,
        idempotencyKey: crypto.randomUUID(),
        targetKind: pendingTarget.target.kind,
        target: pendingTarget.target,
        body: commentBody,
      })
      setActiveThreadId(thread.id)
      setCommentPanelOpen(true)
      setPendingTarget(null)
      selectionRangeRef.current = null
      setCommentDraftOpen(false)
      setCommentBody('')
      window.getSelection()?.removeAllRanges()
    } catch (cause) {
      setCommentCreateError(getCommentActionErrorMessage(cause))
    }
  }

  const documentView = (
    <div
      ref={documentScrollRef}
      data-testid='markdown-document-scroll'
      className='h-full min-h-0 min-w-0 overflow-y-auto overscroll-contain'
      onScroll={handleDocumentScroll}
      onWheelCapture={markDocumentScrollAsUserControlled}
      onTouchMoveCapture={markDocumentScrollAsUserControlled}
      onKeyDownCapture={handleDocumentScrollKeyDown}
      onPointerDownCapture={(event) => {
        if (event.target === event.currentTarget) markDocumentScrollAsUserControlled()
      }}
    >
      <div ref={documentInnerRef} className='min-h-full px-4 py-6 md:px-6'>
        <div
          ref={documentContentRef}
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
            onKeyDown={handleBodyKeyDown}
            onPointerUp={syncSelectionActionFromCurrentSelection}
            dangerouslySetInnerHTML={annotatedHtmlProperty}
          />
          <MarkdownImageFallbacks contentKey={annotated.html} rootRef={bodyRef} />
          <MarkdownImageCommentsOverlay
            contentKey={`${annotated.html}\0${layoutMode}`}
            rootRef={bodyRef}
            containerRef={documentContentRef}
            scrollRef={documentScrollRef}
            images={projection?.images ?? []}
            markers={imageThreadMarkers}
            activeImageId={activeImageId}
            commentTargetImageId={pendingTarget?.target.kind === 'image' ? pendingTarget.target.imageId : null}
            canCreate={canCreateAnnotation && !isCompact && !commentDraftOpen && !annotations.creatingThread}
            onAddComment={startImageComment}
            onFocusThreads={focusImageThreads}
          />
          {annotationOverlayRects.length > 0 ? (
            <div
              aria-hidden
              data-drive-annotation-overlay-layer='true'
              className={cn('pointer-events-none absolute inset-0', textSelectionActive && 'opacity-0')}
            >
              {annotationOverlayRects.filter((rect) => rect.visible).map((rect) => (
                <div
                  key={rect.key}
                  data-drive-annotation-overlay-kind={rect.kind}
                  data-drive-annotation-overlay-thread-id={rect.threadId ?? undefined}
                  className={cn(
                    'absolute mix-blend-multiply dark:mix-blend-screen',
                    rect.kind === 'pending'
                      ? 'bg-amber-200/60 ring-1 ring-amber-400/80 dark:bg-amber-800/45 dark:ring-amber-500/80'
                      : rect.threadId === activeThreadId
                        ? 'bg-amber-300/80 ring-2 ring-amber-500/90 dark:bg-amber-700/55 dark:ring-amber-400/90'
                        : 'bg-amber-200/45 dark:bg-amber-800/30'
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
        {commentBottomCompensation > 0 ? (
          <div
            aria-hidden
            data-markdown-comment-bottom-compensation='true'
            style={{ height: commentBottomCompensation }}
          />
        ) : null}
      </div>
    </div>
  )

  const commentComposerAnchor = commentDraftOpen && pendingTarget
    ? pendingTarget.target.kind === 'textRange'
      ? selectionRangeRef.current
      : bodyRef.current
        ? findVisibleMarkdownCommentImage(bodyRef.current, pendingTarget.target.imageId)
        : null
    : null

  const renderCommentsRail = (mode: 'anchored' | 'list') => (
    <DriveCommentsRail
      mode={mode}
      threads={railThreads}
      activeThreadId={activeThreadId}
      canReply={canCreateAnnotation}
      loading={annotations.loading}
      anchorBaseOffset={commentAnchorBaseOffset}
      anchorLayerRef={mode === 'anchored' ? setCommentAnchorLayerRef : undefined}
      onAnchoredHeightChange={mode === 'anchored' ? setCommentAnchoredDocumentHeight : undefined}
      onAnchoredWheel={mode === 'anchored' ? handleCommentsWheel : undefined}
      onFocusThread={focusThreadFromRail}
      onNavigatePrevious={previousThreadId ? () => scrollToThread(previousThreadId) : undefined}
      onNavigateNext={nextThreadId ? () => scrollToThread(nextThreadId) : undefined}
      onRefresh={() => { void annotations.refresh() }}
      onReply={annotations.reply}
      onUpdateComment={annotations.updateComment}
      onDeleteComment={annotations.deleteComment}
    />
  )

  return (
    <div className='h-full min-h-0 overflow-hidden bg-background'>
      {commentDraftOpen && pendingTarget ? (
        <MarkdownCommentComposerPopover
          anchor={commentComposerAnchor}
          boundaryRef={documentScrollRef}
          value={commentBody}
          submitting={annotations.creatingThread}
          error={commentCreateError}
          onValueChange={(value) => {
            setCommentBody(value)
            if (commentCreateError) setCommentCreateError(null)
          }}
          onSubmit={() => { void createThread() }}
          onCancel={clearPendingComment}
        />
      ) : null}
      {selectionRangeRef.current && pendingTarget?.target.kind === 'textRange' && !commentDraftOpen ? (
        <InlineToolbar
          data-drive-annotation-selection-action
          anchor={selectionRangeRef.current}
          actions={selectionToolbarActions}
        />
      ) : null}
      <div data-testid='markdown-layout' className='h-full min-h-0 w-full overflow-hidden'>
        {isCompact ? documentView : (
          <ResizablePanelGroup orientation='horizontal' className='h-full min-h-0 overflow-hidden'>
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
                  className='h-full min-h-0 overflow-hidden'
                >
                  <aside className='flex h-full min-h-0 flex-col overflow-hidden py-6'>
                    <p className='mb-2 shrink-0 px-4 text-xs font-medium text-muted-foreground md:px-6'>目录</p>
                    <nav ref={outlineScrollRef} className='min-h-0 flex-1 overflow-y-auto px-4 md:px-6' aria-label='目录'>
                      <DriveDocumentOutlineTree
                        items={outline}
                        activeItemId={activeOutlineId}
                        onSelect={scrollToOutlineItem}
                      />
                    </nav>
                  </aside>
                </ResizablePanel>
                <ResizableHandle autoHide />
              </>
            ) : null}
            <ResizablePanel
              defaultSize={documentPanelDefaultSize}
              minSize='35%'
              data-markdown-resizable-panel='document'
              className='h-full min-h-0 min-w-0 overflow-hidden'
            >
              {documentView}
            </ResizablePanel>
            {commentsOpen ? (
              <>
                <ResizableHandle />
                <ResizablePanel
                  defaultSize={commentsPanelDefaultSize}
                  minSize={commentsPanelMinSize}
                  maxSize={commentsPanelMaxSize}
                  data-panel-size={commentsPanelDefaultSize}
                  data-panel-min-size={commentsPanelMinSize}
                  data-panel-max-size={commentsPanelMaxSize}
                  data-markdown-resizable-panel='comments'
                  className='h-full min-h-0 overflow-hidden'
                >
                  <aside className='h-full min-h-0 self-stretch overflow-hidden bg-background'>
                    {renderCommentsRail('anchored')}
                  </aside>
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        )}
      </div>
      {isCompact && outline.length > 0 ? (
        <Sheet
          open={compactPanel === 'outline'}
          onOpenChange={(open) => setOutlinePanelOpen(open)}
        >
          <SheetContent data-drive-telemetry-scope='portal' side='left' data-markdown-sheet='outline' className='gap-0 overflow-hidden'>
            <SheetHeader className='pr-14'>
              <SheetTitle>目录</SheetTitle>
              <SheetDescription className='sr-only'>跳转到文档标题</SheetDescription>
            </SheetHeader>
            <nav className='min-h-0 flex-1 overflow-auto px-4 pb-4' aria-label='目录'>
              <DriveDocumentOutlineTree
                items={outline}
                compact
                activeItemId={activeOutlineId}
                onSelect={(itemId) => {
                  scrollToOutlineItem(itemId)
                  setCompactPanel(null)
                }}
              />
            </nav>
          </SheetContent>
        </Sheet>
      ) : null}
      {isCompact && annotationsEnabled ? (
        <Sheet
          open={compactPanel === 'comments'}
          onOpenChange={(open) => setCommentPanelOpen(open)}
        >
          <SheetContent
            data-drive-telemetry-scope='portal'
            side='right'
            data-markdown-sheet='comments'
            className='gap-0 overflow-hidden'
            onEscapeKeyDown={(event) => {
              if (isMarkdownCommentComposerTarget(event.target)) event.preventDefault()
            }}
          >
            <SheetHeader className='sr-only'>
              <SheetTitle>评论</SheetTitle>
              <SheetDescription>查看和管理文档评论</SheetDescription>
            </SheetHeader>
            <div className='min-h-0 flex-1 overflow-auto'>
              {renderCommentsRail('list')}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
      {annotations.error ? (
        <div className='border-t px-3 py-2 text-xs text-muted-foreground'>{annotations.error}</div>
      ) : null}
      {previewImage ? <ImageLightbox preview={previewImage} onClose={closeImagePreview} /> : null}
      {annotated.resolved.some((item) => item.anchorStatus === 'orphaned') ? (
        <div className='sr-only'>原文已修改或删除</div>
      ) : null}
    </div>
  )
}

function findMarkdownPreviewImage(target: EventTarget | null, root: HTMLElement): HTMLImageElement | null {
  return target instanceof HTMLImageElement && root.contains(target) && target.hasAttribute('src')
    ? target
    : null
}

function isMarkdownDocumentScrollKey(key: string): boolean {
  return key === 'ArrowUp'
    || key === 'ArrowDown'
    || key === 'PageUp'
    || key === 'PageDown'
    || key === 'Home'
    || key === 'End'
    || key === ' '
}

function findVisibleMarkdownCommentImage(root: HTMLElement, imageId: string): HTMLElement | null {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-drive-markdown-image-id]'))
    .filter((element) => element.dataset.driveMarkdownImageId === imageId && !element.hidden)
  return candidates.find((element) => element.hasAttribute('data-drive-markdown-image-fallback-host'))
    ?? candidates.find((element) => element.tagName === 'IMG')
    ?? null
}

function encodeStateVector(doc: Y.Doc): string {
  const value = Y.encodeStateVector(doc)
  let binary = ''
  for (let index = 0; index < value.length; index += 1) binary += String.fromCharCode(value[index] ?? 0)
  return btoa(binary)
}

function findMarkdownHeadingById(root: HTMLElement, itemId: string): HTMLElement | null {
  const element = root.ownerDocument.getElementById(itemId)
  return element && root.contains(element) ? element : null
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

function driveMarkdownAnnotationStateKey(
  currentId: string,
  currentVersionId: string | null,
  annotationContext: DriveAnnotationContext | undefined
): string {
  if (!annotationContext) return `${currentId}\0${currentVersionId ?? ''}\0none`
  if (annotationContext.context === 'owner') {
    return `${currentId}\0${currentVersionId ?? ''}\0owner\0${annotationContext.itemId ?? ''}`
  }
  return `${currentId}\0${currentVersionId ?? ''}\0share\0${annotationContext.shareId}\0${annotationContext.itemId ?? ''}`
}

function restoreDriveMarkdownRelativeImageSources(
  html: string,
  relativeImages: readonly { readonly src: string; readonly resolvedUrl: string | null }[],
): string {
  if (!html.includes('data-drive-markdown-relative-src')) return html
  const template = document.createElement('template')
  template.innerHTML = html
  const resolvedUrls = new Map(relativeImages.map((image) => [relativeImageSourceKey(image.src), image.resolvedUrl]))
  for (const image of template.content.querySelectorAll<HTMLImageElement>('img[data-drive-markdown-relative-src]')) {
    const source = image.getAttribute('data-drive-markdown-relative-src') ?? ''
    const resolvedUrl = resolvedUrls.get(relativeImageSourceKey(source))
    if (resolvedUrl) image.setAttribute('src', resolvedUrl)
    else image.removeAttribute('src')
  }
  return template.innerHTML
}

function relativeImageSourceKey(source: string): string {
  const trimmed = source.trim()
  const queryIndex = trimmed.indexOf('?')
  const fragmentIndex = trimmed.indexOf('#')
  const suffixStart = queryIndex < 0
    ? fragmentIndex
    : fragmentIndex < 0 ? queryIndex : Math.min(queryIndex, fragmentIndex)
  const path = suffixStart < 0 ? trimmed : trimmed.slice(0, suffixStart)
  const suffix = suffixStart < 0 ? '' : trimmed.slice(suffixStart)
  try {
    return JSON.stringify([path.split('/').map((segment) => decodeURIComponent(segment).normalize('NFC')), suffix])
  } catch {
    return trimmed
  }
}

function measureRenderedTextRange(
  root: HTMLElement,
  segments: readonly MarkdownRenderedTextSegment[],
  range: { readonly start: number; readonly end: number },
  rootRect: DOMRect,
): Array<Omit<MarkdownAnnotationOverlayRect, 'key' | 'kind' | 'threadId'>> {
  const domRange = createMarkdownRenderedDomRange(root, segments, range.start, range.end)
  if (!domRange) return []
  const rects = typeof domRange.getClientRects === 'function'
    ? Array.from(domRange.getClientRects())
    : [domRange.getBoundingClientRect()]
  const clipRect = findMarkdownTableScrollClipRect(domRange, root)
  domRange.detach()
  const preciseRects = removeContainerOverlayRects(rects.filter((rect) => clipRect
    ? rect.width > 2 && rect.height > 0
    : isUsableOverlayRect(rect, rootRect)))
  return preciseRects.map((rect) => {
    const clipped = clipRect ? intersectOverlayRect(rect, clipRect) : rect
    const visible = Boolean(clipped && isUsableOverlayRect(clipped, rootRect))
    const measured = visible && clipped ? clipped : rect
    return {
      visible,
      top: measured.top - rootRect.top,
      left: measured.left - rootRect.left,
      width: measured.width,
      height: measured.height,
    }
  })
}

type OverlayClientRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>

function findMarkdownTableScrollClipRect(range: Range, root: HTMLElement): DOMRect | null {
  const ancestor = range.commonAncestorContainer
  const element = ancestor instanceof Element ? ancestor : ancestor.parentElement
  const tableScroller = element?.closest<HTMLElement>('[data-drive-markdown-table-scroll="true"]')
  return tableScroller && root.contains(tableScroller) ? tableScroller.getBoundingClientRect() : null
}

function intersectOverlayRect(rect: OverlayClientRect, clipRect: OverlayClientRect): OverlayClientRect | null {
  const left = Math.max(rect.left, clipRect.left)
  const top = Math.max(rect.top, clipRect.top)
  const right = Math.min(rect.right, clipRect.right)
  const bottom = Math.min(rect.bottom, clipRect.bottom)
  const width = right - left
  const height = bottom - top
  return width > 2 && height > 0 ? { left, top, right, bottom, width, height } : null
}

function isUsableOverlayRect(rect: OverlayClientRect, rootRect: OverlayClientRect): boolean {
  if (rect.width <= 2 || rect.height <= 0) return false
  if (rootRect.width <= 0 && rootRect.height <= 0) return true
  return rect.right >= rootRect.left
    && rect.left <= rootRect.right
    && rect.bottom >= rootRect.top
    && rect.top <= rootRect.bottom
}

function removeContainerOverlayRects(rects: readonly OverlayClientRect[]): readonly OverlayClientRect[] {
  return rects.filter((rect, index) => {
    return !rects.some((other, otherIndex) => {
      return index !== otherIndex
        && containsOverlayRect(rect, other)
        && isMeaningfullyBroaderRect(rect, other)
    })
  })
}

function containsOverlayRect(container: OverlayClientRect, inner: OverlayClientRect): boolean {
  return inner.left >= container.left - 0.5
    && inner.right <= container.right + 0.5
    && inner.top >= container.top - 0.5
    && inner.bottom <= container.bottom + 0.5
}

function isMeaningfullyBroaderRect(container: OverlayClientRect, inner: OverlayClientRect): boolean {
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
    && rect.visible
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
  return { visible: true, top, left, width, height }
}

function scrollPreviewContainerToRect(root: HTMLElement, rect: Pick<MarkdownAnnotationOverlayRect, 'top' | 'height'>): void {
  const container = findNearestScrollContainer(root)
  if (!container) return
  const rootRect = root.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const rectTop = rootRect.top + rect.top
  const rectBottom = rectTop + rect.height
  const safeTop = containerRect.top + COMMENT_SCROLL_SAFE_INSET
  const safeBottom = containerRect.bottom - COMMENT_SCROLL_SAFE_INSET
  if (rectTop >= safeTop && rectBottom <= safeBottom) return
  const targetTop = Math.max(
    0,
    container.scrollTop + rectTop - safeTop
  )
  if (typeof container.scrollTo === 'function') {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    container.scrollTo({ top: targetTop, behavior: reduceMotion ? 'auto' : 'smooth' })
    return
  }
  container.scrollTop = targetTop
}

function hasSelectionWithin(element: HTMLElement): boolean {
  const selection = element.ownerDocument.getSelection()
  if (!selection || selection.isCollapsed || !selection.toString()) return false
  return [selection.anchorNode, selection.focusNode].some((node) => node && element.contains(node))
}

function isMarkdownCommentComposerTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest([
    '[data-markdown-comment-draft-composer="true"]',
    '[data-markdown-comment-reply-composer="true"]',
    '[data-markdown-comment-edit-composer="true"]',
  ].join(', ')))
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
      && item.visible === other.visible
      && item.top === other.top
      && item.left === other.left
      && item.width === other.width
      && item.height === other.height
  })
}
