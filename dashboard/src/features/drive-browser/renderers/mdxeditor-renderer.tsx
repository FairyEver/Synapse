import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  codeBlockPlugin,
  codeMirrorPlugin,
  CreateLink,
  headingsPlugin,
  imagePlugin,
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
import { ApiError, driveBrowserApi } from '@/lib/api'
import { buildDashboardSignInUrl } from '@/lib/dashboard-redirect'
import type { DriveRendererEditContext } from './drive-renderer-shell'
import { useRegisterDriveRendererToolbarItems, type DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

export function DriveMDXeditorRenderer({
  current,
  preview,
  edit,
  editContext,
}: {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly editContext?: DriveRendererEditContext
}) {
  const initialText = preview.text ?? ''
  const editorRef = useRef<MDXEditorMethods | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const savedValueRef = useRef(initialText)
  const applyingExternalMarkdownRef = useRef(false)
  const externalMarkdownTargetRef = useRef<string | null>(null)
  const externalMarkdownFrameRef = useRef<number | null>(null)
  const [value, setValue] = useState(initialText)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [conflictOpen, setConflictOpen] = useState(false)
  const canEdit = Boolean(edit?.canEdit && edit.currentVersionId && editContext)
  const loginRequired = edit?.reason === 'login_required'
  const loginUrl = useMemo(() => buildLoginUrl(), [])
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
  const uploadImage = useCallback(async (file: File) => {
    const name = file.name || 'image.png'
    const mimeType = file.type || inferDrivePublicAssetMimeType(name)
    if (!mimeType || !Object.values(DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION).includes(mimeType)) {
      setError('格式不支持。')
      throw new Error('格式不支持。')
    }
    setUploadingImage(true)
    setError(null)
    try {
      const asset = await driveBrowserApi.uploadPublicAssetFile(file, { name, mimeType })
      return asset.url
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '图片上传失败。')
      throw uploadError
    } finally {
      setUploadingImage(false)
    }
  }, [])
  const handleImageSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !canEdit) return
    try {
      const url = await uploadImage(file)
      const markdown = `![${imageAltText(file.name)}](${url})`
      editorRef.current?.focus(() => {
        editorRef.current?.insertMarkdown(markdown)
      }, { defaultSelection: 'rootEnd' })
    } catch {
      // Error state is set by uploadImage.
    }
  }, [canEdit, uploadImage])
  const plugins = useMemo(() => [
    toolbarPlugin({
      toolbarContents: () => (
        <>
          <UndoRedo />
          <BlockTypeSelect />
          <BoldItalicUnderlineToggles />
          <ListsToggle />
          <CreateLink />
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
      imageUploadHandler: uploadImage,
    }),
    tablePlugin(),
    codeBlockPlugin(),
    codeMirrorPlugin(),
    markdownShortcutPlugin(),
  ], [canEdit, uploadImage, uploadingImage])

  useEffect(() => {
    savedValueRef.current = initialText
    setValue(initialText)
    setDirty(false)
    setError(null)
    setUploadingImage(false)
    setConflictOpen(false)
    beginExternalMarkdownSync(initialText)
    editorRef.current?.setMarkdown(initialText)
  }, [beginExternalMarkdownSync, current.id, edit?.currentVersionId, initialText])

  useEffect(() => () => {
    clearExternalMarkdownSync()
  }, [clearExternalMarkdownSync])

  const handleSave = useCallback(async () => {
    if (!canEdit || !edit?.currentVersionId || !editContext) return
    setError(null)
    try {
      await editContext.saveText({ text: value, baseVersionId: edit.currentVersionId })
      savedValueRef.current = value
      setDirty(false)
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 409) {
        setConflictOpen(true)
        return
      }
      setError(saveError instanceof Error ? saveError.message : '保存失败。')
    }
  }, [canEdit, edit?.currentVersionId, editContext, value])

  const handleReload = useCallback(async () => {
    if (!editContext) return
    setError(null)
    try {
      const nextSnapshot = await editContext.reload()
      const nextText = nextSnapshot.preview?.text ?? ''
      savedValueRef.current = nextText
      setValue(nextText)
      setDirty(false)
      setConflictOpen(false)
      beginExternalMarkdownSync(nextText)
      editorRef.current?.setMarkdown(nextText)
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : '重新加载失败。')
    }
  }, [beginExternalMarkdownSync, editContext])

  const toolbarItems = useMemo<readonly DriveRendererToolbarItem[]>(() => {
    const items: DriveRendererToolbarItem[] = [{
      kind: 'status',
      id: 'mdxeditor-edit-status',
      label: dirty ? '未保存' : canEdit ? '已同步' : '只读',
    }]
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
          onClick: () => { void handleReload() },
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
    loginRequired,
    loginUrl,
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
        <MDXEditor
          ref={editorRef}
          markdown={value}
          readOnly={!canEdit}
          onChange={(nextValue, initialMarkdownNormalize) => {
            if (!canEdit) return
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
          className='h-full min-h-full'
          contentEditableClassName='mx-auto min-h-full max-w-4xl px-4 py-6 md:px-6'
        />
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
