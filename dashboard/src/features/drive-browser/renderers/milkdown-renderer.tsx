import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import { EditorStatus } from '@milkdown/kit/core'
import { insert, replaceAll } from '@milkdown/kit/utils'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import {
  isDriveCommentableMarkdownItem,
  type DriveBrowserEditDto,
  type DriveBrowserItemDto,
  type DriveBrowserPreviewDto,
} from '@synapse/shared'
import { ImagePlus, LogIn, MessageSquare, RefreshCw, Save } from 'lucide-react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { useFilePreviewLayoutMode } from '@/features/file-browser/preview/file-preview-layout'
import type { DriveDocumentImageUploadContext } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { DriveCommentsRail, type DriveCommentsRailItem } from '../drive-comments-rail'
import { useDriveAnnotations, type DriveAnnotationContext } from '../use-drive-annotations'
import { startDriveOperation, trackDriveEvent } from '../shared/drive-telemetry'
import {
  DRIVE_DOCUMENT_IMAGE_ACCEPT,
  driveDocumentImageAltText,
  driveDocumentImageValidationError,
  useDriveDocumentImageUpload,
} from './drive-document-image-upload'
import {
  DriveDocumentEditorRecoveryDialogs,
  buildDriveDocumentEditorLoginUrl,
  driveDocumentEditorErrorMessage,
  isDriveDocumentSaveAcknowledged,
  isDriveDocumentSaveShortcut,
  reloadDriveDocumentText,
  saveDriveDocumentText,
  type DriveDocumentSaveAttempt,
} from './drive-document-editor-lifecycle'
import { observeDriveHierarchicalListMarkers } from './drive-hierarchical-list-markers'
import { configureMilkdownCommonMarkImages } from './milkdown-commonmark-images'
import { useMilkdownCommentGeometry } from './drive-editor-comment-geometry'
import type { DriveRendererEditContext } from './drive-renderer-shell'
import { useRegisterDriveRendererToolbarItems, useRegisterDriveRendererUnsavedState, type DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

const MILKDOWN_COMMENTS_PANEL_DEFAULT_SIZE = 22
const MILKDOWN_COMMENTS_PANEL_MIN_SIZE = 17
const MILKDOWN_COMMENTS_PANEL_MAX_SIZE = 32
const COMMENT_SCROLL_SAFE_INSET = 24

type ResizablePanelPercent = `${number}%`
type SourceTextareaSelection = {
  readonly documentId: string
  readonly start: number
  readonly end: number
  readonly direction: 'forward' | 'backward' | 'none'
}

export function DriveMilkdownRenderer({
  current,
  preview,
  edit,
  editContext,
  annotationContext,
  imageUploadContext,
}: {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly editContext?: DriveRendererEditContext
  readonly annotationContext?: DriveAnnotationContext
  readonly imageUploadContext?: DriveDocumentImageUploadContext
}) {
  const initialText = preview.text ?? ''
  const crepeRef = useRef<Crepe | null>(null)
  const editorContainerRef = useRef<HTMLDivElement | null>(null)
  const editorContentHostRef = useRef<HTMLDivElement | null>(null)
  const commentAnchorLayerRef = useRef<HTMLDivElement | null>(null)
  const editorScrollFrameRef = useRef<number | null>(null)
  const commentsTouchedRef = useRef(false)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const sourceTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingSourceImageSelectionRef = useRef<SourceTextareaSelection | null>(null)
  const pendingSourceFocusRef = useRef<SourceTextareaSelection | null>(null)
  const activeDocumentIdRef = useRef(current.id)
  activeDocumentIdRef.current = current.id
  const savedValueRef = useRef(initialText)
  const valueRef = useRef(initialText)
  const saveInFlightRef = useRef(false)
  const pendingSaveRef = useRef<DriveDocumentSaveAttempt | null>(null)
  const applyingExternalMarkdownRef = useRef(false)
  const externalMarkdownTargetRef = useRef<string | null>(null)
  const externalMarkdownFrameRef = useRef<number | null>(null)
  const pendingExternalMarkdownRef = useRef<string | null>(null)
  const externalMarkdownSourceRef = useRef({
    documentId: current.id,
    versionId: edit?.currentVersionId ?? null,
    text: initialText,
  })
  const [value, setValue] = useState(initialText)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false)
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
  const canEdit = Boolean(edit?.canEdit && edit.currentVersionId && editContext)
  const loginRequired = edit?.reason === 'login_required'
  const requiresSourceMode = requiresMilkdownSourceMode(initialText)
  const sourceMode = Boolean(parseError || requiresSourceMode)
  const loginUrl = buildDriveDocumentEditorLoginUrl()
  const { uploadingImage, uploadDocumentImage, uploadOptionalDocumentImage } = useDriveDocumentImageUpload({
    canEdit,
    imageUploadContext,
    lifecycleKey: current.id,
    telemetryComponent: 'drive-milkdown-editor',
    onError: setError,
  })
  const canSave = canEdit
    && dirty
    && !uploadingImage
    && !editContext?.savingText
    && !editContext?.reloading

  useEffect(() => {
    trackDriveEvent({ eventKey: 'web.drive.editor.open', component: 'drive-milkdown-editor', action: 'open' })
    const finishDuration = startDriveOperation('web.drive.editor.duration', 'drive-milkdown-editor')
    return () => finishDuration('success')
  }, [current.id])

  const relativeImagePreviewUrls = useMemo(
    () => new Map((preview.relativeImages ?? []).map(({ src, resolvedUrl }) => [src, resolvedUrl])),
    [preview.relativeImages]
  )
  const resolveImagePreview = useCallback((imageSource: string) => {
    if (!relativeImagePreviewUrls.has(imageSource)) return imageSource
    return relativeImagePreviewUrls.get(imageSource) ?? ''
  }, [relativeImagePreviewUrls])
  const annotationGeometryResetKey = useMemo(() => [
    current.id,
    edit?.currentVersionId ?? '',
    commentBaselineRevision,
    ...annotationThreads.map((thread) => [
      thread.id,
      thread.anchorStatus,
      thread.anchor?.lastResolvedVersionId ?? '',
      thread.anchor?.resolvedRenderedRange?.start ?? '',
      thread.anchor?.resolvedRenderedRange?.end ?? '',
    ].join(':')),
  ].join('|'), [annotationThreads, commentBaselineRevision, current.id, edit?.currentVersionId])
  const { geometry, notifyEditorUpdate, scheduleGeometry } = useMilkdownCommentGeometry({
    enabled: annotationsEnabled && !sourceMode,
    layoutKey: `${layoutMode}:${commentsOpen}`,
    resetKey: annotationGeometryResetKey,
    threads: annotationThreads,
    projection: preview.markdownProjection,
    imagePreviewUrls: relativeImagePreviewUrls,
    scrollRef: editorContainerRef,
    contentHostRef: editorContentHostRef,
  })
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

  const clearExternalMarkdownSync = useCallback(() => {
    applyingExternalMarkdownRef.current = false
    externalMarkdownTargetRef.current = null
    if (externalMarkdownFrameRef.current !== null) {
      window.cancelAnimationFrame(externalMarkdownFrameRef.current)
      externalMarkdownFrameRef.current = null
    }
  }, [])
  const beginExternalMarkdownSync = useCallback((target: string) => {
    applyingExternalMarkdownRef.current = true
    externalMarkdownTargetRef.current = target
    if (externalMarkdownFrameRef.current !== null) window.cancelAnimationFrame(externalMarkdownFrameRef.current)
    externalMarkdownFrameRef.current = window.requestAnimationFrame(() => {
      externalMarkdownFrameRef.current = window.requestAnimationFrame(() => {
        applyingExternalMarkdownRef.current = false
        externalMarkdownFrameRef.current = null
      })
    })
  }, [])
  const replaceEditorMarkdown = useCallback((markdown: string) => {
    const crepe = crepeRef.current
    if (!crepe) {
      pendingExternalMarkdownRef.current = markdown
      return
    }
    beginExternalMarkdownSync(markdown)
    crepe.editor.action(replaceAll(markdown, true))
    const normalizedMarkdown = preserveMilkdownCommonMarkAutolinks(crepe.getMarkdown(), markdown)
    externalMarkdownTargetRef.current = normalizedMarkdown
    savedValueRef.current = normalizedMarkdown
    valueRef.current = normalizedMarkdown
    setValue(normalizedMarkdown)
    setDirty(false)
  }, [beginExternalMarkdownSync])
  const handleCrepeReady = useCallback((crepe: Crepe) => {
    crepeRef.current = crepe
    crepe.setReadonly(!canEdit)
    const pendingMarkdown = pendingExternalMarkdownRef.current
    pendingExternalMarkdownRef.current = null
    if (pendingMarkdown !== null && pendingMarkdown !== crepe.getMarkdown()) {
      replaceEditorMarkdown(pendingMarkdown)
    } else {
      const normalizedMarkdown = preserveMilkdownCommonMarkAutolinks(crepe.getMarkdown(), initialText)
      savedValueRef.current = normalizedMarkdown
      valueRef.current = normalizedMarkdown
      setValue(normalizedMarkdown)
      setDirty(false)
    }
    scheduleGeometry()
  }, [canEdit, initialText, replaceEditorMarkdown, scheduleGeometry])
  const handleCrepeFailure = useCallback(() => {
    crepeRef.current = null
    setParseError('Milkdown 无法安全解析此文档。')
  }, [])
  const handleCrepeDestroy = useCallback((crepe: Crepe) => {
    if (crepeRef.current === crepe) crepeRef.current = null
  }, [])

  useEffect(() => {
    crepeRef.current?.setReadonly(!canEdit)
  }, [canEdit])

  useEffect(() => {
    const root = editorContentHostRef.current
    if (!root || sourceMode) return
    return observeDriveHierarchicalListMarkers(root)
  }, [current.id, sourceMode])

  useEffect(() => {
    const previousExternalMarkdownSource = externalMarkdownSourceRef.current
    const externalMarkdownChanged = previousExternalMarkdownSource.documentId !== current.id
      || previousExternalMarkdownSource.versionId !== (edit?.currentVersionId ?? null)
      || previousExternalMarkdownSource.text !== initialText
    externalMarkdownSourceRef.current = {
      documentId: current.id,
      versionId: edit?.currentVersionId ?? null,
      text: initialText,
    }
    savedValueRef.current = initialText
    const savedVersionAcknowledged = isDriveDocumentSaveAcknowledged(pendingSaveRef.current, current.id, initialText)
    if (savedVersionAcknowledged) {
      setDirty(valueRef.current !== initialText)
      return
    }
    valueRef.current = initialText
    setValue(initialText)
    setDirty(false)
    setError(null)
    setParseError(null)
    setConflictOpen(false)
    setReloadConfirmOpen(false)
    setActiveThreadId(null)
    setCommentsOpen(false)
    setCompactCommentsOpen(false)
    setCommentAnchoredDocumentHeight(0)
    commentsTouchedRef.current = false
    pendingSourceImageSelectionRef.current = null
    pendingSourceFocusRef.current = null
    if (crepeRef.current) replaceEditorMarkdown(initialText)
    else if (externalMarkdownChanged) pendingExternalMarkdownRef.current = initialText
  }, [current.id, edit?.currentVersionId, initialText, replaceEditorMarkdown])

  useEffect(() => () => {
    clearExternalMarkdownSync()
    crepeRef.current = null
  }, [clearExternalMarkdownSync])

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

  useLayoutEffect(() => {
    const selection = pendingSourceFocusRef.current
    if (!selection || activeDocumentIdRef.current !== selection.documentId) return
    pendingSourceFocusRef.current = null
    const textarea = sourceTextareaRef.current
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(selection.start, selection.end, selection.direction)
  }, [value])

  const handleMarkdownChange = useCallback((nextValue: string) => {
    if (!canEdit) return
    const sourcePreservedValue = preserveMilkdownCommonMarkAutolinks(nextValue, valueRef.current)
    valueRef.current = sourcePreservedValue
    setValue(sourcePreservedValue)
    const matchesExternalTarget = applyingExternalMarkdownRef.current
      && externalMarkdownTargetRef.current === sourcePreservedValue
    if (matchesExternalTarget) {
      savedValueRef.current = sourcePreservedValue
      setDirty(false)
      notifyEditorUpdate()
      return
    }
    clearExternalMarkdownSync()
    setDirty(sourcePreservedValue !== savedValueRef.current)
    notifyEditorUpdate()
  }, [canEdit, clearExternalMarkdownSync, notifyEditorUpdate])

  const handleSave = useCallback(async () => {
    if (!canSave || saveInFlightRef.current || !edit?.currentVersionId || !editContext) return
    const finishTracking = startDriveOperation('web.drive.editor.save', 'drive-milkdown-editor')
    saveInFlightRef.current = true
    setError(null)
    const submittedValue = valueRef.current
    const saveAttempt = { itemId: current.id, initialText: submittedValue }
    pendingSaveRef.current = saveAttempt
    try {
      const result = await saveDriveDocumentText(editContext, submittedValue, edit.currentVersionId)
      if (result === 'conflict') {
        finishTracking('failure')
        setConflictOpen(true)
        return
      }
      savedValueRef.current = submittedValue
      setDirty(valueRef.current !== submittedValue)
      await annotations.refresh()
      setCommentBaselineRevision((revision) => revision + 1)
      finishTracking('success')
    } catch (saveError) {
      finishTracking('failure')
      setError(driveDocumentEditorErrorMessage(saveError, '保存失败。'))
    } finally {
      if (pendingSaveRef.current === saveAttempt) pendingSaveRef.current = null
      saveInFlightRef.current = false
    }
  }, [annotations.refresh, canSave, current.id, edit?.currentVersionId, editContext])

  const handleSaveShortcut = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isDriveDocumentSaveShortcut(event)) return
    event.preventDefault()
    if (canSave) void handleSave()
  }, [canSave, handleSave])

  const handleReload = useCallback(async () => {
    if (!editContext) return
    const finishTracking = startDriveOperation('web.drive.editor.reload', 'drive-milkdown-editor')
    setError(null)
    try {
      const nextText = await reloadDriveDocumentText(editContext)
      savedValueRef.current = nextText
      valueRef.current = nextText
      setValue(nextText)
      setDirty(false)
      setParseError(null)
      setConflictOpen(false)
      setReloadConfirmOpen(false)
      replaceEditorMarkdown(nextText)
      finishTracking('success')
    } catch (reloadError) {
      finishTracking('failure')
      setError(driveDocumentEditorErrorMessage(reloadError, '重新加载失败。'))
    }
  }, [editContext, replaceEditorMarkdown])

  const requestReload = useCallback(() => {
    if (dirty) {
      setReloadConfirmOpen(true)
      return
    }
    void handleReload()
  }, [dirty, handleReload])

  const captureSourceSelection = useCallback((): SourceTextareaSelection => {
    const textarea = sourceTextareaRef.current
    return {
      documentId: current.id,
      start: textarea?.selectionStart ?? valueRef.current.length,
      end: textarea?.selectionEnd ?? valueRef.current.length,
      direction: textarea?.selectionDirection ?? 'none',
    }
  }, [current.id])
  const insertSourceMarkdown = useCallback((markdown: string, selection: SourceTextareaSelection) => {
    if (activeDocumentIdRef.current !== selection.documentId) return
    const currentValue = valueRef.current
    const start = Math.min(selection.start, currentValue.length)
    const end = Math.min(Math.max(selection.end, start), currentValue.length)
    const nextValue = `${currentValue.slice(0, start)}${markdown}${currentValue.slice(end)}`
    const nextCursor = start + markdown.length
    pendingSourceFocusRef.current = {
      documentId: selection.documentId,
      start: nextCursor,
      end: nextCursor,
      direction: selection.direction,
    }
    valueRef.current = nextValue
    setValue(nextValue)
    setDirty(nextValue !== savedValueRef.current)
  }, [])
  const insertDocumentImageMarkdown = useCallback((file: File, url: string, sourceSelection?: SourceTextareaSelection) => {
    const markdown = createMilkdownImageMarkdown(file, url)
    if (sourceSelection) {
      insertSourceMarkdown(markdown, sourceSelection)
      return
    }
    const crepe = crepeRef.current
    if (!crepe) return
    crepe.editor.action(insert(markdown))
  }, [insertSourceMarkdown])
  const handleImageSelected = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !canEdit || !imageUploadContext) return
    const pendingSourceSelection = pendingSourceImageSelectionRef.current
    pendingSourceImageSelectionRef.current = null
    const validationError = driveDocumentImageValidationError(file)
    if (validationError) {
      setError(validationError)
      return
    }
    const sourceSelection = sourceMode
      ? pendingSourceSelection ?? captureSourceSelection()
      : undefined
    void uploadDocumentImage(file).then((url) => insertDocumentImageMarkdown(file, url, sourceSelection), () => undefined)
  }, [canEdit, captureSourceSelection, imageUploadContext, insertDocumentImageMarkdown, sourceMode, uploadDocumentImage])
  const insertUploadedImages = useCallback(async (files: readonly File[], sourceSelection?: SourceTextareaSelection) => {
    const results = await Promise.allSettled(files.map((file) => uploadOptionalDocumentImage(file)))
    const uploadedMarkdown: string[] = []
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') return
      const file = files[index]
      if (!file) return
      if (sourceSelection) uploadedMarkdown.push(createMilkdownImageMarkdown(file, result.value))
      else insertDocumentImageMarkdown(file, result.value)
    })
    if (sourceSelection && uploadedMarkdown.length > 0) insertSourceMarkdown(uploadedMarkdown.join(''), sourceSelection)
  }, [insertDocumentImageMarkdown, insertSourceMarkdown, uploadOptionalDocumentImage])
  const handlePasteCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    if (!canEdit) return
    const items = Array.from(event.clipboardData.items)
    const imageItems = items.filter((item) => item.type.startsWith('image/'))
    if (imageItems.length === 0) return
    const files = imageItems.map((item) => item.getAsFile())
    const validationError = files.map((file) => driveDocumentImageValidationError(file)).find((message) => message !== null) ?? null
    const mixedPayload = items.some((item) => !item.type.startsWith('image/'))
    if (!sourceMode && !validationError && !mixedPayload) return
    event.preventDefault()
    event.stopPropagation()
    if (validationError) {
      setError(validationError)
      return
    }
    void insertUploadedImages(
      files.filter((file): file is File => file !== null),
      sourceMode ? captureSourceSelection() : undefined,
    )
  }, [canEdit, captureSourceSelection, insertUploadedImages, sourceMode])
  const handleSourceDrop = useCallback((event: ReactDragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.dataTransfer.files)
    if (!canEdit || files.length === 0) return
    event.preventDefault()
    const validationError = files.map((file) => driveDocumentImageValidationError(file)).find((message) => message !== null) ?? null
    if (validationError) {
      setError(validationError)
      return
    }
    void insertUploadedImages(files, captureSourceSelection())
  }, [canEdit, captureSourceSelection, insertUploadedImages])

  const setCommentPanelOpen = useCallback((open: boolean) => {
    commentsTouchedRef.current = true
    if (isCompact) setCompactCommentsOpen(open)
    else setCommentsOpen(open)
  }, [isCompact])
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
  useEffect(() => () => {
    if (editorScrollFrameRef.current !== null) window.cancelAnimationFrame(editorScrollFrameRef.current)
  }, [])
  const handleCommentsWheel = useCallback((event: WheelEvent) => {
    if (event.deltaY === 0) return
    const scroller = editorContainerRef.current
    if (!scroller) return
    event.preventDefault()
    scroller.scrollTop += normalizeWheelDelta(event, scroller.clientHeight)
    handleEditorScroll()
  }, [handleEditorScroll])

  const toolbarItems = useMemo<readonly DriveRendererToolbarItem[]>(() => {
    const items: DriveRendererToolbarItem[] = [{
      kind: 'status',
      id: 'milkdown-edit-status',
      label: dirty ? '未保存' : canEdit ? '已同步' : '只读',
    }]
    if (annotationsEnabled) {
      items.push({
        kind: 'toggle',
        id: 'milkdown-comments',
        label: `评论 ${railThreads.length}`,
        icon: MessageSquare,
        compactPlacement: 'primary',
        pressed: isCompact ? compactCommentsOpen : commentsOpen,
        onPressedChange: setCommentPanelOpen,
      })
    }
    if (loginRequired) {
      items.push({
        kind: 'button',
        id: 'milkdown-login',
        label: '登录后编辑',
        icon: LogIn,
        variant: 'outline',
        href: loginUrl,
      })
    }
    if (canEdit) {
      items.push({
        kind: 'button',
        id: 'milkdown-image',
        label: '插入图片',
        icon: ImagePlus,
        variant: 'ghost',
        disabled: uploadingImage,
        onClick: () => {
          pendingSourceImageSelectionRef.current = sourceMode ? captureSourceSelection() : null
          imageInputRef.current?.click()
        },
      })
    }
    if (canEdit) {
      items.push(
        {
          kind: 'button',
          id: 'milkdown-reload',
          label: '重新加载',
          icon: RefreshCw,
          loading: editContext?.reloading,
          variant: 'ghost',
          disabled: editContext?.reloading || editContext?.savingText,
          onClick: requestReload,
        },
        {
          kind: 'button',
          id: 'milkdown-save',
          label: '保存',
          icon: Save,
          variant: 'default',
          ariaKeyShortcuts: 'Meta+S Control+S',
          compactPlacement: 'primary',
          loading: editContext?.savingText,
          disabled: !canSave,
          onClick: () => { void handleSave() },
        }
      )
    }
    return items
  }, [annotationsEnabled, canEdit, canSave, captureSourceSelection, compactCommentsOpen, commentsOpen, dirty, editContext?.reloading, editContext?.savingText, handleSave, isCompact, loginRequired, loginUrl, railThreads.length, requestReload, setCommentPanelOpen, sourceMode, uploadingImage])

  useRegisterDriveRendererToolbarItems('milkdown', toolbarItems)
  useRegisterDriveRendererUnsavedState('milkdown-unsaved', canEdit && dirty)

  const commentsPanelDefaultSize = resizablePanelPercent(MILKDOWN_COMMENTS_PANEL_DEFAULT_SIZE)
  const commentsPanelMinSize = resizablePanelPercent(MILKDOWN_COMMENTS_PANEL_MIN_SIZE)
  const commentsPanelMaxSize = resizablePanelPercent(MILKDOWN_COMMENTS_PANEL_MAX_SIZE)
  const editorPanelDefaultSize = resizablePanelPercent(100 - MILKDOWN_COMMENTS_PANEL_DEFAULT_SIZE)
  const commentBottomCompensation = commentsOpen && !isCompact && !sourceMode
    ? Math.max(0, Math.ceil(commentAnchoredDocumentHeight - geometry.naturalHeight))
    : 0
  const renderCommentsRail = (mode: 'anchored' | 'list') => (
    <DriveCommentsRail
      mode={mode}
      threads={railThreads}
      activeThreadId={activeThreadId}
      canReply={canReplyToAnnotations}
      loading={annotations.loading}
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
  const editorView = (
    <div
      ref={editorContainerRef}
      data-drive-milkdown-scroll='true'
      className='h-full min-h-0 overflow-auto overscroll-contain'
      onScroll={handleEditorScroll}
    >
      <div ref={editorContentHostRef} data-drive-milkdown-content-host='true' className='relative min-h-full'>
        {sourceMode ? (
          <div className='mx-auto flex min-h-full max-w-4xl flex-col gap-3 px-4 py-6 md:px-6'>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-sm font-medium text-foreground'>源码</span>
              {parseError ? <span className='text-xs text-destructive'>解析失败</span> : null}
            </div>
            <Textarea
              ref={sourceTextareaRef}
              aria-label='Markdown 源码'
              value={value}
              readOnly={!canEdit}
              className='min-h-96 flex-1 font-mono text-sm'
              onDragOver={(event) => {
                if (canEdit && event.dataTransfer.types.includes('Files')) event.preventDefault()
              }}
              onDrop={handleSourceDrop}
              onChange={(event) => {
                if (!canEdit) return
                const nextValue = event.currentTarget.value
                valueRef.current = nextValue
                setValue(nextValue)
                setDirty(nextValue !== savedValueRef.current)
              }}
            />
          </div>
        ) : (
          <div className='drive-milkdown-editor min-h-full [&_.milkdown]:min-h-full [&_.ProseMirror]:mx-auto [&_.ProseMirror]:min-h-full [&_.ProseMirror]:max-w-4xl [&_.ProseMirror]:px-4 [&_.ProseMirror]:pt-6 [&_.ProseMirror]:pb-12 md:[&_.ProseMirror]:px-6'>
            <MilkdownProvider>
              <MilkdownCrepeEditor
                documentKey={current.id}
                defaultValue={initialText}
                readOnly={!canEdit}
                onChange={handleMarkdownChange}
                onEditorUpdate={notifyEditorUpdate}
                onReady={handleCrepeReady}
                onFailure={handleCrepeFailure}
                onDestroy={handleCrepeDestroy}
                onUpload={uploadDocumentImage}
                proxyDomURL={resolveImagePreview}
              />
            </MilkdownProvider>
          </div>
        )}
        {!sourceMode && geometry.overlayRects.length > 0 ? (
          <div aria-hidden data-drive-milkdown-comment-overlay='true' className='pointer-events-none absolute inset-0'>
            {geometry.overlayRects.map((rect) => (
              <div
                key={rect.key}
                data-drive-milkdown-comment-thread-id={rect.threadId}
                className={cn(
                  'absolute mix-blend-multiply dark:mix-blend-screen',
                  rect.threadId === activeThreadId
                    ? 'bg-amber-300/80 ring-2 ring-amber-500/90 dark:bg-amber-700/55 dark:ring-amber-400/90'
                    : 'bg-amber-200/45 dark:bg-amber-800/30'
                )}
                style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
              />
            ))}
          </div>
        ) : null}
      </div>
      {commentBottomCompensation > 0 ? (
        <div aria-hidden data-drive-milkdown-comment-bottom-compensation='true' style={{ height: commentBottomCompensation }} />
      ) : null}
    </div>
  )

  return (
    <div
      data-drive-milkdown-renderer='true'
      className='flex h-full min-h-0 w-full flex-col overflow-hidden'
      onKeyDown={handleSaveShortcut}
      onPasteCapture={handlePasteCapture}
    >
      <input
        ref={imageInputRef}
        type='file'
        className='hidden'
        accept={DRIVE_DOCUMENT_IMAGE_ACCEPT}
        disabled={!canEdit || uploadingImage}
        onChange={(event) => { void handleImageSelected(event) }}
      />
      <div data-drive-milkdown-layout='true' className='min-h-0 flex-1 overflow-hidden'>
        {isCompact || !commentsOpen ? editorView : (
          <ResizablePanelGroup orientation='horizontal' className='h-full min-h-0 overflow-hidden'>
            <ResizablePanel defaultSize={editorPanelDefaultSize} minSize='35%' data-milkdown-resizable-panel='editor' className='h-full min-h-0 min-w-0 overflow-hidden'>
              {editorView}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={commentsPanelDefaultSize} minSize={commentsPanelMinSize} maxSize={commentsPanelMaxSize} data-milkdown-resizable-panel='comments' className='h-full min-h-0 overflow-hidden'>
              <aside className='h-full min-h-0 overflow-hidden bg-background'>
                {renderCommentsRail(sourceMode ? 'list' : 'anchored')}
              </aside>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
      {isCompact && annotationsEnabled ? (
        <Sheet open={compactCommentsOpen} onOpenChange={setCommentPanelOpen}>
          <SheetContent data-drive-telemetry-scope='portal' side='right' data-milkdown-sheet='comments' className='gap-0 overflow-hidden'>
            <SheetHeader className='sr-only'>
              <SheetTitle>评论</SheetTitle>
              <SheetDescription>查看和管理文档评论</SheetDescription>
            </SheetHeader>
            <div className='min-h-0 flex-1 overflow-auto'>{renderCommentsRail('list')}</div>
          </SheetContent>
        </Sheet>
      ) : null}
      {annotations.error ? <div className='border-t px-3 py-2 text-xs text-muted-foreground'>{annotations.error}</div> : null}
      {error ? <div className='border-t px-3 py-2 text-xs text-destructive'>{error}</div> : null}
      {uploadingImage ? <div className='border-t px-3 py-2 text-xs text-muted-foreground'>上传中</div> : null}
      {preview.truncated ? <div className='border-t px-3 py-2 text-xs text-muted-foreground'>内容已截断</div> : null}
      <DriveDocumentEditorRecoveryDialogs
        conflictOpen={conflictOpen}
        fileName={current.name}
        localValue={value}
        onConflictOpenChange={setConflictOpen}
        onReload={() => { void handleReload() }}
        onReloadConfirmOpenChange={setReloadConfirmOpen}
        reloadConfirmOpen={reloadConfirmOpen}
      />
    </div>
  )
}

function MilkdownCrepeEditor({
  documentKey,
  defaultValue,
  readOnly,
  onChange,
  onEditorUpdate,
  onReady,
  onFailure,
  onDestroy,
  onUpload,
  proxyDomURL,
}: {
  readonly documentKey: string
  readonly defaultValue: string
  readonly readOnly: boolean
  readonly onChange: (markdown: string) => void
  readonly onEditorUpdate: () => void
  readonly onReady: (crepe: Crepe) => void
  readonly onFailure: () => void
  readonly onDestroy: (crepe: Crepe) => void
  readonly onUpload: (file: File) => Promise<string>
  readonly proxyDomURL: (url: string) => string
}) {
  const propsRef = useRef({ defaultValue, onChange, onEditorUpdate, onReady, onFailure, onDestroy, onUpload, proxyDomURL, readOnly })
  propsRef.current = { defaultValue, onChange, onEditorUpdate, onReady, onFailure, onDestroy, onUpload, proxyDomURL, readOnly }
  const crepeRef = useRef<Crepe | null>(null)
  const mountedRef = useRef(false)
  const { loading } = useEditor((root) => {
    mountedRef.current = false
    const crepe = new Crepe({
      root,
      defaultValue: propsRef.current.defaultValue,
      features: {
        [CrepeFeature.TopBar]: false,
        [CrepeFeature.AI]: false,
        [CrepeFeature.ImageBlock]: false,
        [CrepeFeature.Latex]: false,
      },
      featureConfigs: {
        [CrepeFeature.BlockEdit]: {
          textGroup: {
            label: '文本',
            text: { label: '正文' },
            h1: { label: '一级标题' },
            h2: { label: '二级标题' },
            h3: { label: '三级标题' },
            h4: { label: '四级标题' },
            h5: { label: '五级标题' },
            h6: { label: '六级标题' },
            quote: { label: '引用' },
            divider: { label: '分隔线' },
          },
          listGroup: {
            label: '列表',
            bulletList: { label: '无序列表' },
            orderedList: { label: '有序列表' },
            taskList: { label: '任务列表' },
          },
          advancedGroup: {
            label: '插入',
            image: { label: '图片' },
            codeBlock: { label: '代码块' },
            table: { label: '表格' },
            math: { label: '公式' },
          },
        },
        [CrepeFeature.Toolbar]: {
          boldLabel: '粗体',
          codeLabel: '行内代码',
          italicLabel: '斜体',
          linkLabel: '链接',
          strikethroughLabel: '删除线',
          latexLabel: '公式',
          aiLabel: 'AI',
        },
        [CrepeFeature.LinkTooltip]: {
          inputPlaceholder: '粘贴链接',
        },
        [CrepeFeature.CodeMirror]: {
          searchPlaceholder: '搜索语言',
          noResultText: '无结果',
          copyText: '复制',
          previewLabel: '预览',
          previewLoading: '正在生成预览',
          previewToggleText: (previewOnlyMode) => previewOnlyMode ? '编辑代码' : '预览代码',
        },
        [CrepeFeature.Placeholder]: {
          text: '',
        },
      },
    })
    configureMilkdownCommonMarkImages(crepe, {
      altText: milkdownImageAltText,
      confirmButton: '确认',
      onUpload: (file) => propsRef.current.onUpload(file),
      proxyDomURL: (url) => propsRef.current.proxyDomURL(url),
      uploadButton: '上传图片',
      uploadPlaceholderText: '或粘贴图片地址',
    })
    crepe.setReadonly(propsRef.current.readOnly)
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown, previousMarkdown) => {
        if (markdown !== previousMarkdown) propsRef.current.onChange(markdown)
      })
      listener.updated(() => propsRef.current.onEditorUpdate())
      listener.destroy(() => {
        mountedRef.current = false
        crepeRef.current = null
        propsRef.current.onDestroy(crepe)
      })
    })
    crepeRef.current = crepe
    return crepe
  }, [documentKey])

  useEffect(() => {
    crepeRef.current?.setReadonly(readOnly)
  }, [readOnly])
  useEffect(() => {
    if (loading || mountedRef.current) return
    const crepe = crepeRef.current
    if (!crepe || crepe.editor.status !== EditorStatus.Created) {
      onFailure()
      return
    }
    mountedRef.current = true
    onReady(crepe)
  }, [loading, onFailure, onReady])

  return <Milkdown />
}

