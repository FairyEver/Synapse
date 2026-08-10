import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  isDriveMarkdownItem,
  type DriveAnnotationSelectorsV2,
  type DriveAnnotationTextRangeTargetV1,
  type DriveBrowserCollaborationCapabilityDto,
  type DriveBrowserEditDto,
  type DriveBrowserItemDto,
  type DriveBrowserPreviewDto,
  type DriveMarkdownOutlineItemDto,
  type DriveCollaborationJoinContext,
} from '@synapse/shared'
import { ListTree, Maximize2, MessageSquare } from 'lucide-react'
import * as Y from 'yjs'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useFilePreviewLayoutMode } from '@/features/file-browser/preview/file-preview-layout'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import type { DriveAnnotationContext } from '../use-drive-annotations'
import { useDriveAnnotations } from '../use-drive-annotations'
import { useDriveCollaboration } from '../collaboration/use-drive-collaboration'
import { DriveCodeRenderer } from './code-renderer'
import { useDriveMarkdownImageSources, type DriveMarkdownImageSourceContext } from './drive-markdown-image-sources'
import type { DriveRendererEditContext } from './drive-renderer-shell'
import { renderMarkdownAnnotationHtml, resolveMarkdownAnnotationTextRange } from './markdown-annotation-render'
import { createMarkdownAnnotationAnchorFromSelection } from './markdown-annotation-target'
import { getCommentActionErrorMessage, MarkdownCommentsRail, type MarkdownCommentsRailThread } from './markdown-comments-rail'
import {
  createMarkdownRenderedDomRange,
  createMarkdownRenderedTextModel,
  type MarkdownRenderedTextSegment,
} from './markdown-rendered-text'
import { useRegisterDriveRendererToolbarItems, type DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

const MARKDOWN_BODY_CLASSNAME = 'max-w-full break-words space-y-3 text-base leading-7 [&_a]:underline [&_blockquote]:border-l [&_blockquote]:pl-3 [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_h1]:scroll-mt-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:scroll-mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:scroll-mt-6 [&_h3]:font-medium [&_h4]:scroll-mt-6 [&_h5]:scroll-mt-6 [&_h6]:scroll-mt-6 [&_hr]:border-border [&_li]:ml-4 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_[data-drive-markdown-table-scroll="true"]]:max-w-full [&_[data-drive-markdown-table-scroll="true"]]:overflow-x-auto [&_table]:w-max [&_table]:min-w-full [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_td]:align-top [&_td:not(:first-child)]:min-w-56 [&_th]:border [&_th]:p-2 [&_th]:align-top [&_th:not(:first-child)]:min-w-56 [&_ul]:list-disc'
const MARKDOWN_OUTLINE_PANEL_DEFAULT_SIZE = 16
const MARKDOWN_OUTLINE_PANEL_MIN_SIZE = 12
const MARKDOWN_OUTLINE_PANEL_MAX_SIZE = 22
const MARKDOWN_COMMENTS_PANEL_DEFAULT_SIZE = 22
const MARKDOWN_COMMENTS_PANEL_MIN_SIZE = 17
const MARKDOWN_COMMENTS_PANEL_MAX_SIZE = 32
const COMMENT_SCROLL_SAFE_INSET = 24

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

type DriveMarkdownRendererProps = {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly annotationContext?: DriveAnnotationContext
  readonly editContext?: DriveRendererEditContext
  readonly imageSourceContext?: DriveMarkdownImageSourceContext
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
  imageSourceContext,
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
  const effectiveRenderedHtml = liveCollaboration.state?.preview?.html ?? renderedHtml
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
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const commentsTouchedRef = useRef(false)
  const layoutMode = useFilePreviewLayoutMode()
  const isCompact = layoutMode === 'compact'
  const outlineItems = useMemo(() => flattenMarkdownOutline(outline), [outline])
  const isAuthenticated = useAuthStore((state) => state.auth.isAuthenticated)
  const annotationsEnabled = isDriveMarkdownItem(current)
  const effectiveAnnotationContext = annotationsEnabled ? annotationContext : undefined
  const annotationStateKey = driveMarkdownAnnotationStateKey(current.id, edit?.currentVersionId ?? null, effectiveAnnotationContext)
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
  const [compactPanel, setCompactPanel] = useState<'outline' | 'comments' | null>(null)
  const [widthMode, setWidthMode] = useState<MarkdownWidthMode>('reading')
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [pendingTarget, setPendingTarget] = useState<{
    readonly target: DriveAnnotationTextRangeTargetV1
    readonly selectors: DriveAnnotationSelectorsV2
  } | null>(null)
  const [selectionPopover, setSelectionPopover] = useState<SelectionPopoverPosition | null>(null)
  const [commentDraftOpen, setCommentDraftOpen] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [commentCreateError, setCommentCreateError] = useState<string | null>(null)
  const [reassociatingThreadId, setReassociatingThreadId] = useState<string | null>(null)
  const [commentAnchorBaseOffset, setCommentAnchorBaseOffset] = useState(0)
  const [commentAnchoredDocumentHeight, setCommentAnchoredDocumentHeight] = useState(0)
  const [documentNaturalHeight, setDocumentNaturalHeight] = useState(0)
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null)
  const [threadAnchorTopById, setThreadAnchorTopById] = useState<Record<string, number>>({})
  const [annotationOverlayRects, setAnnotationOverlayRects] = useState<readonly MarkdownAnnotationOverlayRect[]>([])

  useEffect(() => {
    setActiveThreadId(null)
    setPendingTarget(null)
    setSelectionPopover(null)
    setCommentDraftOpen(false)
    setCommentBody('')
    setCommentCreateError(null)
    setReassociatingThreadId(null)
    setCommentAnchoredDocumentHeight(0)
    setDocumentNaturalHeight(0)
    setThreadAnchorTopById({})
    setAnnotationOverlayRects([])
    window.getSelection()?.removeAllRanges()
  }, [annotationStateKey])

  useEffect(() => {
    setActiveOutlineId(outlineItems[0]?.id ?? null)
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
        anchorTop: resolved?.anchorStatus === 'orphaned' ? null : threadAnchorTopById[thread.id] ?? null,
      }
    }),
    [resolvedByThreadId, sortedThreads, threadAnchorTopById]
  )
  const commentCount = railThreads.length

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
    return () => {
      observer.disconnect()
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
    setSelectionPopover(null)
    setCommentDraftOpen(false)
    setCommentBody('')
    setCommentCreateError(null)
    setReassociatingThreadId(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  const clearPendingSelectionAction = useCallback(() => {
    setPendingTarget(null)
    setSelectionPopover(null)
    setCommentCreateError(null)
  }, [])

  const applyReassociation = useCallback(async () => {
    const baseVersionId = liveCollaboration.state?.checkpointVersionId ?? edit?.currentVersionId
    if (!reassociatingThreadId || !pendingTarget || !baseVersionId) return
    setCommentCreateError(null)
    try {
      await annotations.updateAnchor({
        threadId: reassociatingThreadId,
        baseVersionId,
        epoch: liveCollaboration.state?.epoch ?? null,
        stateVector: liveCollaboration.session ? encodeStateVector(liveCollaboration.session.doc) : null,
        selectors: pendingTarget.selectors,
        idempotencyKey: crypto.randomUUID(),
      })
      setActiveThreadId(reassociatingThreadId)
      setPendingTarget(null)
      setSelectionPopover(null)
      setReassociatingThreadId(null)
      window.getSelection()?.removeAllRanges()
    } catch (cause) {
      setCommentCreateError(getCommentActionErrorMessage(cause))
    }
  }, [annotations, edit?.currentVersionId, liveCollaboration.session, liveCollaboration.state?.checkpointVersionId, liveCollaboration.state?.epoch, pendingTarget, reassociatingThreadId])

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
    if (imageSources.toolbarItem) items.push(imageSources.toolbarItem)
    return items
  }, [
    annotationsEnabled,
    commentCount,
    commentsOpen,
    compactPanel,
    imageSources.toolbarItem,
    isCompact,
    outline.length,
    outlineOpen,
    setCommentPanelOpen,
    setOutlinePanelOpen,
    widthMode,
  ])

  useRegisterDriveRendererToolbarItems('markdown', toolbarItems)

  const scrollToThread = (threadId: string) => {
    if (threadId === activeThreadId) return
    setActiveThreadId(threadId)
    const root = bodyRef.current
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
    const rect = getSelectionRect(selection.getRangeAt(0))
    if (!rect) {
      if (!commentDraftOpen) clearPendingSelectionAction()
      return
    }
    setPendingTarget(target)
    setSelectionPopover({
      top: Math.max(8, rect.top - 40),
      left: rect.left + rect.width / 2,
    })
  }, [canCreateAnnotation, clearPendingSelectionAction, collaborationTextMatchesProjection, commentDraftOpen, liveCollaboration.session, liveCollaboration.state?.epoch, projection])

  const syncSelectionPopoverPositionFromCurrentSelection = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return
    const rect = getSelectionRect(selection.getRangeAt(0))
    if (!rect) return
    const nextPosition = {
      top: Math.max(8, rect.top - 40),
      left: rect.left + rect.width / 2,
    }
    setSelectionPopover((current) => current
      && current.top === nextPosition.top
      && current.left === nextPosition.left
      ? current
      : nextPosition)
  }, [])

  useEffect(() => {
    if (!canCreateAnnotation) return
    document.addEventListener('keyup', syncSelectionActionFromCurrentSelection)
    return () => {
      document.removeEventListener('keyup', syncSelectionActionFromCurrentSelection)
    }
  }, [canCreateAnnotation, syncSelectionActionFromCurrentSelection])

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

  const flushDocumentScrollEffects = useCallback(() => {
    documentScrollFrameRef.current = null
    const scroller = documentScrollRef.current
    if (!scroller) return
    setCommentAnchorLayerScrollTransform(commentAnchorLayerRef.current, scroller.scrollTop)
    updateActiveOutline()
    if (selectionPopover || pendingTarget) syncSelectionPopoverPositionFromCurrentSelection()
  }, [pendingTarget, selectionPopover, syncSelectionPopoverPositionFromCurrentSelection, updateActiveOutline])

  const scheduleDocumentScrollEffects = useCallback(() => {
    if (documentScrollFrameRef.current !== null) return
    documentScrollFrameRef.current = window.requestAnimationFrame(flushDocumentScrollEffects)
  }, [flushDocumentScrollEffects])

  useEffect(() => () => {
    if (documentScrollFrameRef.current !== null) window.cancelAnimationFrame(documentScrollFrameRef.current)
  }, [])

  useLayoutEffect(() => {
    setCommentAnchorLayerScrollTransform(commentAnchorLayerRef.current, documentScrollRef.current?.scrollTop ?? 0)
    updateActiveOutline()
  }, [commentsOpen, isCompact, outlineOpen, updateActiveOutline, widthMode])

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
      activeLink.scrollIntoView({ block: 'nearest' })
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
    if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top: targetTop, behavior: 'smooth' })
    } else {
      scroller.scrollTop = targetTop
    }
  }, [])

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

  const handleBodyClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (hasSelectionWithin(event.currentTarget)) return
    const threadId = findOverlayThreadAtPoint(annotationOverlayRects, event.clientX, event.clientY, bodyRef.current)
      ?? findRenderedOverlayThreadAtPoint(event.clientX, event.clientY, bodyRef.current)
    if (!threadId) return
    focusThreadFromDocument(threadId)
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
        targetKind: 'textRange',
        target: pendingTarget.target,
        body: commentBody,
      })
      setActiveThreadId(thread.id)
      setCommentPanelOpen(true)
      setPendingTarget(null)
      setSelectionPopover(null)
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
      onScroll={scheduleDocumentScrollEffects}
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
            onPointerUp={syncSelectionActionFromCurrentSelection}
            dangerouslySetInnerHTML={annotatedHtmlProperty}
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

  const commentDraft = commentDraftOpen && pendingTarget
    ? {
        anchorTop: annotationOverlayRects.find((rect) => rect.kind === 'pending')?.top ?? 0,
        quote: pendingTarget.target.quote.exact.replace(/\s+/gu, ' ').trim(),
        value: commentBody,
        submitting: annotations.creatingThread,
        error: commentCreateError,
        onValueChange: (value: string) => {
          setCommentBody(value)
          if (commentCreateError) setCommentCreateError(null)
        },
        onSubmit: () => { void createThread() },
        onCancel: clearPendingComment,
      }
    : null

  const renderCommentsRail = (mode: 'anchored' | 'list') => (
    <MarkdownCommentsRail
      mode={mode}
      threads={railThreads}
      draft={commentDraft}
      activeThreadId={activeThreadId}
      canReply={canCreateAnnotation}
      loading={annotations.loading}
      anchorBaseOffset={commentAnchorBaseOffset}
      anchorLayerRef={mode === 'anchored' ? setCommentAnchorLayerRef : undefined}
      onAnchoredHeightChange={mode === 'anchored' ? setCommentAnchoredDocumentHeight : undefined}
      onAnchoredWheel={mode === 'anchored' ? handleCommentsWheel : undefined}
      onFocusThread={focusThreadFromRail}
      onRefresh={() => { void annotations.refresh() }}
      onReply={annotations.reply}
      onUpdateComment={annotations.updateComment}
      onDeleteComment={annotations.deleteComment}
      onStartReassociate={(threadId) => {
        setReassociatingThreadId(threadId)
        setActiveThreadId(threadId)
        setPendingTarget(null)
        setSelectionPopover(null)
        if (isCompact) setCompactPanel(null)
      }}
    />
  )

  return (
    <div className='h-full min-h-0 overflow-hidden bg-background'>
      {selectionPopover && pendingTarget && !commentDraftOpen ? (
        <div
          data-drive-annotation-selection-action
          className='fixed z-50 -translate-x-1/2'
          style={{ top: selectionPopover.top, left: selectionPopover.left }}
        >
          <Button
            type='button'
            className='shadow-md'
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (reassociatingThreadId) {
                void applyReassociation()
                return
              }
              setCommentDraftOpen(true)
              setCommentPanelOpen(true)
            }}
          >
            {reassociatingThreadId ? '重新关联' : '添加评论'}
          </Button>
        </div>
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
                      <MarkdownOutlineTree
                        items={outline}
                        activeItemId={activeOutlineId}
                        onSelect={scrollToOutlineItem}
                      />
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
              className='h-full min-h-0 min-w-0 overflow-hidden'
            >
              {documentView}
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
                  className='h-full min-h-0 overflow-hidden'
                >
                  <aside className='h-full min-h-0 self-stretch overflow-hidden border-l bg-background'>
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
          <SheetContent side='left' data-markdown-sheet='outline' className='gap-0 overflow-hidden'>
            <SheetHeader className='pr-14'>
              <SheetTitle>目录</SheetTitle>
              <SheetDescription className='sr-only'>跳转到文档标题</SheetDescription>
            </SheetHeader>
            <nav className='min-h-0 flex-1 overflow-auto px-4 pb-4' aria-label='目录'>
              <MarkdownOutlineTree
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
          <SheetContent side='right' data-markdown-sheet='comments' className='gap-0 overflow-hidden'>
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
      {imageSources.panel}
      {annotated.resolved.some((item) => item.anchorStatus === 'orphaned') ? (
        <div className='sr-only'>原文已修改或删除</div>
      ) : null}
    </div>
  )
}

function encodeStateVector(doc: Y.Doc): string {
  const value = Y.encodeStateVector(doc)
  let binary = ''
  for (let index = 0; index < value.length; index += 1) binary += String.fromCharCode(value[index] ?? 0)
  return btoa(binary)
}

function flattenMarkdownOutline(items: readonly DriveMarkdownOutlineItemDto[]): DriveMarkdownOutlineItemDto[] {
  return items.flatMap((item) => [item, ...flattenMarkdownOutline(item.children)])
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

function getSelectionRect(range: Range): DOMRect | null {
  const rects = typeof range.getClientRects === 'function'
    ? Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0)
    : []
  const rect = rects[0] ?? range.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0 ? rect : null
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
  domRange.detach()
  return removeContainerOverlayRects(rects.filter((rect) => isUsableOverlayRect(rect, rootRect)))
    .map((rect) => ({
      top: rect.top - rootRect.top,
      left: rect.left - rootRect.left,
      width: rect.width,
      height: rect.height,
    }))
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

export function MarkdownOutlineTree({
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
        <MarkdownOutlineNode
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

function MarkdownOutlineNode({
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
          outlineDepthClassName(item.depth)
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
        <MarkdownOutlineTree
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
