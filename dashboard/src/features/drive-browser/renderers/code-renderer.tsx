import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { DriveBrowserCollaborationCapabilityDto, DriveBrowserEditDto, DriveBrowserItemDto, DriveBrowserPreviewDto, DriveCollaborationJoinContext } from '@synapse/shared'
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
import { trackedDriveBrowserApi as driveBrowserApi } from '../shared/drive-telemetry-api'
import { useDriveCollaboration } from '../collaboration/use-drive-collaboration'
import { createMonacoCollaborationBinding } from './monaco-collaboration-binding'
import type { DriveRendererEditContext } from './drive-renderer-shell'
import { useRegisterDriveRendererToolbarItems, useRegisterDriveRendererUnsavedState, type DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

export function DriveCodeRenderer({
  current,
  preview,
  edit,
  editContext,
  collaboration,
  collaborationContext,
}: {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly editContext?: DriveRendererEditContext
  readonly collaboration?: DriveBrowserCollaborationCapabilityDto | null
  readonly collaborationContext?: DriveCollaborationJoinContext
}) {
  const language = getCodeEditorLanguage(current.name)
  const initialText = preview.text ?? ''
  const savedValueRef = useRef(initialText)
  const valueRef = useRef(initialText)
  const saveInFlightRef = useRef(false)
  const [value, setValue] = useState(initialText)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false)
  const [bindingReady, setBindingReady] = useState(false)
  const [savingVersion, setSavingVersion] = useState(false)
  const collaborationState = useDriveCollaboration({
    itemId: current.id,
    context: collaborationContext ?? { kind: 'owner', itemId: current.id },
    capability: collaboration,
    onEpochReloadRequired: editContext?.reload,
  })
  const collaborationEnabled = Boolean(collaboration?.enabled)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const bindingRef = useRef<{ destroy: () => void } | null>(null)
  const bindingGenerationRef = useRef(0)
  const saveShortcutRef = useRef<() => void>(() => undefined)
  const canEdit = collaborationEnabled
    ? Boolean(collaborationState.state?.canWrite)
    : Boolean(edit?.canEdit && edit.currentVersionId && editContext)
  const loginRequired = edit?.reason === 'login_required'
  const loginUrl = buildLoginUrl()
  const canSave = collaborationEnabled
    ? canEdit
      && collaborationState.state?.status !== 'connecting'
      && collaborationState.state?.status !== 'syncing'
      && !savingVersion
    : canEdit
      && dirty
      && !editContext?.savingText
      && !editContext?.reloading

  useEffect(() => {
    savedValueRef.current = initialText
    valueRef.current = initialText
    setValue(initialText)
    setDirty(false)
    setError(null)
    setConflictOpen(false)
    setReloadConfirmOpen(false)
  }, [current.id, edit?.currentVersionId, initialText])

  const attachCollaborationBinding = useCallback(async (session: NonNullable<typeof collaborationState.session>, editor: Parameters<OnMount>[0]) => {
    const model = editor.getModel()
    if (!model || session.doc.isDestroyed) return
    const generation = ++bindingGenerationRef.current
    setBindingReady(false)
    try {
      const binding = await createMonacoCollaborationBinding(session.text, model, new Set([editor]), session.awareness)
      if (generation !== bindingGenerationRef.current || session.doc.isDestroyed || editorRef.current !== editor) {
        binding.destroy()
        return
      }
      bindingRef.current?.destroy()
      bindingRef.current = binding
      setBindingReady(true)
    } catch {
      if (generation !== bindingGenerationRef.current) return
      setBindingReady(false)
      setError('协同编辑器加载失败。')
    }
  }, [])

  useEffect(() => {
    const session = collaborationState.session
    const editor = editorRef.current
    if (session && editor) void attachCollaborationBinding(session, editor)
    return () => {
      bindingGenerationRef.current += 1
      bindingRef.current?.destroy()
      bindingRef.current = null
      setBindingReady(false)
    }
  }, [attachCollaborationBinding, collaborationState.session])

  const handleEditorMount = useCallback<OnMount>((editor, monaco) => {
    editorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveShortcutRef.current())
    const session = collaborationState.session
    if (session) void attachCollaborationBinding(session, editor)
  }, [attachCollaborationBinding, collaborationState.session])

  const handleSave = useCallback(async () => {
    if (!canSave || saveInFlightRef.current) return
    saveInFlightRef.current = true
    if (collaborationEnabled && collaborationState.state?.canWrite && collaborationContext) {
      setError(null)
      setSavingVersion(true)
      try {
        const input = {
          epoch: collaborationState.state.epoch ?? '',
          idempotencyKey: crypto.randomUUID(),
        }
        if (collaborationContext.kind === 'owner') {
          await driveBrowserApi.checkpointOwner(current.id, input)
        } else {
          await driveBrowserApi.checkpointShare(collaborationContext.shareId, collaborationContext.itemId, input)
        }
        await editContext?.reload()
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : '保存版本失败。')
      } finally {
        saveInFlightRef.current = false
        setSavingVersion(false)
      }
      return
    }
    if (!canEdit || !edit?.currentVersionId || !editContext) {
      saveInFlightRef.current = false
      return
    }
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
    } finally {
      saveInFlightRef.current = false
    }
  }, [canSave, collaborationContext, collaborationEnabled, collaborationState.state?.canWrite, collaborationState.state?.epoch, current.id, edit?.currentVersionId, editContext])

  saveShortcutRef.current = () => {
    if (canSave) void handleSave()
  }

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
      label: collaborationEnabled
        ? bindingReady ? collaborationStatusLabel(collaborationState.state?.status) : '正在同步'
        : dirty ? '未保存' : canEdit ? '已同步' : '只读',
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
    if (canEdit && !collaborationEnabled) {
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
          ariaKeyShortcuts: 'Meta+S Control+S',
          compactPlacement: 'primary',
          loading: editContext?.savingText,
          disabled: !canSave,
          onClick: () => { void handleSave() },
        },
      )
    }
    if (canEdit && collaborationEnabled) {
      if ((collaborationState.state?.onlineCount ?? 0) > 0) {
        items.push({
          kind: 'status',
          id: 'code-online-editors',
          label: `${collaborationState.state?.onlineCount ?? 0} 人在线`,
        })
      }
      items.push({
        kind: 'button',
        id: 'code-checkpoint',
        label: '保存版本',
        icon: Save,
        ariaKeyShortcuts: 'Meta+S Control+S',
        compactPlacement: 'primary',
        loading: savingVersion,
        disabled: !canSave,
        onClick: () => { void handleSave() },
      })
    }
    return items
  }, [
    canEdit,
    bindingReady,
    canSave,
    collaborationEnabled,
    collaborationState.state?.onlineCount,
    collaborationState.state?.status,
    dirty,
    editContext?.reloading,
    editContext?.savingText,
    handleReload,
    handleSave,
    loginRequired,
    loginUrl,
    requestReload,
    savingVersion,
  ])

  useRegisterDriveRendererToolbarItems('code-editor', toolbarItems)
  useRegisterDriveRendererUnsavedState(
    'code-editor-unsaved',
    canEdit && (collaborationEnabled ? !bindingReady || collaborationState.state?.status !== 'synced' : dirty)
  )

  const displayedError = error ?? collaborationState.state?.error
  const downloadValue = collaborationState.session?.text.toString() ?? value

  return (
    <div
      data-drive-code-renderer='true'
      data-drive-collaboration-bound={bindingReady ? 'true' : 'false'}
      data-drive-code-language={language}
      className='flex h-full min-h-0 w-full flex-col overflow-hidden'
    >
      <div className='min-h-0 flex-1'>
        {collaborationEnabled && !collaborationState.session ? null : (
          <Editor
            height='100%'
            language={language}
            value={collaborationEnabled ? undefined : value}
            defaultValue={collaborationEnabled ? initialText : undefined}
            onMount={handleEditorMount}
            onChange={(nextValue) => {
              if (!canEdit || collaborationEnabled) return
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
        )}
      </div>
      {displayedError ? (
        <div className='flex items-center justify-between gap-3 border-t px-3 py-2 text-xs text-destructive'>
          <span>{displayedError}</span>
          {collaborationEnabled ? (
            <Button type='button' size='sm' variant='outline' onClick={() => downloadLocalVersion(current.name, downloadValue)}>
              <Download data-icon='inline-start' />
              下载本地版本
            </Button>
          ) : null}
        </div>
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
            <Button type='button' variant='outline' onClick={() => downloadLocalVersion(current.name, downloadValue)}>
              <Download data-icon='inline-start' />
              下载本地版本
            </Button>
            <AlertDialogAction onClick={() => { void handleReload() }}>放弃并重新加载</AlertDialogAction>
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
            <Button type='button' variant='outline' onClick={() => downloadLocalVersion(current.name, downloadValue)}>
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

function collaborationStatusLabel(status: ReturnType<typeof useDriveCollaboration>['state'] extends infer T ? T extends { status: infer S } ? S : undefined : undefined): string {
  if (status === 'connecting') return '正在连接'
  if (status === 'syncing') return '正在同步'
  if (status === 'synced') return '已同步'
  if (status === 'failed') return '同步失败'
  return '只读'
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