export function requiresMilkdownSourceMode(markdown: string): boolean {
  const lines = markdown.replace(/^\uFEFF/u, '').split(/\r?\n/u)
  if (hasLinkReferenceDefinition(lines)) return true
  const marker = lines[0]?.trim()
  if (marker !== '---' && marker !== '+++') return false
  const closingIndex = lines.slice(1).findIndex((line) => {
    const value = line.trim()
    return value === marker || (marker === '---' && value === '...')
  })
  return closingIndex >= 0
}

function createMilkdownImageMarkdown(file: File, url: string): string {
  return `![${escapeMarkdownImageAlt(milkdownImageAltText(file))}](${url})`
}

function milkdownImageAltText(file: File): string {
  return driveDocumentImageAltText(file.name)
}

function escapeMarkdownImageAlt(value: string): string {
  return value.replace(/[\\[\]]/gu, '\\$&')
}

function hasLinkReferenceDefinition(lines: readonly string[]): boolean {
  let fence: { readonly marker: '`' | '~'; readonly length: number } | null = null
  for (const line of lines) {
    const content = stripMarkdownContainerPrefix(line)
    const fenceMatch = /^(`{3,}|~{3,})(.*)$/u.exec(content)
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1][0] as '`' | '~'
      if (!fence) fence = { marker, length: fenceMatch[1].length }
      else if (
        fence.marker === marker
        && fenceMatch[1].length >= fence.length
        && /^\s*$/u.test(fenceMatch[2] ?? '')
      ) fence = null
      continue
    }
    if (!fence && /^\[(?:\\.|[^\]\\])+\]:/u.test(content)) return true
  }
  return false
}

