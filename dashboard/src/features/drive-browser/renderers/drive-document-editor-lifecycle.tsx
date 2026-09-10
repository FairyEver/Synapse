import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Download } from 'lucide-react'
import { ApiError } from '@/lib/api'
import { buildDashboardSignInUrl } from '@/lib/dashboard-redirect'
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
import { startDriveOperation } from '../shared/drive-telemetry'
import type { DriveRendererEditContext } from './drive-renderer-shell'

export type DriveDocumentSaveAttempt = {
  readonly itemId: string
  readonly initialText: string
}

type DriveDocumentEditorReplaceReason = 'external' | 'reload' | 'save'

type DriveDocumentPreparedSave = {
  readonly text: string
  readonly savedValue?: string
  readonly acknowledgedText?: string
}

type DriveDocumentEditorSaveOptions = {
  readonly blocked?: boolean
  readonly prepare?: (submittedValue: string) => DriveDocumentPreparedSave
  readonly onSaved?: () => void | Promise<void>
}

export function useDriveDocumentEditorLifecycle({
  itemId,
  initialText,
  currentVersionId,
  editContext,
  canEdit,
  telemetryComponent,
  onReplaceValue,
  replaceInitialValue = false,
}: {
  readonly itemId: string
  readonly initialText: string
  readonly currentVersionId?: string | null
  readonly editContext?: DriveRendererEditContext
  readonly canEdit: boolean
  readonly telemetryComponent: string
  readonly onReplaceValue?: (value: string, reason: DriveDocumentEditorReplaceReason) => string | void
  readonly replaceInitialValue?: boolean
}) {
  const savedValueRef = useRef(initialText)
  const valueRef = useRef(initialText)
  const pendingSaveRef = useRef<DriveDocumentSaveAttempt | null>(null)
  const operationInFlightRef = useRef<'save' | 'reload' | null>(null)
  const externalSourceRef = useRef({ itemId, currentVersionId, initialText })
  const onReplaceValueRef = useRef(onReplaceValue)
  onReplaceValueRef.current = onReplaceValue
  const [value, setValue] = useState(initialText)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false)
  const canSave = canEdit
    && dirty
    && !editContext?.savingText
    && !editContext?.reloading
  const saveAcknowledged = isDriveDocumentSaveAcknowledged(pendingSaveRef.current, itemId, initialText)

  const applyReplacement = useCallback((nextValue: string, reason: DriveDocumentEditorReplaceReason) => {
    valueRef.current = nextValue
    savedValueRef.current = nextValue
    const appliedValue = onReplaceValueRef.current?.(nextValue, reason) ?? nextValue
    valueRef.current = appliedValue
    savedValueRef.current = appliedValue
    setValue(appliedValue)
    setDirty(false)
    return appliedValue
  }, [])

  useEffect(() => {
    const previousSource = externalSourceRef.current
    const sourceChanged = previousSource.itemId !== itemId
      || previousSource.currentVersionId !== currentVersionId
      || previousSource.initialText !== initialText
    externalSourceRef.current = { itemId, currentVersionId, initialText }
    savedValueRef.current = initialText
    if (saveAcknowledged) {
      setDirty(valueRef.current !== initialText)
      return
    }
    if (!sourceChanged && !replaceInitialValue) return
    applyReplacement(initialText, 'external')
    setError(null)
    setConflictOpen(false)
    setReloadConfirmOpen(false)
  }, [applyReplacement, currentVersionId, initialText, itemId, replaceInitialValue, saveAcknowledged])

  const updateValue = useCallback((nextValue: string) => {
    valueRef.current = nextValue
    setValue(nextValue)
    setDirty(nextValue !== savedValueRef.current)
  }, [])

  const acceptValue = useCallback((nextValue: string) => {
    valueRef.current = nextValue
    savedValueRef.current = nextValue
    setValue(nextValue)
    setDirty(false)
  }, [])

  const replaceValueWithoutDirtyChange = useCallback((nextValue: string) => {
    valueRef.current = nextValue
    setValue(nextValue)
  }, [])

  const save = useCallback(async ({ blocked, prepare, onSaved }: DriveDocumentEditorSaveOptions = {}) => {
    if (!canSave || blocked || operationInFlightRef.current || !currentVersionId || !editContext) return
    const finishTracking = startDriveOperation('web.drive.editor.save', telemetryComponent)
    operationInFlightRef.current = 'save'
    setError(null)
    const submittedValue = valueRef.current
    const prepared = prepare?.(submittedValue) ?? { text: submittedValue }
    const savedValue = prepared.savedValue ?? prepared.text
    const saveAttempt = {
      itemId,
      initialText: prepared.acknowledgedText ?? savedValue,
    }
    pendingSaveRef.current = saveAttempt
    try {
      const result = await saveDriveDocumentText(editContext, prepared.text, currentVersionId)
      if (result === 'conflict') {
        finishTracking('failure')
        setConflictOpen(true)
        return
      }
      if (savedValue !== submittedValue && valueRef.current === submittedValue) {
        valueRef.current = onReplaceValueRef.current?.(savedValue, 'save') ?? savedValue
        setValue(valueRef.current)
      }
      savedValueRef.current = savedValue
      setDirty(valueRef.current !== savedValue)
      await onSaved?.()
      finishTracking('success')
    } catch (saveError) {
      finishTracking('failure')
      setError(driveDocumentEditorErrorMessage(saveError, '保存失败。'))
    } finally {
      if (pendingSaveRef.current === saveAttempt) pendingSaveRef.current = null
      operationInFlightRef.current = null
    }
  }, [canSave, currentVersionId, editContext, itemId, telemetryComponent])

  const reload = useCallback(async () => {
    if (!editContext || editContext.savingText || editContext.reloading || operationInFlightRef.current) return
    const finishTracking = startDriveOperation('web.drive.editor.reload', telemetryComponent)
    operationInFlightRef.current = 'reload'
    setError(null)
    try {
      const nextText = await reloadDriveDocumentText(editContext)
      applyReplacement(nextText, 'reload')
      setConflictOpen(false)
      setReloadConfirmOpen(false)
      finishTracking('success')
    } catch (reloadError) {
      finishTracking('failure')
      setError(driveDocumentEditorErrorMessage(reloadError, '重新加载失败。'))
    } finally {
      operationInFlightRef.current = null
    }
  }, [applyReplacement, editContext, telemetryComponent])

  const requestReload = useCallback(() => {
    if (dirty) {
      setReloadConfirmOpen(true)
      return
    }
    void reload()
  }, [dirty, reload])

  return {
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
    canSave,
    updateValue,
    acceptValue,
    replaceValueWithoutDirtyChange,
    save,
    reload,
    requestReload,
  }
}

