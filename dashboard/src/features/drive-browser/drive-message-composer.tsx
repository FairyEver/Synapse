import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import {
  BoldItalicUnderlineToggles, codeBlockPlugin, codeMirrorPlugin, CreateLink,
  DiffSourceToggleWrapper, diffSourcePlugin, headingsPlugin, imagePlugin, InsertCodeBlock,
  linkDialogPlugin, linkPlugin, ListsToggle, listsPlugin, markdownShortcutPlugin, MDXEditor,
  quotePlugin, realmPlugin, tablePlugin, thematicBreakPlugin, toolbarPlugin, UndoRedo, viewMode$,
  type MDXEditorMethods, type ViewMode,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import { DRIVE_MESSAGE_BODY_MAX_LENGTH } from '@synapse/shared'
import { ImagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { DriveDocumentImageUploadContext } from '@/lib/api'
import { DRIVE_DOCUMENT_IMAGE_ACCEPT, driveDocumentImageAltText, driveDocumentImageValidationError, useDriveDocumentImageUpload } from './renderers/drive-document-image-upload'
import { commonMarkTextCompatibilityPlugin, commonMarkToMarkdownOptions, prepareCommonMarkForMdxEditor } from './renderers/mdxeditor-commonmark-compatibility-plugin'
import { orderedListStartPlugin } from './renderers/mdxeditor-ordered-list-start-plugin'
import { tableCellLineBreakPlugin } from './renderers/mdxeditor-table-cell-line-break-plugin'
import { trailingImageParagraphPlugin } from './renderers/mdxeditor-trailing-image-plugin'
import { mdxEditorZhCnTranslation } from './renderers/mdxeditor-zh-cn'

const observeViewMode = realmPlugin<{ readonly onChange: (mode: ViewMode) => void }>({
  init(realm, params) { if (params) realm.sub(viewMode$, params.onChange) },
})

export function DriveMessageComposer({ value, onChange, onSubmit, onCancel, busy, label, submitLabel, imageUploadContext, expanded = true, onExpand }: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onSubmit: () => void
  readonly onCancel?: () => void
  readonly busy: boolean
  readonly label: string
  readonly submitLabel: string
  readonly imageUploadContext?: DriveDocumentImageUploadContext
  readonly expanded?: boolean
  readonly onExpand?: () => void
}) {
  const editorRef = useRef<MDXEditorMethods | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const activeRef = useRef(true)
  const pendingRef = useRef(false)
  const modeRef = useRef<ViewMode>('rich-text')
  const valueRef = useRef(value)
  valueRef.current = value
  const [error, setError] = useState<string | null>(null)
  const [initialDocument] = useState(() => prepareCommonMarkForMdxEditor(value))
  const [sourceFallback, setSourceFallback] = useState(initialDocument.requiresSourceMode)
  const { uploadDocumentImage, uploadingImage, invalidatePendingUploads } = useDriveDocumentImageUpload({
    canEdit: !busy,
    itemId: imageUploadContext?.itemId ?? '',
    imageUploadContext,
    telemetryComponent: 'drive-message-editor',
    onError: setError,
  })
  useEffect(() => {
    activeRef.current = true
    return () => { activeRef.current = false }
  }, [])
  useEffect(() => {
    if (value !== editorRef.current?.getMarkdown()) editorRef.current?.setMarkdown(prepareCommonMarkForMdxEditor(value).markdown)
  }, [value])

  const insertImages = useCallback(async (files: readonly (File | null)[]) => {
    if (busy || pendingRef.current || !imageUploadContext || files.length === 0) return
    const validationError = files.map(driveDocumentImageValidationError).find(Boolean)
    if (validationError) { setError(validationError); return }
    pendingRef.current = true
    try {
      for (const file of files) {
        if (!file) continue
        const url = await uploadDocumentImage(file)
        if (!activeRef.current) return
        const alt = driveDocumentImageAltText(file.name).replace(/[\\[\]]/gu, '\\$&')
        const markdown = `![${alt}](${url})`
        if (!editorRef.current || modeRef.current === 'source') {
          const next = `${valueRef.current}\n\n${markdown}`.trim()
          valueRef.current = next
          onChange(next)
          editorRef.current?.setMarkdown(prepareCommonMarkForMdxEditor(next).markdown)
        } else {
          editorRef.current?.focus(() => editorRef.current?.insertMarkdown(markdown), { defaultSelection: 'rootEnd' })
        }
      }
    } catch (cause) {
      if (activeRef.current) setError(cause instanceof Error ? cause.message : '图片上传失败。')
    } finally {
      pendingRef.current = false
    }
  }, [busy, imageUploadContext, onChange, uploadDocumentImage])

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const images = Array.from(event.clipboardData.items).filter((item) => item.type.startsWith('image/'))
    if (!images.length) return
    event.preventDefault()
    event.stopPropagation()
    if (!expanded) onExpand?.()
    void insertImages(images.map((item) => item.getAsFile()))
  }
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files)
    if (!files.length) return
    event.preventDefault()
    event.stopPropagation()
    if (!expanded) onExpand?.()
    void insertImages(files)
  }
  const handleModeChange = useCallback((mode: ViewMode) => { modeRef.current = mode }, [])
  const plugins = useMemo(() => [
    toolbarPlugin({ toolbarContents: () => <>
      <UndoRedo />
      <DiffSourceToggleWrapper options={['rich-text', 'source']}>
        <BoldItalicUnderlineToggles options={['Bold', 'Italic']} />
        <ListsToggle />
        <CreateLink />
        <InsertCodeBlock />
      </DiffSourceToggleWrapper>
    </> }),
    headingsPlugin(), listsPlugin(), orderedListStartPlugin(), quotePlugin(), thematicBreakPlugin(),
    linkPlugin({ disableAutoLink: true }), linkDialogPlugin(),
    imagePlugin({ disableImageResize: true, disableImageSettingsButton: true }), trailingImageParagraphPlugin(),
    tablePlugin(), tableCellLineBreakPlugin(), codeBlockPlugin(), codeMirrorPlugin(),
    commonMarkTextCompatibilityPlugin(), diffSourcePlugin({ viewMode: 'rich-text', diffMarkdown: '' }),
    observeViewMode({ onChange: handleModeChange }), markdownShortcutPlugin(),
  ], [handleModeChange])
  const tooLong = value.trim().length > DRIVE_MESSAGE_BODY_MAX_LENGTH

  return <div
    data-drive-message-editor
    role='group'
    aria-label={label}
    className='space-y-2'
    onPasteCapture={handlePaste}
    onDropCapture={handleDrop}
    onDragOverCapture={(event) => { if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault() }}
    onKeyDown={(event) => {
      event.stopPropagation()
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') event.preventDefault()
    }}
  >
    {!expanded ? <Textarea aria-label={label} placeholder='写下留言…' rows={3} value={value} disabled={busy} onChange={(event) => onChange(event.target.value)} onFocus={onExpand} /> : <>
      {sourceFallback ? <Textarea autoFocus aria-label={label} value={value} disabled={busy} onChange={(event) => onChange(event.target.value)} /> : <div className='rounded-md border'>
        <MDXEditor
          ref={editorRef}
          autoFocus
          placeholder='写下留言…'
          markdown={initialDocument.markdown}
          plugins={plugins}
          readOnly={busy}
          translation={mdxEditorZhCnTranslation}
          toMarkdownOptions={commonMarkToMarkdownOptions}
          contentEditableClassName='drive-mdxeditor-content min-h-24 max-h-72 overflow-y-auto px-3 py-2'
          onChange={(markdown, initialNormalize) => { if (!initialNormalize) onChange(markdown) }}
          onError={() => { setSourceFallback(true); setError('格式无法编辑，请修改 Markdown 源码。') }}
        />
      </div>}
      <input ref={fileInputRef} type='file' multiple accept={DRIVE_DOCUMENT_IMAGE_ACCEPT} className='hidden' disabled={busy || uploadingImage} onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? [])
        event.currentTarget.value = ''
        void insertImages(files)
      }} />
      <div className='flex flex-wrap items-center gap-2'>
        <Button type='button' disabled={busy || uploadingImage || !value.trim() || tooLong} onClick={() => { if (!pendingRef.current) onSubmit() }}>{submitLabel}</Button>
        <Button type='button' variant='ghost' disabled={busy || uploadingImage || !imageUploadContext} onClick={() => fileInputRef.current?.click()}><ImagePlus data-icon='inline-start' />插入图片</Button>
        {onCancel ? <Button type='button' variant='ghost' disabled={busy} onClick={() => { invalidatePendingUploads(); onCancel() }}>取消</Button> : null}
        {uploadingImage ? <span role='status' className='text-sm text-muted-foreground'>上传中</span> : null}
      </div>
      {tooLong ? <p role='alert' className='text-sm text-destructive'>留言内容不能超过 4000 字符。</p> : null}
      {error ? <p role='alert' className='text-sm text-destructive'>{error}</p> : null}
    </>}
  </div>
}
