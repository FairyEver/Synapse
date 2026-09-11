import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { DriveBrowserCollaborationCapabilityDto, DriveBrowserEditDto, DriveBrowserItemDto, DriveBrowserPreviewDto, DriveCollaborationJoinContext } from '@synapse/shared'
import { Download, LogIn, RefreshCw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createBrowserUuid } from '@/lib/browser-compat'
import { getCodeEditorLanguage } from '@/lib/code-editor-language'
import { trackedDriveBrowserApi as driveBrowserApi } from '../shared/drive-telemetry-api'
import { startDriveOperation, trackDriveEvent } from '../shared/drive-telemetry'
import { useDriveCollaboration } from '../collaboration/use-drive-collaboration'
import { createMonacoCollaborationBinding } from './monaco-collaboration-binding'
import {
  DriveDocumentEditorRecoveryDialogs,
  buildDriveDocumentEditorLoginUrl,
  downloadDriveDocumentLocalVersion,
  driveDocumentEditorErrorMessage,
  isDriveDocumentSaveAcknowledged,
  reloadDriveDocumentText,
  saveDriveDocumentText,
  type DriveDocumentSaveAttempt,
} from './drive-document-editor-lifecycle'
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
  const pendingSaveRef = useRef<DriveDocumentSaveAttempt | null>(null)
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
  const loginUrl = buildDriveDocumentEditorLoginUrl()
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
    trackDriveEvent({ eventKey: 'web.drive.editor.open', component: 'drive-code-editor', action: 'open' })
    const finishDuration = startDriveOperation('web.drive.editor.duration', 'drive-code-editor')
    return () => finishDuration('success')
  }, [current.id])

  useEffect(() => {
    savedValueRef.current = initialText
    const savedVersionAcknowledged = isDriveDocumentSaveAcknowledged(pendingSaveRef.current, current.id, initialText)
    if (savedVersionAcknowledged) {
      setDirty(valueRef.current !== initialText)
      return
    }
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
    const finishTracking = startDriveOperation('web.drive.editor.save', 'drive-code-editor')
    saveInFlightRef.current = true
    if (collaborationEnabled && collaborationState.state?.canWrite && collaborationContext) {
      setError(null)
      setSavingVersion(true)
      try {
        const input = {
          epoch: collaborationState.state.epoch ?? '',
          idempotencyKey: createBrowserUuid(),
        }
        if (collaborationContext.kind === 'owner') {
          await driveBrowserApi.checkpointOwner(current.id, input)
        } else {
          await driveBrowserApi.checkpointShare(collaborationContext.shareId, collaborationContext.itemId, input)
        }
        await editContext?.reload()
        finishTracking('success')
      } catch (saveError) {
        finishTracking('failure')
        setError(saveError instanceof Error ? saveError.message : '保存版本失败。')
      } finally {
        saveInFlightRef.current = false
        setSavingVersion(false)
      }
      return
    }
    if (!canEdit || !edit?.currentVersionId || !editContext) {
      finishTracking('cancelled')
      saveInFlightRef.current = false
      return
    }
    setError(null)
    const submittedValue = valueRef.current
    const saveAttempt = { itemId: current.id, initialText: submittedValue }
    pendingSaveRef.current = saveAttempt
    try {
      const result = await saveDriveDocumentText(editContext, submittedValue, edit.currentVersionId)
      if (result === 'conflict') {
        finishTracking('failure')
        setConflictOpen(true)
        return
      }
      finishTracking('success')
      savedValueRef.current = submittedValue
      setDirty(valueRef.current !== submittedValue)
    } catch (saveError) {
      finishTracking('failure')
      setError(driveDocumentEditorErrorMessage(saveError, '保存失败。'))
    } finally {
      if (pendingSaveRef.current === saveAttempt) pendingSaveRef.current = null
      saveInFlightRef.current = false
    }
  }, [canSave, collaborationContext, collaborationEnabled, collaborationState.state?.canWrite, collaborationState.state?.epoch, current.id, edit?.currentVersionId, editContext])

  saveShortcutRef.current = () => {
    if (canSave) void handleSave()
  }

  const handleReload = useCallback(async () => {
    if (!editContext) return
    const finishTracking = startDriveOperation('web.drive.editor.reload', 'drive-code-editor')
    setError(null)
    try {
      const nextText = await reloadDriveDocumentText(editContext)
      savedValueRef.current = nextText
      valueRef.current = nextText
      setValue(nextText)
      setDirty(false)
      setConflictOpen(false)
      setReloadConfirmOpen(false)
      finishTracking('success')
    } catch (reloadError) {
      finishTracking('failure')
      setError(driveDocumentEditorErrorMessage(reloadError, '重新加载失败。'))
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
          variant: 'ghost',
          disabled: editContext?.reloading || editContext?.savingText,
          onClick: requestReload,
        },
        {
          kind: 'button',
          id: 'code-save',
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
        variant: 'default',
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
            <Button data-drive-telemetry-event='web.drive.editor.download-local' type='button' size='sm' variant='outline' onClick={() => downloadDriveDocumentLocalVersion(current.name, downloadValue)}>
              <Download data-icon='inline-start' />
              下载本地版本
            </Button>
          ) : null}
        </div>
      ) : null}
      {preview.truncated ? (
        <div className='border-t px-3 py-2 text-xs text-muted-foreground'>内容已截断</div>
      ) : null}
      <DriveDocumentEditorRecoveryDialogs
        conflictOpen={conflictOpen}
        fileName={current.name}
        localValue={downloadValue}
        onConflictOpenChange={setConflictOpen}
        onReload={() => { void handleReload() }}
        onReloadConfirmOpenChange={setReloadConfirmOpen}
        reloadConfirmOpen={reloadConfirmOpen}
      />
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
