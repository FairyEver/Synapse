import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { Download, RefreshCw, Save } from 'lucide-react'
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
import { getCodeEditorLanguage } from '@/lib/code-editor-language'
import type { FileRendererEditContext } from './renderer-shell'
import { useRegisterFileRendererToolbarItems, type FileRendererToolbarItem } from './renderer-toolbar-context'

export function FileBrowserCodeRenderer({
  path,
  text,
  baseVersionId,
  truncated = false,
  editContext,
}: {
  readonly path: string
  readonly text: string
  readonly baseVersionId: string
  readonly truncated?: boolean
  readonly editContext?: FileRendererEditContext | null
}) {
  const language = getCodeEditorLanguage(path)
  const savedValueRef = useRef(text)
  const [value, setValue] = useState(text)
  const [versionId, setVersionId] = useState(baseVersionId)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false)
  const canEdit = Boolean(editContext)

  useEffect(() => {
    savedValueRef.current = text
    setValue(text)
    setVersionId(baseVersionId)
    setDirty(false)
    setError(null)
    setConflictOpen(false)
    setReloadConfirmOpen(false)
  }, [baseVersionId, path, text])

  const handleSave = useCallback(async () => {
    if (!editContext) return
    setError(null)
    try {
      const result = await editContext.saveText({ text: value, baseVersionId: versionId })
      savedValueRef.current = value
      setVersionId(result.baseVersionId)
      setDirty(false)
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 409) {
        setConflictOpen(true)
        return
      }
      setError(saveError instanceof Error ? saveError.message : '保存失败。')
    }
  }, [editContext, value, versionId])

  const handleReload = useCallback(async () => {
    if (!editContext) return
    setError(null)
    try {
      const next = await editContext.reload()
      savedValueRef.current = next.text
      setValue(next.text)
      setVersionId(next.baseVersionId)
      setDirty(false)
      setConflictOpen(false)
      setReloadConfirmOpen(false)
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : '重新加载失败。')
    }
  }, [editContext])

  const requestReload = useCallback(() => {
    if (dirty) {
      setReloadConfirmOpen(true)
      return
    }
    void handleReload()
  }, [dirty, handleReload])

  const toolbarItems = useMemo<readonly FileRendererToolbarItem[]>(() => {
    if (!canEdit) return []
    return [
      {
        kind: 'status',
        id: 'code-edit-status',
        label: dirty ? '未保存' : '已同步',
      },
      {
        kind: 'button',
        id: 'code-reload',
        label: '重新加载',
        icon: RefreshCw,
        loading: editContext?.reloading,
        variant: 'outline',
        disabled: editContext?.reloading || editContext?.savingText,
        onClick: requestReload,
      },
      {
        kind: 'button',
        id: 'code-save',
        label: '保存',
        icon: Save,
        loading: editContext?.savingText,
        disabled: !dirty || editContext?.savingText || editContext?.reloading,
        onClick: () => { void handleSave() },
      },
    ]
  }, [
    canEdit,
    dirty,
    editContext?.reloading,
    editContext?.savingText,
    handleSave,
    requestReload,
  ])

  useRegisterFileRendererToolbarItems('code-editor', toolbarItems)

  return (
    <div className='flex h-full min-h-0 w-full flex-col overflow-hidden'>
      <div className='min-h-0 flex-1'>
        <Editor
          height='100%'
          language={language}
          value={value}
          onChange={(nextValue) => {
            if (!canEdit) return
            const next = nextValue ?? ''
            setValue(next)
            setDirty(next !== savedValueRef.current)
          }}
          options={{
            minimap: { enabled: false },
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            fontSize: 13,
            tabSize: 2,
            readOnly: !canEdit,
            domReadOnly: !canEdit,
          }}
        />
      </div>
      {error ? <div className='border-t px-3 py-2 text-xs text-destructive'>{error}</div> : null}
      {truncated ? <div className='border-t px-3 py-2 text-xs text-muted-foreground'>内容已截断</div> : null}
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
            <Button type='button' variant='outline' onClick={() => downloadLocalVersion(path, value)}>
              <Download data-icon='inline-start' />
              下载本地版本
            </Button>
            <AlertDialogAction onClick={() => { void handleReload() }}>放弃并重新加载</AlertDialogAction>
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
            <Button type='button' variant='outline' onClick={() => downloadLocalVersion(path, value)}>
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

function downloadLocalVersion(path: string, value: string): void {
  const segments = path.split('/').filter(Boolean)
  const filename = segments.length > 0 ? segments[segments.length - 1] : 'file.txt'
  const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
