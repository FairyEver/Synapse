import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import type { DriveBrowserEditDto, DriveBrowserItemDto, DriveBrowserPreviewDto } from '@synapse/shared'
import { Download, LogIn, RefreshCw, Save } from 'lucide-react'
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
import { getCodeEditorLanguage } from '@/lib/code-editor-language'
import { buildDashboardSignInUrl } from '@/lib/dashboard-redirect'
import { ApiError } from '@/lib/api'
import type { DriveRendererEditContext } from './drive-renderer-shell'
import { useRegisterDriveRendererToolbarItems, useRegisterDriveRendererUnsavedState, type DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

export function DriveCodeRenderer({
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
  const language = getCodeEditorLanguage(current.name)
  const initialText = preview.text ?? ''
  const savedValueRef = useRef(initialText)
  const valueRef = useRef(initialText)
  const [value, setValue] = useState(initialText)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false)
  const canEdit = Boolean(edit?.canEdit && edit.currentVersionId && editContext)
  const loginRequired = edit?.reason === 'login_required'
  const loginUrl = buildLoginUrl()

  useEffect(() => {
    savedValueRef.current = initialText
    valueRef.current = initialText
    setValue(initialText)
    setDirty(false)
    setError(null)
    setConflictOpen(false)
    setReloadConfirmOpen(false)
  }, [current.id, edit?.currentVersionId, initialText])

  const handleSave = useCallback(async () => {
    if (!canEdit || !edit?.currentVersionId || !editContext) return
    setError(null)
    const submittedValue = valueRef.current
    try {
      await editContext.saveText({ text: submittedValue, baseVersionId: edit.currentVersionId })
      savedValueRef.current = submittedValue
      setDirty(valueRef.current !== submittedValue)
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 409) {
        setConflictOpen(true)
        return
      }
      setError(saveError instanceof Error ? saveError.message : '保存失败。')
    }
  }, [canEdit, edit?.currentVersionId, editContext])

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

  const toolbarItems = useMemo<readonly DriveRendererToolbarItem[]>(() => {
    if (!canEdit && !loginRequired) return []
    const items: DriveRendererToolbarItem[] = [{
      kind: 'status',
      id: 'code-edit-status',
      label: dirty ? '未保存' : canEdit ? '已同步' : '只读',
    }]
    if (loginRequired) {
      items.push({
        kind: 'button',
        id: 'code-login',
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
    requestReload,
  ])

  useRegisterDriveRendererToolbarItems('code-editor', toolbarItems)
  useRegisterDriveRendererUnsavedState('code-editor-unsaved', canEdit && dirty)

  return (
    <div
      data-drive-code-renderer='true'
      data-drive-code-language={language}
      className='flex h-full min-h-0 w-full flex-col overflow-hidden'
    >
      <div className='min-h-0 flex-1'>
        <Editor
          height='100%'
          language={language}
          value={value}
          onChange={(nextValue) => {
            if (!canEdit) return
            const nextText = nextValue ?? ''
            valueRef.current = nextText
            setValue(nextText)
            setDirty(nextText !== savedValueRef.current)
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
      {error ? (
        <div className='border-t px-3 py-2 text-xs text-destructive'>{error}</div>
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
