import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
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
import type { MDXEditorMethods } from '@mdxeditor/editor'
import {
  DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION,
  inferDrivePublicAssetMimeType,
  type DriveBrowserEditDto,
  type DriveBrowserItemDto,
  type DriveBrowserPreviewDto,
  type DrivePublicAssetDto,
} from '@synapse/shared'
import { Download, ImagePlus, LogIn, RefreshCw, Save } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { ApiError, driveApi, driveBrowserApi } from '@/lib/api'
import { buildDashboardSignInUrl } from '@/lib/dashboard-redirect'
import type { DriveRendererEditContext } from './drive-renderer-shell'
import { useDriveMarkdownImageSources, type DriveMarkdownImageSourceContext } from './drive-markdown-image-sources'
import { mdxEditorZhCnTranslation } from './mdxeditor-zh-cn'
import { useRegisterDriveRendererToolbarItems, type DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

const PUBLIC_IMAGE_UPLOAD_CONSENT_STORAGE_KEY = 'synapse.drive.markdown.publicImageUploadConsent.v1'

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

export function DriveMDXeditorRenderer({
  current,
  preview,
  edit,
  editContext,
  imageSourceContext,
}: {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly editContext?: DriveRendererEditContext
  readonly imageSourceContext?: DriveMarkdownImageSourceContext
}) {
  const initialText = preview.text ?? ''
  const editorRef = useRef<MDXEditorMethods | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const savedValueRef = useRef(initialText)
  const valueRef = useRef(initialText)
  const applyingExternalMarkdownRef = useRef(false)
  const externalMarkdownTargetRef = useRef<string | null>(null)
  const externalMarkdownFrameRef = useRef<number | null>(null)
  const draftPublicImagesRef = useRef<Map<string, DraftPublicImage>>(new Map())
  const [value, setValue] = useState(initialText)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false)
  const [pendingPublicImageUpload, setPendingPublicImageUpload] = useState<PendingPublicImageUpload | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const canEdit = Boolean(edit?.canEdit && edit.currentVersionId && editContext)
  const loginRequired = edit?.reason === 'login_required'
  const loginUrl = buildLoginUrl()
  const imageSources = useDriveMarkdownImageSources({
    context: imageSourceContext,
    edit,
    editContext,
    disabled: dirty,
  })
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
  const confirmPublicImageUpload = useCallback((file: File) => {
    return new Promise<string>((resolve, reject) => {
      if (!canEdit) {
        reject(new Error('没有编辑权限。'))
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
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    imagePlugin({
      imageUploadHandler: confirmPublicImageUpload,
    }),
    tablePlugin(),
    codeBlockPlugin(),
    codeMirrorPlugin(),
    diffSourcePlugin({ viewMode: 'rich-text', diffMarkdown: '' }),
    markdownShortcutPlugin(),
  ], [canEdit, confirmPublicImageUpload, uploadingImage])

  useEffect(() => {
    savedValueRef.current = initialText
    valueRef.current = initialText
    setValue(initialText)
    setDirty(false)
    setError(null)
    setUploadingImage(false)
    setParseError(null)
    setConflictOpen(false)
    setReloadConfirmOpen(false)
    setPendingPublicImageUpload(null)
    clearDraftPublicImages()
    beginExternalMarkdownSync(initialText)
    editorRef.current?.setMarkdown(initialText)
  }, [beginExternalMarkdownSync, clearDraftPublicImages, current.id, edit?.currentVersionId, initialText])

  useEffect(() => () => {
    clearExternalMarkdownSync()
    clearDraftPublicImages()
  }, [clearDraftPublicImages, clearExternalMarkdownSync])

  const handleSave = useCallback(async () => {
    if (!canEdit || !edit?.currentVersionId || !editContext) return
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
      await editContext.saveText({ text: normalizedValue, baseVersionId: edit.currentVersionId })
      if (normalizedValue !== submittedValue && valueRef.current === submittedValue) {
        valueRef.current = normalizedValue
        setValue(normalizedValue)
        beginExternalMarkdownSync(normalizedValue)
        editorRef.current?.setMarkdown(normalizedValue)
      }
      savedValueRef.current = normalizedValue
      clearDraftPublicImages(replacedDraftUrls)
      setDirty(valueRef.current !== normalizedValue)
      setParseError(null)
    } catch (saveError) {
      const cleanupFailed = await cleanupUploadedPublicAssets(uploadedAssets)
      if (saveError instanceof ApiError && saveError.status === 409) {
        setConflictOpen(true)
        if (cleanupFailed) setError('未保存图片清理失败。')
        return
      }
      setError(cleanupFailed ? '保存失败，未保存图片清理失败。' : saveError instanceof Error ? saveError.message : '保存失败。')
    }
  }, [beginExternalMarkdownSync, canEdit, clearDraftPublicImages, edit?.currentVersionId, editContext])

  const handleEditorError = useCallback((payload: { readonly error: unknown; readonly source: string }) => {
    const message = typeof payload.error === 'string'
      ? payload.error
      : payload.error instanceof Error
        ? payload.error.message
        : '解析失败。'
    setValue(payload.source)
    valueRef.current = payload.source
    setParseError(message || '解析失败。')
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
      setParseError(null)
      setConflictOpen(false)
      setReloadConfirmOpen(false)
      clearDraftPublicImages()
      beginExternalMarkdownSync(nextText)
      editorRef.current?.setMarkdown(nextText)
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : '重新加载失败。')
    }
  }, [beginExternalMarkdownSync, clearDraftPublicImages, editContext])

  const requestReload = useCallback(() => {
    if (dirty) {
      setReloadConfirmOpen(true)
      return
    }
    void handleReload()
  }, [dirty, handleReload])

  const toolbarItems = useMemo<readonly DriveRendererToolbarItem[]>(() => {
    const items: DriveRendererToolbarItem[] = [{
      kind: 'status',
      id: 'mdxeditor-edit-status',
      label: dirty ? '未保存' : canEdit ? '已同步' : '只读',
    }]
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
          loading: editContext?.savingText,
          disabled: !dirty || uploadingImage || editContext?.savingText || editContext?.reloading,
          onClick: () => { void handleSave() },
        },
      )
    }
    return items
  }, [
    canEdit,
    dirty,
    editContext?.reloading,
    editContext?.savingText,
    handleReload,
    handleSave,
    imageSources.toolbarItem,
    loginRequired,
    loginUrl,
    requestReload,
    uploadingImage,
  ])

  useRegisterDriveRendererToolbarItems('mdxeditor', toolbarItems)

  return (
    <div
      data-drive-mdxeditor-renderer='true'
      className='flex h-full min-h-0 w-full flex-col overflow-hidden'
    >
      <input
        ref={imageInputRef}
        type='file'
        className='hidden'
        accept={Object.keys(DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION).map((extension) => `.${extension}`).join(',')}
        disabled={!canEdit || uploadingImage}
        onChange={(event) => { void handleImageSelected(event) }}
      />
      <div className='min-h-0 flex-1 overflow-auto'>
        {parseError ? (
          <div className='mx-auto flex min-h-full max-w-4xl flex-col gap-3 px-4 py-6 md:px-6'>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-sm font-medium text-foreground'>源码</span>
              <span className='text-xs text-destructive'>解析失败</span>
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
            contentEditableClassName='mx-auto min-h-full max-w-4xl px-4 py-6 md:px-6'
          />
        )}
      </div>
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
        <AlertDialogContent>
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
        <AlertDialogContent>
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
        <AlertDialogContent>
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
}> {
  const referencedDrafts = Array.from(drafts.values()).filter((draft) => markdown.includes(draft.url))
  if (referencedDrafts.length === 0) {
    return { markdown, replacedDraftUrls: [] }
  }

  let nextMarkdown = markdown
  const replacedDraftUrls: string[] = []
  setUploadingImage(true)
  try {
    for (const draft of referencedDrafts) {
      const asset = await driveBrowserApi.uploadPublicAssetFile(draft.file, draft.input)
      uploadedAssets.push(asset)
      replacedDraftUrls.push(draft.url)
      nextMarkdown = nextMarkdown.split(draft.url).join(asset.url)
    }
  } finally {
    setUploadingImage(false)
  }

  return { markdown: nextMarkdown, replacedDraftUrls, uploadedAssets }
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

function resolvePublicImageUploadInput(file: File): { readonly name: string; readonly mimeType: DrivePublicAssetImageMimeType } | null {
  const name = file.name || 'image.png'
  const mimeType = file.type || inferDrivePublicAssetMimeType(name)
  if (!isDrivePublicAssetImageMimeType(mimeType)) return null
  return { name, mimeType }
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
  return markdown.replace(/<img\b[^>]*>/giu, (tag) => {
    const image = parseImageTag(tag)
    if (!image?.src) return tag
    const alt = image.alt ?? ''
    const title = image.title ? ` "${escapeMarkdownImageTitle(image.title)}"` : ''
    return `![${escapeMarkdownImageAlt(alt)}](${image.src}${title})`
  })
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
