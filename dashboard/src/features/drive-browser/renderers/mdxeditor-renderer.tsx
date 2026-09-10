import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
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
  type DriveBrowserEditDto,
  type DriveBrowserItemDto,
  type DriveBrowserPreviewDto,
} from '@synapse/shared'
import { ImagePlus, LogIn, MessageSquare, RefreshCw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { DriveDocumentImageUploadContext } from '@/lib/api'
import { startDriveOperation, trackDriveEvent } from '../shared/drive-telemetry'
import type { DriveAnnotationContext } from '../use-drive-annotations'
import {
  DRIVE_HIERARCHICAL_LIST_MARKER_CLASSNAME,
  observeDriveHierarchicalListMarkers,
} from './drive-hierarchical-list-markers'
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
import type { DriveRendererEditContext } from './drive-renderer-shell'
import {
  commonMarkTextCompatibilityPlugin,
  commonMarkToMarkdownOptions,
  prepareCommonMarkForMdxEditor,
} from './mdxeditor-commonmark-compatibility-plugin'
import { mdxEditorCommentObserverPlugin } from './mdxeditor-comment-observer-plugin'
import { orderedListStartPlugin } from './mdxeditor-ordered-list-start-plugin'
import { tableCellLineBreakPlugin } from './mdxeditor-table-cell-line-break-plugin'
import { trailingImageParagraphPlugin } from './mdxeditor-trailing-image-plugin'
import { mdxEditorZhCnTranslation } from './mdxeditor-zh-cn'
import { useRegisterDriveRendererToolbarItems, useRegisterDriveRendererUnsavedState, type DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

const MDXEDITOR_COMMENTS_DATA_ATTRIBUTES = {
  layout: 'data-drive-mdxeditor-layout',
  scroll: 'data-drive-mdxeditor-scroll',
  contentHost: 'data-drive-mdxeditor-content-host',
  overlay: 'data-drive-mdxeditor-comment-overlay',
  overlayThreadId: 'data-drive-mdxeditor-comment-thread-id',
  bottomCompensation: 'data-drive-mdxeditor-comment-bottom-compensation',
  editorPanel: 'data-mdxeditor-resizable-panel',
  commentsPanel: 'data-mdxeditor-resizable-panel',
  sheet: 'data-mdxeditor-sheet',
} satisfies DriveDocumentEditorCommentsDataAttributes

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
  imageUploadContext,
}: {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly editContext?: DriveRendererEditContext
  readonly annotationContext?: DriveAnnotationContext
  readonly imageUploadContext?: DriveDocumentImageUploadContext
}) {
  const sourceText = preview.text ?? ''
  const usesMdxSyntax = isMdxDocument(current.name)
  const preparedInitialDocument = useMemo(
    () => prepareMdxEditorDocument(sourceText, usesMdxSyntax),
    [sourceText, usesMdxSyntax]
  )
  const initialText = preparedInitialDocument.markdown
  const editorRef = useRef<MDXEditorMethods | null>(null)
  const listMarkerObserverCleanupRef = useRef<(() => void) | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const applyingExternalMarkdownRef = useRef(false)
  const externalMarkdownTargetRef = useRef<string | null>(null)
  const externalMarkdownFrameRef = useRef<number | null>(null)
  const parseErrorRequestRef = useRef(0)
  const invalidateImageUploadsRef = useRef<() => void>(() => undefined)
  const [parseError, setParseError] = useState<string | null>(null)
  const [editorViewMode, setEditorViewMode] = useState<ViewMode>('rich-text')
  const handleEditorContainerChange = useCallback((root: HTMLDivElement | null) => {
    listMarkerObserverCleanupRef.current?.()
    listMarkerObserverCleanupRef.current = null
    if (root) listMarkerObserverCleanupRef.current = observeDriveHierarchicalListMarkers(root)
  }, [])
  const canEdit = Boolean(edit?.canEdit && edit.currentVersionId && editContext)
  const loginRequired = edit?.reason === 'login_required'
  const requiresSourceMode = preparedInitialDocument.requiresSourceMode
  const sourceMode = Boolean(parseError || requiresSourceMode || editorViewMode !== 'rich-text')
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
  const clearParseError = useCallback(() => {
    parseErrorRequestRef.current += 1
    setParseError(null)
  }, [])
  const handleReplaceValue = useCallback((markdown: string, reason: 'external' | 'reload' | 'save') => {
    invalidateImageUploadsRef.current()
    clearParseError()
    if (reason !== 'save') setEditorViewMode('rich-text')
    beginExternalMarkdownSync(markdown)
    editorRef.current?.setMarkdown(markdown)
    return markdown
  }, [beginExternalMarkdownSync, clearParseError])
  const lifecycle = useDriveDocumentEditorLifecycle({
    itemId: current.id,
    initialText,
    currentVersionId: edit?.currentVersionId,
    editContext,
    canEdit,
    telemetryComponent: 'drive-markdown-editor',
    onReplaceValue: handleReplaceValue,
    replaceInitialValue: true,
  })
  const {
    value,
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
    replaceValueWithoutDirtyChange,
    reload: handleReload,
    requestReload,
  } = lifecycle
  const { invalidatePendingUploads, uploadingImage, uploadDocumentImage, uploadOptionalDocumentImage } = useDriveDocumentImageUpload({
    canEdit,
    itemId: current.id,
    currentVersionId: edit?.currentVersionId,
    imageUploadContext,
    telemetryComponent: 'drive-markdown-editor',
    onError: setError,
  })
  invalidateImageUploadsRef.current = invalidatePendingUploads
  const canSave = lifecycle.canSave && !uploadingImage

  useEffect(() => {
    trackDriveEvent({ eventKey: 'web.drive.editor.open', component: 'drive-markdown-editor', action: 'open' })
    const finishDuration = startDriveOperation('web.drive.editor.duration', 'drive-markdown-editor')
    return () => finishDuration('success')
  }, [current.id])
  const relativeImagePreviewUrls = useMemo(
    () => new Map((preview.relativeImages ?? []).map(({ src, resolvedUrl }) => [src, resolvedUrl])),
    [preview.relativeImages],
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
  })
  const resolveImagePreview = useCallback(async (imageSource: string) => {
    if (!relativeImagePreviewUrls.has(imageSource)) return imageSource
    return relativeImagePreviewUrls.get(imageSource) ?? ''
  }, [relativeImagePreviewUrls])
  const handleEditorViewModeChange = useCallback((mode: ViewMode) => {
    setEditorViewMode(mode)
    comments.scheduleGeometry()
  }, [comments.scheduleGeometry])
  const handleDocumentImageUpload = uploadOptionalDocumentImage
  const insertDocumentImageMarkdown = useCallback((file: File, url: string) => {
    const markdown = `![${driveDocumentImageAltText(file.name)}](${url})`
    editorRef.current?.focus(() => {
      editorRef.current?.insertMarkdown(markdown)
    }, { defaultSelection: 'rootEnd' })
  }, [])
  const handleImageSelected = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !canEdit || !imageUploadContext) return
    const validationError = driveDocumentImageValidationError(file)
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    void uploadDocumentImage(file).then((url) => {
      insertDocumentImageMarkdown(file, url)
    }, () => undefined)
  }, [canEdit, imageUploadContext, insertDocumentImageMarkdown, uploadDocumentImage])
  const insertMixedClipboardImages = useCallback(async (files: readonly File[]) => {
    for (const file of files) {
      try {
        const url = await handleDocumentImageUpload(file)
        insertDocumentImageMarkdown(file, url)
      } catch {
        return
      }
    }
  }, [handleDocumentImageUpload, insertDocumentImageMarkdown])
  const handlePasteCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    if (!canEdit) return
    const items = Array.from(event.clipboardData.items)
    const imageItems = items.filter((item) => item.type.startsWith('image/'))
    if (imageItems.length === 0) return
    const files = imageItems.map((item) => item.getAsFile())
    const validationError = files.map((file) => driveDocumentImageValidationError(file)).find((message) => message !== null) ?? null
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
    linkPlugin({ disableAutoLink: true }),
    linkDialogPlugin(),
    imagePlugin({
      imageUploadHandler: handleDocumentImageUpload,
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
      onEditorUpdate: comments.notifyEditorUpdate,
      onViewModeChange: handleEditorViewModeChange,
    }),
    markdownShortcutPlugin(),
  ], [canEdit, comments.notifyEditorUpdate, handleDocumentImageUpload, handleEditorViewModeChange, resolveImagePreview, uploadingImage, usesMdxSyntax])

  useEffect(() => () => {
    clearExternalMarkdownSync()
  }, [clearExternalMarkdownSync])

  useEffect(() => () => {
    listMarkerObserverCleanupRef.current?.()
    listMarkerObserverCleanupRef.current = null
  }, [])

  const handleSave = useCallback(async () => {
    await lifecycle.save({
      blocked: uploadingImage,
      prepare: (submittedValue) => {
        const normalizedValue = normalizeMdxEditorImageMarkdown(submittedValue)
        return {
          text: normalizedValue,
          savedValue: normalizedValue,
          acknowledgedText: prepareMdxEditorDocument(normalizedValue, usesMdxSyntax).markdown,
        }
      },
      onSaved: async () => {
        clearParseError()
        await comments.refreshAfterSave()
      },
    })
  }, [clearParseError, comments.refreshAfterSave, lifecycle.save, uploadingImage, usesMdxSyntax])

  const handleSaveShortcut = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isDriveDocumentSaveShortcut(event)) return
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
      replaceValueWithoutDirtyChange(payload.source)
      setParseError(message || '解析失败。')
    })
  }, [replaceValueWithoutDirtyChange])

  const toolbarItems = useMemo<readonly DriveRendererToolbarItem[]>(() => {
    const items: DriveRendererToolbarItem[] = [{
      kind: 'status',
      id: 'mdxeditor-edit-status',
      label: dirty ? '未保存' : canEdit ? '已同步' : '只读',
    }]
    if (comments.annotationsEnabled) {
      items.push({
        kind: 'toggle',
        id: 'mdxeditor-comments',
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
          variant: 'ghost',
          disabled: editContext?.reloading || editContext?.savingText,
          onClick: requestReload,
        },
        {
          kind: 'button',
          id: 'mdxeditor-save',
          label: '保存',
          icon: Save,
          variant: 'default',
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
    comments.annotationsEnabled,
    comments.commentsOpen,
    comments.compactCommentsOpen,
    comments.isCompact,
    comments.railThreads.length,
    comments.setCommentPanelOpen,
    dirty,
    editContext?.reloading,
    editContext?.savingText,
    handleSave,
    loginRequired,
    loginUrl,
    requestReload,
  ])

  useRegisterDriveRendererToolbarItems('mdxeditor', toolbarItems)
  useRegisterDriveRendererUnsavedState('mdxeditor-unsaved', canEdit && dirty)

  const editorView = (
    parseError || requiresSourceMode ? (
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
            updateValue(event.currentTarget.value)
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
          const matchesExternalMarkdownTarget = applyingExternalMarkdownRef.current
            && externalMarkdownTargetRef.current === nextValue
          if (initialMarkdownNormalize || matchesExternalMarkdownTarget) {
            acceptValue(nextValue)
            return
          }
          clearExternalMarkdownSync()
          updateValue(nextValue)
        }}
        plugins={plugins}
        translation={mdxEditorZhCnTranslation}
        className='min-h-full'
        contentEditableClassName={`drive-mdxeditor-content mx-auto min-h-full max-w-4xl px-4 pt-6 pb-12 md:px-6 ${DRIVE_HIERARCHICAL_LIST_MARKER_CLASSNAME}`}
      />
    )
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
        accept={DRIVE_DOCUMENT_IMAGE_ACCEPT}
        disabled={!canEdit || uploadingImage}
        onChange={(event) => { void handleImageSelected(event) }}
      />
      <DriveDocumentEditorCommentsFrame
        comments={comments}
        dataAttributes={MDXEDITOR_COMMENTS_DATA_ATTRIBUTES}
        editorView={editorView}
        onEditorContainerChange={handleEditorContainerChange}
      />
      {comments.annotationError ? (
        <div className='border-t px-3 py-2 text-xs text-muted-foreground'>{comments.annotationError}</div>
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

function isMdxDocument(name: string): boolean {
  return /\.mdx$/iu.test(name)
}

function prepareMdxEditorDocument(sourceText: string, usesMdxSyntax: boolean) {
  if (!usesMdxSyntax) return prepareCommonMarkForMdxEditor(sourceText)
  const requiresSourceMode = containsTopLevelMdxEsm(sourceText)
  return {
    markdown: requiresSourceMode ? sourceText : normalizeMdxEditorBreakTags(sourceText),
    requiresSourceMode,
  }
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