function stripMarkdownContainerPrefix(line: string): string {
  let content = line
  while (true) {
    const indented = /^ {0,3}/u.exec(content)?.[0] ?? ''
    content = content.slice(indented.length)
    const quote = /^> ?/u.exec(content)?.[0]
    if (quote) {
      content = content.slice(quote.length)
      continue
    }
    const list = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]+)/u.exec(content)?.[0]
    if (list) {
      content = content.slice(list.length)
      continue
    }
    return content
  }
}

export function preserveMilkdownCommonMarkAutolinks(markdown: string, sourceMarkdown: string): string {
  const sourceLines = sourceMarkdown.split(/\r?\n/u)
  const markdownParts = markdown.split(/(\r?\n)/u)
  const markdownLines = markdownParts.filter((_, index) => index % 2 === 0)
  const sourceCanonicalLines = canonicalizeMilkdownAutolinks(sourceMarkdown).split(/\r?\n/u)
  const markdownCanonicalLines = canonicalizeMilkdownAutolinks(markdown).split(/\r?\n/u)
  const sourceLineByMarkdownLine = matchMilkdownAutolinkSourceLines(
    sourceLines,
    markdownLines,
    sourceCanonicalLines,
    markdownCanonicalLines,
  )
  const sourcePreferences = collectCommonMarkAutolinkPreferences(sourceMarkdown)
  const markdownPreferences = collectCommonMarkAutolinkPreferences(markdown)
  const uniquePreferences = new Map(Array.from(sourcePreferences.entries()).flatMap(([value, preferences]) => (
    preferences.length === 1 && markdownPreferences.get(value)?.length === 1
      ? [[value, preferences[0]] as const]
      : []
  )))

  return markdownParts.map((part, partIndex) => {
    if (partIndex % 2 === 1) return part
    const sourceLineIndex = sourceLineByMarkdownLine.get(partIndex / 2)
    const preferences = sourceLineIndex === undefined
      ? null
      : collectCommonMarkAutolinkPreferences(sourceLines[sourceLineIndex] ?? '')
    return transformMilkdownInlineProse(part, (prose) => prose.replace(
      /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)>/gu,
      (autolink, value: string) => (
        preferences?.get(value)?.shift() === 'bare' || (!preferences && uniquePreferences.get(value) === 'bare')
          ? value
          : autolink
      ),
    ))
  }).join('')
}

