import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import { EditorStatus } from '@milkdown/kit/core'
import { insert, replaceAll } from '@milkdown/kit/utils'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import {
  type DriveBrowserEditDto,
  type DriveBrowserItemDto,
  type DriveBrowserPreviewDto,
} from '@synapse/shared'
import { ImagePlus, LogIn, MessageSquare, RefreshCw, Save } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import type { DriveDocumentImageUploadContext } from '@/lib/api'
import type { DriveAnnotationContext } from '../use-drive-annotations'
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
  isDriveDocumentSaveShortcut,
  useDriveDocumentEditorLifecycle,
} from './drive-document-editor-lifecycle'
import {
  DriveDocumentEditorCommentsFrame,
  useDriveDocumentEditorComments,
  type DriveDocumentEditorCommentsDataAttributes,
} from './drive-document-editor-comments'
import { MILKDOWN_COMMENT_IGNORED_SELECTOR } from './drive-editor-comment-geometry'
import { observeDriveHierarchicalListMarkers } from './drive-hierarchical-list-markers'
import { configureMilkdownCommonMarkImages } from './milkdown-commonmark-images'
import type { DriveRendererEditContext } from './drive-renderer-shell'
import { useRegisterDriveRendererToolbarItems, useRegisterDriveRendererUnsavedState, type DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

const MILKDOWN_COMMENTS_DATA_ATTRIBUTES = {
  layout: 'data-drive-milkdown-layout',
  scroll: 'data-drive-milkdown-scroll',
  contentHost: 'data-drive-milkdown-content-host',
  overlay: 'data-drive-milkdown-comment-overlay',
  overlayThreadId: 'data-drive-milkdown-comment-thread-id',
  bottomCompensation: 'data-drive-milkdown-comment-bottom-compensation',
  editorPanel: 'data-milkdown-resizable-panel',
  commentsPanel: 'data-milkdown-resizable-panel',
  sheet: 'data-milkdown-sheet',
} satisfies DriveDocumentEditorCommentsDataAttributes

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
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const sourceTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingSourceImageSelectionRef = useRef<SourceTextareaSelection | null>(null)
  const pendingSourceFocusRef = useRef<SourceTextareaSelection | null>(null)
  const activeDocumentIdRef = useRef(current.id)
  activeDocumentIdRef.current = current.id
  const applyingExternalMarkdownRef = useRef(false)
  const externalMarkdownTargetRef = useRef<string | null>(null)
  const externalMarkdownFrameRef = useRef<number | null>(null)
  const pendingExternalMarkdownRef = useRef<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const canEdit = Boolean(edit?.canEdit && edit.currentVersionId && editContext)
  const loginRequired = edit?.reason === 'login_required'
  const requiresSourceMode = requiresMilkdownSourceMode(initialText)
  const sourceMode = Boolean(parseError || requiresSourceMode)
  const loginUrl = buildDriveDocumentEditorLoginUrl()
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
      return markdown
    }
    beginExternalMarkdownSync(markdown)
    crepe.editor.action(replaceAll(markdown, true))
    const normalizedMarkdown = preserveMilkdownCommonMarkAutolinks(crepe.getMarkdown(), markdown)
    externalMarkdownTargetRef.current = normalizedMarkdown
    return normalizedMarkdown
  }, [beginExternalMarkdownSync])
  const handleReplaceValue = useCallback((markdown: string) => {
    setParseError(null)
    pendingSourceImageSelectionRef.current = null
    pendingSourceFocusRef.current = null
    return replaceEditorMarkdown(markdown)
  }, [replaceEditorMarkdown])
  const lifecycle = useDriveDocumentEditorLifecycle({
    itemId: current.id,
    initialText,
    currentVersionId: edit?.currentVersionId,
    editContext,
    canEdit,
    telemetryComponent: 'drive-milkdown-editor',
    onReplaceValue: handleReplaceValue,
  })
  const {
    value,
    valueRef,
    saveAcknowledged,
    dirty,
    error,
    setError,
    conflictOpen,
    setConflictOpen,
    reloadConfirmOpen,
    setReloadConfirmOpen,
    updateValue,
    acceptValue,
    reload: handleReload,
    requestReload,
  } = lifecycle
  const { uploadingImage, uploadDocumentImage, uploadOptionalDocumentImage } = useDriveDocumentImageUpload({
    canEdit,
    imageUploadContext,
    lifecycleKey: current.id,
    telemetryComponent: 'drive-milkdown-editor',
    onError: setError,
  })
  const canSave = lifecycle.canSave && !uploadingImage

  useEffect(() => {
    trackDriveEvent({ eventKey: 'web.drive.editor.open', component: 'drive-milkdown-editor', action: 'open' })
    const finishDuration = startDriveOperation('web.drive.editor.duration', 'drive-milkdown-editor')
    return () => finishDuration('success')
  }, [current.id])

  const relativeImagePreviewUrls = useMemo(
    () => new Map((preview.relativeImages ?? []).map(({ src, resolvedUrl }) => [src, resolvedUrl])),
    [preview.relativeImages]
  )
  const comments = useDriveDocumentEditorComments({
    current,
    currentVersionId: edit?.currentVersionId,
    annotationContext,
    projection: preview.markdownProjection,
    imagePreviewUrls: relativeImagePreviewUrls,
    sourceMode,
    stateResetKey: initialText,
    preserveStateOnReset: saveAcknowledged,
    contentRootSelector: '.milkdown .ProseMirror',
    ignoredElementSelector: MILKDOWN_COMMENT_IGNORED_SELECTOR,
  })
  const resolveImagePreview = useCallback((imageSource: string) => {
    if (!relativeImagePreviewUrls.has(imageSource)) return imageSource
    return relativeImagePreviewUrls.get(imageSource) ?? ''
  }, [relativeImagePreviewUrls])

  const handleCrepeReady = useCallback((crepe: Crepe) => {
    crepeRef.current = crepe
    crepe.setReadonly(!canEdit)
    const pendingMarkdown = pendingExternalMarkdownRef.current
    pendingExternalMarkdownRef.current = null
    if (pendingMarkdown !== null && pendingMarkdown !== crepe.getMarkdown()) {
      acceptValue(replaceEditorMarkdown(pendingMarkdown))
    } else {
      const normalizedMarkdown = preserveMilkdownCommonMarkAutolinks(crepe.getMarkdown(), initialText)
      acceptValue(normalizedMarkdown)
    }
    comments.scheduleGeometry()
  }, [acceptValue, canEdit, comments.scheduleGeometry, initialText, replaceEditorMarkdown])
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
    const root = comments.editorContentHostRef.current
    if (!root || sourceMode) return
    return observeDriveHierarchicalListMarkers(root)
  }, [comments.editorContentHostRef, current.id, sourceMode])

  useEffect(() => () => {
    clearExternalMarkdownSync()
    crepeRef.current = null
  }, [clearExternalMarkdownSync])

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
    const matchesExternalTarget = applyingExternalMarkdownRef.current
      && externalMarkdownTargetRef.current === sourcePreservedValue
    if (matchesExternalTarget) {
      acceptValue(sourcePreservedValue)
      comments.notifyEditorUpdate()
      return
    }
    clearExternalMarkdownSync()
    updateValue(sourcePreservedValue)
    comments.notifyEditorUpdate()
  }, [acceptValue, canEdit, clearExternalMarkdownSync, comments.notifyEditorUpdate, updateValue, valueRef])

  const handleSave = useCallback(async () => {
    await lifecycle.save({ blocked: uploadingImage, onSaved: comments.refreshAfterSave })
  }, [comments.refreshAfterSave, lifecycle.save, uploadingImage])

  const handleSaveShortcut = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isDriveDocumentSaveShortcut(event)) return
    event.preventDefault()
    if (canSave) void handleSave()
  }, [canSave, handleSave])

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
    updateValue(nextValue)
  }, [updateValue, valueRef])
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

  const toolbarItems = useMemo<readonly DriveRendererToolbarItem[]>(() => {
    const items: DriveRendererToolbarItem[] = [{
      kind: 'status',
      id: 'milkdown-edit-status',
      label: dirty ? '未保存' : canEdit ? '已同步' : '只读',
    }]
    if (comments.annotationsEnabled) {
      items.push({
        kind: 'toggle',
        id: 'milkdown-comments',
        label: `评论 ${comments.railThreads.length}`,
        icon: MessageSquare,
        compactPlacement: 'primary',
        pressed: comments.isCompact ? comments.compactCommentsOpen : comments.commentsOpen,
        onPressedChange: comments.setCommentPanelOpen,
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
  }, [canEdit, canSave, captureSourceSelection, comments.annotationsEnabled, comments.commentsOpen, comments.compactCommentsOpen, comments.isCompact, comments.railThreads.length, comments.setCommentPanelOpen, dirty, editContext?.reloading, editContext?.savingText, handleSave, loginRequired, loginUrl, requestReload, sourceMode, uploadingImage])

  useRegisterDriveRendererToolbarItems('milkdown', toolbarItems)
  useRegisterDriveRendererUnsavedState('milkdown-unsaved', canEdit && dirty)

  const editorView = (
    sourceMode ? (
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
            updateValue(event.currentTarget.value)
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
            onEditorUpdate={comments.notifyEditorUpdate}
            onReady={handleCrepeReady}
            onFailure={handleCrepeFailure}
            onDestroy={handleCrepeDestroy}
            onUpload={uploadDocumentImage}
            proxyDomURL={resolveImagePreview}
          />
        </MilkdownProvider>
      </div>
    )
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
      <DriveDocumentEditorCommentsFrame
        comments={comments}
        dataAttributes={MILKDOWN_COMMENTS_DATA_ATTRIBUTES}
        editorView={editorView}
      />
      {comments.annotationError ? <div className='border-t px-3 py-2 text-xs text-muted-foreground'>{comments.annotationError}</div> : null}
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
