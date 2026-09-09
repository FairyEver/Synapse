import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
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
import type { DriveRendererEditContext } from './drive-renderer-shell'

export type DriveDocumentSaveAttempt = {
  readonly itemId: string
  readonly initialText: string
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