function canonicalizeMilkdownAutolinks(markdown: string): string {
  return transformMilkdownMarkdownProse(markdown, (prose) => prose.replace(
    /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)>/gu,
    '$1',
  ))
}

function matchMilkdownAutolinkSourceLines(
  sourceLines: readonly string[],
  markdownLines: readonly string[],
  sourceCanonicalLines: readonly string[],
  markdownCanonicalLines: readonly string[],
): Map<number, number> {
  const sourceLineByMarkdownLine = new Map<number, number>()
  const sourceGroups = new Map<string, number[]>()
  const markdownCounts = new Map<string, number>()
  const markdownOccurrences = new Map<string, number>()
  sourceCanonicalLines.forEach((line, index) => {
    const indexes = sourceGroups.get(line) ?? []
    indexes.push(index)
    sourceGroups.set(line, indexes)
  })
  markdownCanonicalLines.forEach((line) => markdownCounts.set(line, (markdownCounts.get(line) ?? 0) + 1))

  markdownCanonicalLines.forEach((canonicalLine, markdownIndex) => {
    const sourceIndexes = sourceGroups.get(canonicalLine) ?? []
    if (sourceIndexes.length === 0) return
    const occurrence = markdownOccurrences.get(canonicalLine) ?? 0
    markdownOccurrences.set(canonicalLine, occurrence + 1)
    if (sourceIndexes.length === markdownCounts.get(canonicalLine)) {
      const sourceIndex = sourceIndexes[occurrence]
      if (sourceIndex !== undefined) sourceLineByMarkdownLine.set(markdownIndex, sourceIndex)
      return
    }
    const exactSourceIndexes = sourceIndexes.filter((sourceIndex) => sourceLines[sourceIndex] === markdownLines[markdownIndex])
    if (exactSourceIndexes.length === 1) {
      sourceLineByMarkdownLine.set(markdownIndex, exactSourceIndexes[0] as number)
      return
    }
    const preferenceSignatures = new Set(sourceIndexes.map((sourceIndex) => (
      JSON.stringify(Array.from(collectCommonMarkAutolinkPreferences(sourceLines[sourceIndex] ?? '').entries()))
    )))
    if (preferenceSignatures.size !== 1) return
    const sourceIndex = sourceIndexes[Math.min(occurrence, sourceIndexes.length - 1)]
    if (sourceIndex !== undefined) sourceLineByMarkdownLine.set(markdownIndex, sourceIndex)
  })
  return sourceLineByMarkdownLine
}

