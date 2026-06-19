import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  codeBlockPlugin,
  codeMirrorPlugin,
  CreateLink,
  headingsPlugin,
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
import type { DriveBrowserEditDto, DriveBrowserItemDto, DriveBrowserPreviewDto } from '@synapse/shared'
import { Download, Loader2, LogIn, RefreshCw, Save } from 'lucide-react'
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
import { ApiError } from '@/lib/api'
import type { DriveRendererEditContext } from './drive-renderer-shell'

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
  const savedValueRef = useRef(initialText)
  const applyingExternalMarkdownRef = useRef(false)
  const externalMarkdownFrameRef = useRef<number | null>(null)
  const [value, setValue] = useState(initialText)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const canEdit = Boolean(edit?.canEdit && edit.currentVersionId && editContext)
  const loginRequired = edit?.reason === 'login_required'
  const loginUrl = useMemo(() => buildLoginUrl(), [])
  const clearExternalMarkdownSync = useCallback(() => {
    applyingExternalMarkdownRef.current = false
    if (externalMarkdownFrameRef.current !== null) {
      window.cancelAnimationFrame(externalMarkdownFrameRef.current)
      externalMarkdownFrameRef.current = null
    }
  }, [])
  const beginExternalMarkdownSync = useCallback(() => {
    applyingExternalMarkdownRef.current = true
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
  const plugins = useMemo(() => [
    toolbarPlugin({
      toolbarContents: () => (
        <>
          <UndoRedo />
          <BlockTypeSelect />
          <BoldItalicUnderlineToggles />
          <ListsToggle />
          <CreateLink />
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
    tablePlugin(),
    codeBlockPlugin(),
    codeMirrorPlugin(),
    markdownShortcutPlugin(),
  ], [])

  useEffect(() => {
    savedValueRef.current = initialText
    setValue(initialText)
    setDirty(false)
    setError(null)
    setConflictOpen(false)
    beginExternalMarkdownSync()
    editorRef.current?.setMarkdown(initialText)
  }, [beginExternalMarkdownSync, current.id, edit?.currentVersionId, initialText])

  useEffect(() => () => {
    clearExternalMarkdownSync()
  }, [clearExternalMarkdownSync])

  const handleSave = async () => {
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
  }

  const handleReload = async () => {
    if (!editContext) return
    setError(null)
    try {
      const nextSnapshot = await editContext.reload()
      const nextText = nextSnapshot.preview?.text ?? ''
      savedValueRef.current = nextText
      setValue(nextText)
      setDirty(false)
      setConflictOpen(false)
      beginExternalMarkdownSync()
      editorRef.current?.setMarkdown(nextText)
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : '重新加载失败。')
    }
  }

  return (
    <div
      data-drive-mdxeditor-renderer='true'
      className='flex h-full min-h-0 w-full flex-col overflow-hidden'
    >
      <div className='flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2'>
        <div className='min-w-0 text-xs text-muted-foreground'>
          {dirty ? '未保存' : canEdit ? '已同步' : '只读'}
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          {loginRequired ? (
            <Button asChild variant='outline' size='sm'>
              <a href={loginUrl}>
                <LogIn data-icon='inline-start' />
                登录后编辑
              </a>
            </Button>
          ) : null}
          {canEdit ? (
            <>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => { void handleReload() }}
                disabled={editContext?.reloading || editContext?.savingText}
              >
                {editContext?.reloading ? <Loader2 className='animate-spin' /> : <RefreshCw data-icon='inline-start' />}
                重新加载
              </Button>
              <Button
                type='button'
                size='sm'
                onClick={() => { void handleSave() }}
                disabled={!dirty || editContext?.savingText || editContext?.reloading}
              >
                {editContext?.savingText ? <Loader2 className='animate-spin' /> : <Save data-icon='inline-start' />}
                保存
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <div className='min-h-0 flex-1 overflow-auto'>
        <MDXEditor
          ref={editorRef}
          markdown={value}
          readOnly={!canEdit}
          onChange={(nextValue, initialMarkdownNormalize) => {
            if (!canEdit) return
            setValue(nextValue)
            if (initialMarkdownNormalize || applyingExternalMarkdownRef.current) {
              savedValueRef.current = nextValue
              setDirty(false)
              return
            }
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
  if (typeof window === 'undefined') return '/sign-in'
  const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`
  return `/sign-in?redirect=${encodeURIComponent(redirect)}`
}

function downloadLocalVersion(name: string, value: string): void {
  const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}
