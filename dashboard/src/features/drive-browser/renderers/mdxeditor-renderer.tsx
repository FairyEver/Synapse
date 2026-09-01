import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  codeBlockPlugin,
  codeMirrorPlugin,
  CreateLink,
  DiffSourceToggleWrapper,
  diffSourcePlugin,
  headingsPlugin,
  imagePlugin,
  InsertCodeBlock,
  InsertTable,
  InsertThematicBreak,
  GenericJsxEditor,
  jsxPlugin,
  linkDialogPlugin,
  linkPlugin,
  ListsToggle,
  listsPlugin,
  markdownShortcutPlugin,
  MDXEditor,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import type { JsxComponentDescriptor, MDXEditorMethods, ViewMode } from '@mdxeditor/editor'
import {
  DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION,
  inferDrivePublicAssetMimeType,
  isDriveCommentableMarkdownItem,
  type DriveBrowserEditDto,
  type DriveBrowserItemDto,
  type DriveBrowserPreviewDto,
  type DrivePublicAssetDto,
} from '@synapse/shared'
import { Download, ImagePlus, LogIn, MessageSquare, RefreshCw, Save } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { useFilePreviewLayoutMode } from '@/features/file-browser/preview/file-preview-layout'
import { ApiError } from '@/lib/api'
import {
  trackedDriveApi as driveApi,
  trackedDriveBrowserApi as driveBrowserApi,
} from '../shared/drive-telemetry-api'
import { buildDashboardSignInUrl } from '@/lib/dashboard-redirect'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { DriveCommentsRail, type DriveCommentsRailItem } from '../drive-comments-rail'
import { useDriveAnnotations, type DriveAnnotationContext } from '../use-drive-annotations'
import {
  DRIVE_HIERARCHICAL_LIST_MARKER_CLASSNAME,
  observeDriveHierarchicalListMarkers,
} from './drive-hierarchical-list-markers'
import type { DriveRendererEditContext } from './drive-renderer-shell'
import { useDriveMarkdownImageSources, type DriveMarkdownImageSourceContext } from './drive-markdown-image-sources'
import {
  commonMarkTextCompatibilityPlugin,
  commonMarkToMarkdownOptions,
  prepareCommonMarkForMdxEditor,
} from './mdxeditor-commonmark-compatibility-plugin'
import { useMdxEditorCommentGeometry } from './mdxeditor-comment-geometry'
import { mdxEditorCommentObserverPlugin } from './mdxeditor-comment-observer-plugin'
import { orderedListStartPlugin } from './mdxeditor-ordered-list-start-plugin'
import { tableCellLineBreakPlugin } from './mdxeditor-table-cell-line-break-plugin'
import { trailingImageParagraphPlugin } from './mdxeditor-trailing-image-plugin'
import { mdxEditorZhCnTranslation } from './mdxeditor-zh-cn'
import { useRegisterDriveRendererToolbarItems, useRegisterDriveRendererUnsavedState, type DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

const PUBLIC_IMAGE_UPLOAD_CONSENT_STORAGE_KEY = 'synapse.drive.markdown.publicImageUploadConsent.v1'
const MDXEDITOR_COMMENTS_PANEL_DEFAULT_SIZE = 22
const MDXEDITOR_COMMENTS_PANEL_MIN_SIZE = 17
const MDXEDITOR_COMMENTS_PANEL_MAX_SIZE = 32
const COMMENT_SCROLL_SAFE_INSET = 24

type ResizablePanelPercent = `${number}%`

type PendingPublicImageUpload = {
  readonly file: File
  readonly insertMarkdown: boolean
  readonly resolve?: (url: string) => void
  readonly reject?: (error: Error) => void
}

type DraftPublicImage = {
  readonly file: File
  readonly input: PublicImageUploadInput
  readonly url: string
}

type PublicImageUploadInput = {
  readonly name: string
  readonly mimeType: DrivePublicAssetImageMimeType
}

type DrivePublicAssetImageMimeType = typeof DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION[keyof typeof DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION]

const DRIVE_PUBLIC_ASSET_IMAGE_MIME_TYPES = Object.values(DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION) as readonly DrivePublicAssetImageMimeType[]

const GENERIC_MDX_COMPONENT_DESCRIPTOR = {
  name: '*',
  kind: 'flow',
  props: [],
  hasChildren: true,
  Editor: GenericJsxEditor,
} satisfies JsxComponentDescriptor

export function DriveMDXeditorRenderer({
  current,
  preview,
  edit,
  editContext,
  annotationContext,
  imageSourceContext,
}: {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly editContext?: DriveRendererEditContext
  readonly annotationContext?: DriveAnnotationContext
  readonly imageSourceContext?: DriveMarkdownImageSourceContext
}) {
  const sourceText = preview.text ?? ''
  const usesMdxSyntax = isMdxDocument(current.name)
  const preparedInitialDocument = useMemo(() => {
    if (!usesMdxSyntax) return prepareCommonMarkForMdxEditor(sourceText)
    const requiresSourceMode = containsTopLevelMdxEsm(sourceText)
    return {
      markdown: requiresSourceMode ? sourceText : normalizeMdxEditorBreakTags(sourceText),
      requiresSourceMode,
    }
  }, [sourceText, usesMdxSyntax])
  const initialText = preparedInitialDocument.markdown
  const editorRef = useRef<MDXEditorMethods | null>(null)
  const editorContainerRef = useRef<HTMLDivElement | null>(null)
  const editorContentHostRef = useRef<HTMLDivElement | null>(null)
  const commentAnchorLayerRef = useRef<HTMLDivElement | null>(null)
  const editorScrollFrameRef = useRef<number | null>(null)
  const commentsTouchedRef = useRef(false)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const savedValueRef = useRef(initialText)
  const valueRef = useRef(initialText)
  const saveInFlightRef = useRef(false)
  const applyingExternalMarkdownRef = useRef(false)
  const externalMarkdownTargetRef = useRef<string | null>(null)
  const externalMarkdownFrameRef = useRef<number | null>(null)
  const parseErrorRequestRef = useRef(0)
  const draftPublicImagesRef = useRef<Map<string, DraftPublicImage>>(new Map())
  const [value, setValue] = useState(initialText)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false)
  const [pendingPublicImageUpload, setPendingPublicImageUpload] = useState<PendingPublicImageUpload | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [editorViewMode, setEditorViewMode] = useState<ViewMode>('rich-text')
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
  const requiresSourceMode = preparedInitialDocument.requiresSourceMode
  const sourceMode = Boolean(parseError || requiresSourceMode || editorViewMode !== 'rich-text')
  const loginUrl = buildLoginUrl()
  const imageSources = useDriveMarkdownImageSources({
    context: imageSourceContext,
    edit,
    editContext,
    disabled: dirty,
  })
  const canSave = canEdit
    && dirty
    && !uploadingImage
    && !editContext?.savingText
    && !editContext?.reloading
  const relativeImagePreviewUrls = useMemo(
    () => new Map((preview.relativeImages ?? []).map(({ src, resolvedUrl }) => [src, resolvedUrl])),
    [preview.relativeImages],
  )
  const resolveImagePreview = useCallback(async (imageSource: string) => {
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
  const { geometry, notifyEditorUpdate, scheduleGeometry } = useMdxEditorCommentGeometry({
    enabled: annotationsEnabled && !sourceMode,
    layoutKey: `${layoutMode}:${commentsOpen}`,
    resetKey: annotationGeometryResetKey,
    threads: annotationThreads,
    projection: preview.markdownProjection,
    imagePreviewUrls: relativeImagePreviewUrls,
    scrollRef: editorContainerRef,
    contentHostRef: editorContentHostRef,
  })
  const handleEditorViewModeChange = useCallback((mode: ViewMode) => {
    setEditorViewMode(mode)
    scheduleGeometry()
  }, [scheduleGeometry])
  const canCommentAnnotations = effectiveAnnotationContext?.context === 'owner'
    || Boolean(effectiveAnnotationContext?.canComment)
  const canReplyToAnnotations = annotationsEnabled
    && Boolean(effectiveAnnotationContext)
    && canCommentAnnotations
    && (effectiveAnnotationContext?.context === 'owner' || isAuthenticated)
  const railThreads = useMemo<readonly DriveCommentsRailItem[]>(() => {
    return annotationThreads
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
      })
  }, [annotationThreads, geometry.anchorTopByThreadId, sourceMode])
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
    if (externalMarkdownFrameRef.current !== null) {
      window.cancelAnimationFrame(externalMarkdownFrameRef.current)
    }
    externalMarkdownFrameRef.current = window.requestAnimationFrame(() => {
      externalMarkdownFrameRef.current = window.requestAnimationFrame(() => {
        applyingExternalMarkdownRef.current = false
        externalMarkdownFrameRef.current = null
      })
    })
  }, [])
  const clearDraftPublicImages = useCallback((urls?: readonly string[]) => {
    const targetUrls = urls ?? Array.from(draftPublicImagesRef.current.keys())
    for (const url of targetUrls) {
      const draft = draftPublicImagesRef.current.get(url)
      if (!draft) continue
      URL.revokeObjectURL(draft.url)
      draftPublicImagesRef.current.delete(url)
    }
  }, [])
  const stageDraftImage = useCallback(async (file: File) => {
    const validationError = publicImageUploadValidationError(file)
    if (validationError) {
      setError(validationError)
      throw new Error(validationError)
    }
    const input = resolvePublicImageUploadInput(file)
    if (!input) {
      setError('格式不支持。')
      throw new Error('格式不支持。')
    }
    setError(null)
    const url = URL.createObjectURL(file)
    draftPublicImagesRef.current.set(url, { file, input, url })
    return url
  }, [])
  const confirmPublicImageUpload = useCallback((file: File | null) => {
    return new Promise<string>((resolve, reject) => {
      if (!canEdit) {
        reject(new Error('没有编辑权限。'))
        return
      }
      const validationError = publicImageUploadValidationError(file)
      if (validationError || !file) {
        const message = validationError ?? '图片内容为空，请重新复制或选择图片。'
        setError(message)
        reject(new Error(message))
        return
      }
      if (!resolvePublicImageUploadInput(file)) {
        setError('格式不支持。')
        reject(new Error('格式不支持。'))
        return
      }
      if (hasPublicImageUploadConsent()) {
        void stageDraftImage(file).then(resolve, reject)
        return
      }
      setPendingPublicImageUpload({ file, insertMarkdown: false, resolve, reject })
    })
  }, [canEdit, stageDraftImage])
  const insertPublicImageMarkdown = useCallback((file: File, url: string) => {
    const markdown = `![${imageAltText(file.name)}](${url})`
    editorRef.current?.focus(() => {
      editorRef.current?.insertMarkdown(markdown)
    }, { defaultSelection: 'rootEnd' })
  }, [])
  const handleImageSelected = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !canEdit) return
    const validationError = publicImageUploadValidationError(file)
    if (validationError) {
      setError(validationError)
      return
    }
    if (!resolvePublicImageUploadInput(file)) {
      setError('格式不支持。')
      return
    }
    setError(null)
    if (hasPublicImageUploadConsent()) {
      void stageDraftImage(file).then((url) => {
        insertPublicImageMarkdown(file, url)
      }, () => {
        // Error state is set by stageDraftImage.
      })
      return
    }
    setPendingPublicImageUpload({ file, insertMarkdown: true })
  }, [canEdit, insertPublicImageMarkdown, stageDraftImage])
  const insertMixedClipboardImages = useCallback(async (files: readonly File[]) => {
    for (const file of files) {
      try {
        const url = await confirmPublicImageUpload(file)
        insertPublicImageMarkdown(file, url)
      } catch {
        return
      }
    }
  }, [confirmPublicImageUpload, insertPublicImageMarkdown])
  const handlePasteCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    if (!canEdit) return
    const items = Array.from(event.clipboardData.items)
    const imageItems = items.filter((item) => item.type.startsWith('image/'))
    if (imageItems.length === 0) return
    const files = imageItems.map((item) => item.getAsFile())
    const validationError = files.map((file) => publicImageUploadValidationError(file)).find((message) => message !== null) ?? null
    const mixedPayload = items.some((item) => !item.type.startsWith('image/'))
    if (!validationError && !mixedPayload) return
    event.preventDefault()
    event.stopPropagation()
    if (validationError) {
      setError(validationError)
      return
    }
    void insertMixedClipboardImages(files.filter((file): file is File => file !== null))
  }, [canEdit, insertMixedClipboardImages])
  const cancelPendingPublicImageUpload = useCallback(() => {
    pendingPublicImageUpload?.reject?.(new Error('已取消。'))
    setPendingPublicImageUpload(null)
  }, [pendingPublicImageUpload])
  const uploadPendingPublicImage = useCallback(async () => {
    const pending = pendingPublicImageUpload
    if (!pending) return
    if (!canEdit) {
      pending.reject?.(new Error('没有编辑权限。'))
      setPendingPublicImageUpload(null)
      return
    }
    setPendingPublicImageUpload(null)
    rememberPublicImageUploadConsent()
    try {
      const url = await stageDraftImage(pending.file)
      pending.resolve?.(url)
      if (pending.insertMarkdown) insertPublicImageMarkdown(pending.file, url)
    } catch (stageError) {
      pending.reject?.(stageError instanceof Error ? stageError : new Error('图片插入失败。'))
    }
  }, [canEdit, insertPublicImageMarkdown, pendingPublicImageUpload, stageDraftImage])
  const plugins = useMemo(() => [
    toolbarPlugin({
      toolbarContents: () => (
        <>
          <UndoRedo />
          <DiffSourceToggleWrapper options={['rich-text', 'source']}>
            <BlockTypeSelect />
            <BoldItalicUnderlineToggles />
            <ListsToggle />
            <CreateLink />
            <InsertCodeBlock />
          </DiffSourceToggleWrapper>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={!canEdit || uploadingImage}
            onClick={() => imageInputRef.current?.click()}
          >
            <ImagePlus data-icon='inline-start' />
            插入图片
          </Button>
          <InsertTable />
          <InsertThematicBreak />
        </>
      ),
    }),
    headingsPlugin(),
    listsPlugin(),
    orderedListStartPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    imagePlugin({
      imageUploadHandler: confirmPublicImageUpload,
      imagePreviewHandler: resolveImagePreview,
    }),
    trailingImageParagraphPlugin(),
    tablePlugin(),
    tableCellLineBreakPlugin(),
    codeBlockPlugin(),
    codeMirrorPlugin(),
    ...(usesMdxSyntax ? [jsxPlugin({ jsxComponentDescriptors: [GENERIC_MDX_COMPONENT_DESCRIPTOR] })] : []),
    ...(!usesMdxSyntax ? [commonMarkTextCompatibilityPlugin()] : []),
    diffSourcePlugin({ viewMode: 'rich-text', diffMarkdown: '' }),
    mdxEditorCommentObserverPlugin({
      onEditorUpdate: notifyEditorUpdate,
      onViewModeChange: handleEditorViewModeChange,
    }),
    markdownShortcutPlugin(),
  ], [canEdit, confirmPublicImageUpload, handleEditorViewModeChange, notifyEditorUpdate, resolveImagePreview, uploadingImage, usesMdxSyntax])

  const clearParseError = useCallback(() => {
    parseErrorRequestRef.current += 1
    setParseError(null)
  }, [])

  useEffect(() => {
    savedValueRef.current = initialText
    valueRef.current = initialText
    setValue(initialText)
    setDirty(false)
    setError(null)
    setUploadingImage(false)
    clearParseError()
    setConflictOpen(false)
    setReloadConfirmOpen(false)
    setPendingPublicImageUpload(null)
    setEditorViewMode('rich-text')
    setActiveThreadId(null)
    setCommentsOpen(false)
    setCompactCommentsOpen(false)
    setCommentAnchoredDocumentHeight(0)
    commentsTouchedRef.current = false
    clearDraftPublicImages()
    beginExternalMarkdownSync(initialText)
    editorRef.current?.setMarkdown(initialText)
  }, [beginExternalMarkdownSync, clearDraftPublicImages, clearParseError, current.id, edit?.currentVersionId, initialText])

  useEffect(() => () => {
    clearExternalMarkdownSync()
    clearDraftPublicImages()
  }, [clearDraftPublicImages, clearExternalMarkdownSync])

  useLayoutEffect(() => {
    const root = editorContainerRef.current
    if (!root) return
    return observeDriveHierarchicalListMarkers(root)
  }, [])

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

  const handleSave = useCallback(async () => {
    if (!canSave || saveInFlightRef.current || !edit?.currentVersionId || !editContext) return
    saveInFlightRef.current = true
    setError(null)
    const submittedValue = valueRef.current
    let normalizedValue = normalizeMdxEditorImageMarkdown(submittedValue)
    let uploadedAssets: DrivePublicAssetDto[] = []
    let replacedDraftUrls: string[] = []
    try {
      const materialized = await materializeDraftPublicImages(
        normalizedValue,
        draftPublicImagesRef.current,
        uploadedAssets,
        setUploadingImage,
      )
      normalizedValue = materialized.markdown
      replacedDraftUrls = materialized.replacedDraftUrls
      if (hasTemporaryImageSource(normalizedValue)) {
        throw new Error('图片尚未完成上传，请重新粘贴或选择图片。')
      }
      await editContext.saveText({ text: normalizedValue, baseVersionId: edit.currentVersionId })
      clearParseError()
      if (normalizedValue !== submittedValue && valueRef.current === submittedValue) {
        valueRef.current = normalizedValue
        setValue(normalizedValue)
        beginExternalMarkdownSync(normalizedValue)
        editorRef.current?.setMarkdown(normalizedValue)
      } else if (materialized.replacements.length > 0 && valueRef.current !== submittedValue) {
        const currentValue = valueRef.current
        const nextCurrentValue = replaceDraftPublicImageUrls(currentValue, materialized.replacements)
        if (nextCurrentValue !== currentValue) {
          valueRef.current = nextCurrentValue
          setValue(nextCurrentValue)
          beginExternalMarkdownSync(nextCurrentValue)
          editorRef.current?.setMarkdown(nextCurrentValue)
        }
      }
      savedValueRef.current = normalizedValue
      clearDraftPublicImages(replacedDraftUrls)
      setDirty(valueRef.current !== normalizedValue)
      await annotations.refresh()
      setCommentBaselineRevision((revision) => revision + 1)
    } catch (saveError) {
      const cleanupFailed = await cleanupUploadedPublicAssets(uploadedAssets)
      if (saveError instanceof ApiError && saveError.status === 409) {
        setConflictOpen(true)
        if (cleanupFailed) setError('未保存图片清理失败。')
        return
      }
      setError(cleanupFailed ? '保存失败，未保存图片清理失败。' : saveError instanceof Error ? saveError.message : '保存失败。')
    } finally {
      saveInFlightRef.current = false
    }
  }, [annotations.refresh, beginExternalMarkdownSync, canSave, clearDraftPublicImages, clearParseError, edit?.currentVersionId, editContext])

  const handleSaveShortcut = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key.toLowerCase() !== 's' || (!event.metaKey && !event.ctrlKey) || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (canSave) void handleSave()
  }, [canSave, handleSave])

  const handleEditorError = useCallback((payload: { readonly error: unknown; readonly source: string }) => {
    const message = typeof payload.error === 'string'
      ? payload.error
      : payload.error instanceof Error
        ? payload.error.message
        : '解析失败。'
    const request = ++parseErrorRequestRef.current
    queueMicrotask(() => {
      if (parseErrorRequestRef.current !== request) return
      setValue(payload.source)
      valueRef.current = payload.source
      setParseError(message || '解析失败。')
    })
  }, [])

  const handleReload = useCallback(async () => {
    if (!editContext) return
    setError(null)
    try {
      const nextSnapshot = await editContext.reload()
      const nextText = nextSnapshot.preview?.text ?? ''
      savedValueRef.current = nextText
      valueRef.current = nextText
      setValue(nextText)
      setDirty(false)
      clearParseError()
      setConflictOpen(false)
      setReloadConfirmOpen(false)
      clearDraftPublicImages()
      beginExternalMarkdownSync(nextText)
      editorRef.current?.setMarkdown(nextText)
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : '重新加载失败。')
    }
  }, [beginExternalMarkdownSync, clearDraftPublicImages, clearParseError, editContext])

  const requestReload = useCallback(() => {
    if (dirty) {
      setReloadConfirmOpen(true)
      return
    }
    void handleReload()
  }, [dirty, handleReload])

  const setCommentPanelOpen = useCallback((open: boolean) => {
    commentsTouchedRef.current = true
    if (isCompact) {
      setCompactCommentsOpen(open)
      return
    }
    setCommentsOpen(open)
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
      id: 'mdxeditor-edit-status',
      label: dirty ? '未保存' : canEdit ? '已同步' : '只读',
    }]
    if (annotationsEnabled) {
      items.push({
        kind: 'toggle',
        id: 'mdxeditor-comments',
        label: `评论 ${railThreads.length}`,
        icon: MessageSquare,
        compactPlacement: 'primary',
        pressed: isCompact ? compactCommentsOpen : commentsOpen,
        onPressedChange: setCommentPanelOpen,
      })
    }
    if (imageSources.toolbarItem) items.push(imageSources.toolbarItem)
    if (loginRequired) {
      items.push({
        kind: 'button',
        id: 'mdxeditor-login',
        label: '登录后编辑',
        icon: LogIn,
        variant: 'outline',
        href: loginUrl,
      })
    }
    if (canEdit) {
      items.push(
        {
          kind: 'button',
          id: 'mdxeditor-reload',
          label: '重新加载',
          icon: RefreshCw,
          loading: editContext?.reloading,
          variant: 'outline',
          disabled: editContext?.reloading || editContext?.savingText,
          onClick: requestReload,
        },
        {
          kind: 'button',
          id: 'mdxeditor-save',
          label: '保存',
          icon: Save,
          ariaKeyShortcuts: 'Meta+S Control+S',
          compactPlacement: 'primary',
          loading: editContext?.savingText,
          disabled: !canSave,
          onClick: () => { void handleSave() },
        },
      )
    }
    return items
  }, [
    canEdit,
    canSave,
    compactCommentsOpen,
    commentsOpen,
    dirty,
    editContext?.reloading,
    editContext?.savingText,
    handleReload,
    handleSave,
    imageSources.toolbarItem,
    isCompact,
    loginRequired,
    loginUrl,
    railThreads.length,
    requestReload,
    setCommentPanelOpen,
    uploadingImage,
    annotationsEnabled,
  ])

  useRegisterDriveRendererToolbarItems('mdxeditor', toolbarItems)
  useRegisterDriveRendererUnsavedState('mdxeditor-unsaved', canEdit && dirty)

  const commentsPanelDefaultSize = resizablePanelPercent(MDXEDITOR_COMMENTS_PANEL_DEFAULT_SIZE)
  const commentsPanelMinSize = resizablePanelPercent(MDXEDITOR_COMMENTS_PANEL_MIN_SIZE)
  const commentsPanelMaxSize = resizablePanelPercent(MDXEDITOR_COMMENTS_PANEL_MAX_SIZE)
  const editorPanelDefaultSize = resizablePanelPercent(100 - MDXEDITOR_COMMENTS_PANEL_DEFAULT_SIZE)
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
      data-drive-mdxeditor-scroll='true'
      className='h-full min-h-0 overflow-auto overscroll-contain'
      onScroll={handleEditorScroll}
    >
      <div ref={editorContentHostRef} data-drive-mdxeditor-content-host='true' className='relative min-h-full'>
        {parseError || requiresSourceMode ? (
          <div className='mx-auto flex min-h-full max-w-4xl flex-col gap-3 px-4 py-6 md:px-6'>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-sm font-medium text-foreground'>源码</span>
              {parseError ? <span className='text-xs text-destructive'>解析失败</span> : null}
            </div>
            <Textarea
              value={value}
              readOnly={!canEdit}
              className='min-h-96 flex-1 font-mono text-sm'
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
          <MDXEditor
            ref={editorRef}
            markdown={value}
            readOnly={!canEdit}
            onError={handleEditorError}
            toMarkdownOptions={usesMdxSyntax ? undefined : commonMarkToMarkdownOptions}
            onChange={(nextValue, initialMarkdownNormalize) => {
              if (!canEdit) return
              valueRef.current = nextValue
              setValue(nextValue)
              const matchesExternalMarkdownTarget = applyingExternalMarkdownRef.current
                && externalMarkdownTargetRef.current === nextValue
              if (initialMarkdownNormalize || matchesExternalMarkdownTarget) {
                savedValueRef.current = nextValue
                setDirty(false)
                return
              }
              clearExternalMarkdownSync()
              setDirty(nextValue !== savedValueRef.current)
            }}
            plugins={plugins}
            translation={mdxEditorZhCnTranslation}
            className='min-h-full'
            contentEditableClassName={`drive-mdxeditor-content mx-auto min-h-full max-w-4xl px-4 pt-6 pb-12 md:px-6 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 ${DRIVE_HIERARCHICAL_LIST_MARKER_CLASSNAME}`}
          />
        )}
        {!sourceMode && geometry.overlayRects.length > 0 ? (
          <div aria-hidden data-drive-mdxeditor-comment-overlay='true' className='pointer-events-none absolute inset-0'>
            {geometry.overlayRects.map((rect) => (
              <div
                key={rect.key}
                data-drive-mdxeditor-comment-thread-id={rect.threadId}
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
        <div aria-hidden data-drive-mdxeditor-comment-bottom-compensation='true' style={{ height: commentBottomCompensation }} />
      ) : null}
    </div>
  )

  return (
    <div
      data-drive-mdxeditor-renderer='true'
      className='flex h-full min-h-0 w-full flex-col overflow-hidden'
      onKeyDown={handleSaveShortcut}
      onPasteCapture={handlePasteCapture}
    >
      <input
        ref={imageInputRef}
        type='file'
        className='hidden'
        accept={Object.keys(DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION).map((extension) => `.${extension}`).join(',')}
        disabled={!canEdit || uploadingImage}
        onChange={(event) => { void handleImageSelected(event) }}
      />
      <div data-drive-mdxeditor-layout='true' className='min-h-0 flex-1 overflow-hidden'>
        {isCompact || !commentsOpen ? editorView : (
          <ResizablePanelGroup orientation='horizontal' className='h-full min-h-0 overflow-hidden'>
            <ResizablePanel
              defaultSize={editorPanelDefaultSize}
              minSize='35%'
              data-mdxeditor-resizable-panel='editor'
              className='h-full min-h-0 min-w-0 overflow-hidden'
            >
              {editorView}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel
              defaultSize={commentsPanelDefaultSize}
              minSize={commentsPanelMinSize}
              maxSize={commentsPanelMaxSize}
              data-mdxeditor-resizable-panel='comments'
              className='h-full min-h-0 overflow-hidden'
            >
              <aside className='h-full min-h-0 overflow-hidden border-l bg-background'>
                {renderCommentsRail(sourceMode ? 'list' : 'anchored')}
              </aside>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
      {isCompact && annotationsEnabled ? (
        <Sheet open={compactCommentsOpen} onOpenChange={setCommentPanelOpen}>
          <SheetContent data-drive-telemetry-scope='portal' side='right' data-mdxeditor-sheet='comments' className='gap-0 overflow-hidden'>
            <SheetHeader className='sr-only'>
              <SheetTitle>评论</SheetTitle>
              <SheetDescription>查看和管理文档评论</SheetDescription>
            </SheetHeader>
            <div className='min-h-0 flex-1 overflow-auto'>{renderCommentsRail('list')}</div>
          </SheetContent>
        </Sheet>
      ) : null}
      {annotations.error ? (
        <div className='border-t px-3 py-2 text-xs text-muted-foreground'>{annotations.error}</div>
      ) : null}
      {error ? (
        <div className='border-t px-3 py-2 text-xs text-destructive'>{error}</div>
      ) : null}
      {uploadingImage ? (
        <div className='border-t px-3 py-2 text-xs text-muted-foreground'>上传中</div>
      ) : null}
      {preview.truncated ? (
        <div className='border-t px-3 py-2 text-xs text-muted-foreground'>内容已截断</div>
      ) : null}
      <AlertDialog open={reloadConfirmOpen} onOpenChange={setReloadConfirmOpen}>
        <AlertDialogContent data-drive-telemetry-scope='portal'>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃本地修改？</AlertDialogTitle>
            <AlertDialogDescription>
              重新加载会用服务器内容覆盖当前未保存编辑。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button type='button' variant='outline' onClick={() => downloadLocalVersion(current.name, value)}>
              <Download data-icon='inline-start' />
              下载本地版本
            </Button>
            <AlertDialogAction onClick={() => { void handleReload() }}>放弃并重新加载</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {imageSources.panel}
      <AlertDialog open={pendingPublicImageUpload !== null} onOpenChange={(open) => {
        if (!open) cancelPendingPublicImageUpload()
      }}>
        <AlertDialogContent data-drive-telemetry-scope='portal'>
          <AlertDialogHeader>
            <AlertDialogTitle>插入公开素材</AlertDialogTitle>
            <AlertDialogDescription>
              图片会在保存时作为公开素材生成可访问链接。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button type='button' onClick={() => { void uploadPendingPublicImage() }}>继续插入</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <AlertDialogContent data-drive-telemetry-scope='portal'>
          <AlertDialogHeader>
            <AlertDialogTitle>文件已有新内容</AlertDialogTitle>
            <AlertDialogDescription>
              你的编辑仍保留，可以下载到本地或重新加载。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button type='button' variant='outline' onClick={() => downloadLocalVersion(current.name, value)}>
              <Download data-icon='inline-start' />
              下载本地版本
            </Button>
            <AlertDialogAction onClick={() => { void handleReload() }}>重新加载</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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

function buildLoginUrl(): string {
  if (typeof window === 'undefined') return buildDashboardSignInUrl(undefined)
  return buildDashboardSignInUrl(window.location)
}

async function materializeDraftPublicImages(
  markdown: string,
  drafts: ReadonlyMap<string, DraftPublicImage>,
  uploadedAssets: DrivePublicAssetDto[],
  setUploadingImage: (uploading: boolean) => void,
): Promise<{
  readonly markdown: string
  readonly replacedDraftUrls: string[]
  readonly replacements: readonly DraftPublicImageReplacement[]
}> {
  const referencedDrafts = Array.from(drafts.values()).filter((draft) => markdown.includes(draft.url))
  if (referencedDrafts.length === 0) {
    return { markdown, replacedDraftUrls: [], replacements: [] }
  }

  let nextMarkdown = markdown
  const replacedDraftUrls: string[] = []
  const replacements: DraftPublicImageReplacement[] = []
  setUploadingImage(true)
  try {
    for (const draft of referencedDrafts) {
      const asset = await driveBrowserApi.uploadPublicAssetFile(draft.file, draft.input)
      uploadedAssets.push(asset)
      replacedDraftUrls.push(draft.url)
      replacements.push({ draftUrl: draft.url, assetUrl: asset.url })
      nextMarkdown = nextMarkdown.split(draft.url).join(asset.url)
    }
  } finally {
    setUploadingImage(false)
  }

  return { markdown: nextMarkdown, replacedDraftUrls, replacements }
}

type DraftPublicImageReplacement = {
  readonly draftUrl: string
  readonly assetUrl: string
}

function replaceDraftPublicImageUrls(markdown: string, replacements: readonly DraftPublicImageReplacement[]): string {
  let nextMarkdown = markdown
  for (const replacement of replacements) {
    nextMarkdown = nextMarkdown.split(replacement.draftUrl).join(replacement.assetUrl)
  }
  return nextMarkdown
}

async function cleanupUploadedPublicAssets(assets: readonly DrivePublicAssetDto[]): Promise<boolean> {
  if (assets.length === 0) return false
  const results = await Promise.allSettled(assets.map((asset) => driveApi.trashPublicAsset(asset.assetId)))
  return results.some((result) => result.status === 'rejected')
}

function downloadLocalVersion(name: string, value: string): void {
  const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function imageAltText(name: string): string {
  const fallback = 'image'
  const trimmed = name.trim()
  if (!trimmed) return fallback
  return trimmed.replace(/\.(?:png|jpe?g|gif|webp|avif|ico)$/iu, '') || fallback
}

function isMdxDocument(name: string): boolean {
  return /\.mdx$/iu.test(name)
}

function containsTopLevelMdxEsm(markdown: string): boolean {
  return someLineOutsideFencedCode(markdown, (line) => /^ {0,3}(?:import|export)(?:\s|\{|\*)/u.test(line))
}

function someLineOutsideFencedCode(markdown: string, predicate: (line: string) => boolean): boolean {
  let fence: { readonly marker: '`' | '~'; readonly length: number } | null = null
  for (const line of markdown.split(/\r?\n/u)) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/u.exec(line)
    if (fenceMatch) {
      const sequence = fenceMatch[1]
      const marker = sequence[0] as '`' | '~'
      if (!fence) {
        fence = { marker, length: sequence.length }
      } else if (marker === fence.marker && sequence.length >= fence.length) {
        fence = null
      }
      continue
    }
    if (fence) continue
    if (predicate(line)) return true
  }
  return false
}

function resolvePublicImageUploadInput(file: File): { readonly name: string; readonly mimeType: DrivePublicAssetImageMimeType } | null {
  const name = file.name || 'image.png'
  const mimeType = file.type || inferDrivePublicAssetMimeType(name)
  if (!isDrivePublicAssetImageMimeType(mimeType)) return null
  return { name, mimeType }
}

function publicImageUploadValidationError(file: File | null | undefined): string | null {
  if (!file || file.size <= 0) return '图片内容为空，请重新复制或选择图片。'
  if (!resolvePublicImageUploadInput(file)) return '格式不支持。'
  return null
}

function hasTemporaryImageSource(markdown: string): boolean {
  let found = false
  transformMarkdownOutsideCode(markdown, (segment) => {
    if (
      /!\[[^\r\n]*\]\(\s*<?blob:/iu.test(segment)
      || /^\s*\[[^\]\r\n]+\]:\s*<?blob:/imu.test(segment)
    ) found = true
    return segment
  })
  return found
}

function isDrivePublicAssetImageMimeType(value: string | null): value is DrivePublicAssetImageMimeType {
  return Boolean(value && DRIVE_PUBLIC_ASSET_IMAGE_MIME_TYPES.includes(value as DrivePublicAssetImageMimeType))
}

function hasPublicImageUploadConsent(): boolean {
  try {
    return window.localStorage.getItem(PUBLIC_IMAGE_UPLOAD_CONSENT_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function rememberPublicImageUploadConsent(): void {
  try {
    window.localStorage.setItem(PUBLIC_IMAGE_UPLOAD_CONSENT_STORAGE_KEY, 'true')
  } catch {
    // The current insertion can continue even if the browser refuses storage.
  }
}

function normalizeMdxEditorImageMarkdown(markdown: string): string {
  return transformMarkdownOutsideCode(markdown, (segment) => segment.replace(/<img\b[^>]*>/giu, (tag) => {
    const image = parseImageTag(tag)
    if (!image?.src) return tag
    const alt = image.alt ?? ''
    const title = image.title ? ` "${escapeMarkdownImageTitle(image.title)}"` : ''
    return `![${escapeMarkdownImageAlt(alt)}](${image.src}${title})`
  }))
}

function normalizeMdxEditorBreakTags(markdown: string): string {
  return transformMarkdownOutsideCode(
    markdown,
    (segment) => segment.replace(/<br\s*>/giu, '<br />'),
  )
}

function transformMarkdownOutsideCode(
  markdown: string,
  transform: (segment: string) => string,
): string {
  let fenceMarker: string | null = null
  let inlineCodeMarker: string | null = null

  return markdown.split(/(\r?\n)/u).map((line) => {
    if (/^\r?\n$/u.test(line)) return line

    if (fenceMarker) {
      const closingFence = new RegExp(`^ {0,3}${escapeRegExp(fenceMarker[0])}{${fenceMarker.length},}\\s*$`, 'u')
      if (closingFence.test(line)) fenceMarker = null
      return line
    }

    const openingFence = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
    if (openingFence && (openingFence[1][0] === '~' || !openingFence[2].includes('`'))) {
      fenceMarker = openingFence[1]
      return line
    }

    let result = ''
    let segment = ''
    for (let index = 0; index < line.length;) {
      if (line[index] === '`' && !isEscaped(line, index)) {
        const marker = /^`+/u.exec(line.slice(index))?.[0] ?? '`'
        if (inlineCodeMarker === null) {
          result += transform(segment)
          segment = ''
          inlineCodeMarker = marker
        } else if (inlineCodeMarker === marker) {
          result += segment
          segment = ''
          inlineCodeMarker = null
        } else {
          segment += marker
          index += marker.length
          continue
        }
        result += marker
        index += marker.length
        continue
      }

      segment += line[index]
      index += 1
    }
    result += inlineCodeMarker === null ? transform(segment) : segment
    return result
  }).join('')
}

function isEscaped(value: string, index: number): boolean {
  let backslashCount = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) backslashCount += 1
  return backslashCount % 2 === 1
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function parseImageTag(tag: string): { readonly src: string; readonly alt?: string; readonly title?: string } | null {
  if (typeof window === 'undefined' || typeof window.DOMParser === 'undefined') return null
  const document = new window.DOMParser().parseFromString(tag, 'text/html')
  const image = document.querySelector('img')
  if (!image) return null
  const src = image.getAttribute('src')?.trim()
  if (!src) return null
  return {
    src,
    alt: image.getAttribute('alt') ?? undefined,
    title: image.getAttribute('title') ?? undefined,
  }
}

function escapeMarkdownImageAlt(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/\]/gu, '\\]')
}

function escapeMarkdownImageTitle(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')
}