export async function saveDriveDocumentText(
  editContext: DriveRendererEditContext,
  text: string,
  baseVersionId: string,
): Promise<'saved' | 'conflict'> {
  try {
    await editContext.saveText({ text, baseVersionId })
    return 'saved'
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return 'conflict'
    throw error
  }
}

export async function reloadDriveDocumentText(editContext: DriveRendererEditContext): Promise<string> {
  const snapshot = await editContext.reload()
  return snapshot.preview?.text ?? ''
}

export function isDriveDocumentSaveAcknowledged(
  attempt: DriveDocumentSaveAttempt | null,
  itemId: string,
  initialText: string,
): boolean {
  return attempt?.itemId === itemId && attempt.initialText === initialText
}

export function isDriveDocumentSaveShortcut(event: ReactKeyboardEvent<HTMLElement>): boolean {
  return event.key.toLowerCase() === 's'
    && (event.metaKey || event.ctrlKey)
    && !event.shiftKey
    && !event.altKey
}

export function driveDocumentEditorErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function buildDriveDocumentEditorLoginUrl(): string {
  if (typeof window === 'undefined') return buildDashboardSignInUrl(undefined)
  return buildDashboardSignInUrl(window.location)
}

export function downloadDriveDocumentLocalVersion(name: string, value: string): void {
  const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export function DriveDocumentEditorRecoveryDialogs({
  conflictOpen,
  fileName,
  localValue,
  onConflictOpenChange,
  onReload,
  onReloadConfirmOpenChange,
  reloadConfirmOpen,
}: {
  readonly conflictOpen: boolean
  readonly fileName: string
  readonly localValue: string
  readonly onConflictOpenChange: (open: boolean) => void
  readonly onReload: () => void
  readonly onReloadConfirmOpenChange: (open: boolean) => void
  readonly reloadConfirmOpen: boolean
}) {
  return (
    <>
      <AlertDialog open={reloadConfirmOpen} onOpenChange={onReloadConfirmOpenChange}>
        <AlertDialogContent data-drive-telemetry-scope='portal'>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃本地修改？</AlertDialogTitle>
            <AlertDialogDescription>重新加载会用服务器内容覆盖当前未保存编辑。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button data-drive-telemetry-event='web.drive.editor.download-local' type='button' variant='outline' onClick={() => downloadDriveDocumentLocalVersion(fileName, localValue)}>
              <Download data-icon='inline-start' />
              下载本地版本
            </Button>
            <AlertDialogAction data-drive-telemetry-event='web.drive.editor.conflict-reload' onClick={onReload}>放弃并重新加载</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={conflictOpen} onOpenChange={onConflictOpenChange}>
        <AlertDialogContent data-drive-telemetry-scope='portal'>
          <AlertDialogHeader>
            <AlertDialogTitle>文件已有新内容</AlertDialogTitle>
            <AlertDialogDescription>你的编辑仍保留，可以下载到本地或重新加载。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button data-drive-telemetry-event='web.drive.editor.download-local' type='button' variant='outline' onClick={() => downloadDriveDocumentLocalVersion(fileName, localValue)}>
              <Download data-icon='inline-start' />
              下载本地版本
            </Button>
            <AlertDialogAction data-drive-telemetry-event='web.drive.editor.reload' onClick={onReload}>重新加载</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