function collectCommonMarkAutolinkPreferences(markdown: string): Map<string, Array<'bare' | 'explicit'>> {
  const preferences = new Map<string, Array<'bare' | 'explicit'>>()
  transformMilkdownMarkdownProse(markdown, (prose) => {
    const tokenPattern = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)>|https?:\/\/[^\s<>()]*[^\s<>()\].,!?:;]|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?/gu
    for (const match of prose.matchAll(tokenPattern)) {
      const token = match[1] ?? match[0]
      const explicit = match[1] !== undefined
      const previousCharacter = prose[(match.index ?? 0) - 1] ?? ''
      if (!explicit && /[:<(]/u.test(previousCharacter)) continue
      const entries = preferences.get(token) ?? []
      entries.push(explicit ? 'explicit' : 'bare')
      preferences.set(token, entries)
    }
    return prose
  })
  return preferences
}

function transformMilkdownMarkdownProse(markdown: string, transform: (prose: string) => string): string {
  let fence: { readonly marker: '`' | '~'; readonly length: number } | null = null
  return markdown.split(/(\r?\n)/u).map((line) => {
    if (/^\r?\n$/u.test(line)) return line
    const content = stripMarkdownContainerPrefix(line)
    const fenceMatch = /^(`{3,}|~{3,})(.*)$/u.exec(content)
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1][0] as '`' | '~'
      if (!fence) fence = { marker, length: fenceMatch[1].length }
      else if (
        marker === fence.marker
        && fenceMatch[1].length >= fence.length
        && /^\s*$/u.test(fenceMatch[2] ?? '')
      ) fence = null
      return line
    }
    if (fence) return line
    return transformMilkdownInlineProse(line, transform)
  }).join('')
}

function transformMilkdownInlineProse(line: string, transform: (prose: string) => string): string {
  let result = ''
  let cursor = 0
  while (cursor < line.length) {
    const openingIndex = line.indexOf('`', cursor)
    if (openingIndex < 0) return result + transform(line.slice(cursor))
    result += transform(line.slice(cursor, openingIndex))
    const marker = /^`+/u.exec(line.slice(openingIndex))?.[0] ?? '`'
    let closingIndex = openingIndex + marker.length
    while (closingIndex < line.length) {
      closingIndex = line.indexOf(marker, closingIndex)
      if (closingIndex < 0) return result + transform(line.slice(openingIndex))
      const beforeIsBacktick = line[closingIndex - 1] === '`'
      const afterIsBacktick = line[closingIndex + marker.length] === '`'
      if (!beforeIsBacktick && !afterIsBacktick) break
      closingIndex += marker.length
    }
    result += line.slice(openingIndex, closingIndex + marker.length)
    cursor = closingIndex + marker.length
  }
  return result
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
