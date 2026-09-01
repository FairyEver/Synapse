import { useRef, useState } from 'react'
import {
  buildConsoleDriveRootUrl,
  type DriveBrowserItemDto,
  type DriveBrowserSnapshotDto,
  type DriveBrowserSurface,
  type DriveUsageDto,
} from '@synapse/shared'
import { FolderUp, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DriveBrowserPage,
  DriveSingleFileReaderView,
} from '@/features/drive-browser/drive-browser-page'
import type { DriveBrowserNavigate } from '@/features/drive-browser/shared/drive-navigation'
import type { DriveAnnotationContext } from '@/features/drive-browser/use-drive-annotations'
import { shouldRenderDriveSingleFileReader } from '@/features/drive-browser/shared/drive-view-model'
import { formatDriveBrowserBytes } from '@/features/drive-browser/shared/drive-format'
import { DriveTelemetryBoundary } from '@/features/drive-browser/shared/drive-telemetry-boundary'
import { trackedDriveApi as driveApi } from '@/features/drive-browser/shared/drive-telemetry-api'
import { DriveFileTable, type DriveConsoleSystemView } from './drive-file-table'
import { DriveMoveDialog } from './drive-move-dialog'
import { DrivePublicAssetsView } from './drive-public-assets-view'
import { DriveSharesDialog, DriveShareSettingsDialog } from './drive-share-dialogs'
import { DriveTrashView } from './drive-trash-view'
import { pickDriveFolderForUpload, uploadDriveFiles, type DriveWebFolderUploadInput, type DriveWebUploadResult } from './drive-upload'
import { useDriveConsole, type DriveConsoleState } from './use-drive-console'

type NameDialogState =
  | { readonly mode: 'create'; readonly item: null; readonly value: string }
  | { readonly mode: 'rename'; readonly item: DriveBrowserItemDto; readonly value: string }

export function DriveConsolePage({
  onNavigate,
  activeView,
  onViewChange,
}: {
  readonly onNavigate?: DriveBrowserNavigate
  readonly activeView?: DriveConsoleSystemView
  readonly onViewChange?: (view: DriveConsoleSystemView) => void
} = {}) {
  return (
    <DriveTelemetryBoundary scope='console'>
      <Header fixed>
        <h1 className='text-balance text-lg font-semibold'>网盘</h1>
      </Header>
      <Main fixed fluid>
        <DriveConsoleRoot onNavigate={onNavigate} activeView={activeView} onViewChange={onViewChange} />
      </Main>
    </DriveTelemetryBoundary>
  )
}

export function DriveConsoleItemPage({
  itemId,
  surface = 'console',
  onNavigate,
  activeView,
  onViewChange,
}: {
  readonly itemId: string
  readonly surface?: DriveBrowserSurface
  readonly onNavigate?: DriveBrowserNavigate
  readonly activeView?: DriveConsoleSystemView
  readonly onViewChange?: (view: DriveConsoleSystemView) => void
}) {
  if (surface === 'standalone') {
    return <DriveBrowserPage context='owner' itemId={itemId} surface='standalone' onNavigate={onNavigate} />
  }

  return (
    <DriveTelemetryBoundary scope='console'>
      <Header fixed>
        <h1 className='text-balance text-lg font-semibold'>网盘</h1>
      </Header>
      <DriveConsoleItemMain
        itemId={itemId}
        surface={surface}
        onNavigate={onNavigate}
        activeView={activeView}
        onViewChange={onViewChange}
      />
    </DriveTelemetryBoundary>
  )
}

function DriveConsoleRoot({
  onNavigate,
  activeView,
  onViewChange,
}: {
  readonly onNavigate?: DriveBrowserNavigate
  readonly activeView?: DriveConsoleSystemView
  readonly onViewChange?: (view: DriveConsoleSystemView) => void
}) {
  const state = useDriveConsole({ context: 'root' })
  return <DriveConsoleContent state={state} onNavigate={onNavigate} activeView={activeView} onViewChange={onViewChange} />
}

function DriveConsoleItemMain({
  itemId,
  surface,
  onNavigate,
  activeView,
  onViewChange,
}: {
  readonly itemId: string
  readonly surface: DriveBrowserSurface
  readonly onNavigate?: DriveBrowserNavigate
  readonly activeView?: DriveConsoleSystemView
  readonly onViewChange?: (view: DriveConsoleSystemView) => void
}) {
  const state = useDriveConsole({ context: 'item', itemId, surface })
  const fileReader = state.browser.status === 'ready' && shouldRenderDriveSingleFileReader(state.browser.snapshot)
  const annotationContext: DriveAnnotationContext | undefined = fileReader
    ? { context: 'owner', itemId: state.browser.snapshot.current.id }
    : undefined

  return (
    <Main fixed fluid className={fileReader ? 'p-0' : undefined}>
      {fileReader ? (
        <DriveSingleFileReaderView snapshot={state.browser.snapshot} editContext={state.browser} annotationContext={annotationContext} embedded />
      ) : (
        <DriveConsoleContent state={state} onNavigate={onNavigate} activeView={activeView} onViewChange={onViewChange} />
      )}
    </Main>
  )
}

function DriveConsoleContent({
  state,
  onNavigate,
  activeView: controlledActiveView,
  onViewChange,
}: {
  readonly state: DriveConsoleState
  readonly onNavigate?: DriveBrowserNavigate
  readonly activeView?: DriveConsoleSystemView
  readonly onViewChange?: (view: DriveConsoleSystemView) => void
}) {
  const [localActiveView, setLocalActiveView] = useState<DriveConsoleSystemView>('files')
  const activeView = controlledActiveView ?? localActiveView
  const setActiveView = (view: DriveConsoleSystemView) => {
    if (controlledActiveView === undefined) setLocalActiveView(view)
    onViewChange?.(view)
  }
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [moveTarget, setMoveTarget] = useState<DriveBrowserItemDto | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DriveBrowserItemDto | null>(null)
  const [shareTarget, setShareTarget] = useState<DriveBrowserItemDto | null>(null)
  const [sharesOpen, setSharesOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const deleteTriggerRef = useRef<HTMLElement | null>(null)
  const deleteFallbackItemIdRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const nameInputId = 'drive-console-name-input'

  const setFolderInputRef = (node: HTMLInputElement | null) => {
    folderInputRef.current = node
    node?.setAttribute('webkitdirectory', '')
  }

  const refreshAfterMutation = async () => {
    await state.refresh()
  }

  const submitNameDialog = async () => {
    if (!nameDialog) return
    const name = nameDialog.value.trim()
    if (!name) return
    setSubmitting(true)
    try {
      if (nameDialog.mode === 'create') {
        await driveApi.createFolder({ parentId: currentFolderId(state), name })
      } else {
        await driveApi.renameItem(nameDialog.item.id, name)
      }
      setNameDialog(null)
      await refreshAfterMutation()
    } catch (error) {
      toast(errorMessage(error, nameDialog.mode === 'create' ? '新建文件夹失败' : '重命名失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const deleteItem = async () => {
    if (!deleteTarget) return
    setSubmitting(true)
    try {
      await driveApi.deleteItem(deleteTarget.id)
      await refreshAfterMutation()
      setDeleteTarget(null)
    } catch (error) {
      toast(errorMessage(error, '删除失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const openDeleteDialog = (item: DriveBrowserItemDto, trigger: HTMLElement) => {
    deleteTriggerRef.current = trigger
    const deleteActions = Array.from(
      trigger.closest('tbody')?.querySelectorAll<HTMLElement>('[data-drive-delete-action]') ?? []
    )
    const triggerIndex = deleteActions.indexOf(trigger)
    deleteFallbackItemIdRef.current = triggerIndex >= 0
      ? (deleteActions[triggerIndex + 1] ?? deleteActions[triggerIndex - 1])?.dataset.driveItemId ?? null
      : null
    setDeleteTarget(item)
  }

  const handleDeleteCloseAutoFocus = (event: Event) => {
    event.preventDefault()
    if (deleteTriggerRef.current?.isConnected) {
      deleteTriggerRef.current.focus()
      return
    }
    const fallbackItemId = deleteFallbackItemIdRef.current
    window.setTimeout(() => {
      Array.from(document.querySelectorAll<HTMLElement>('[data-drive-delete-action]'))
        .find((action) => action.dataset.driveItemId === fallbackItemId)
        ?.focus()
    }, 0)
  }

  const moveItem = async (parentId: string | null) => {
    if (!moveTarget) return
    setSubmitting(true)
    try {
      await driveApi.moveItem(moveTarget.id, parentId)
      setMoveTarget(null)
      await refreshAfterMutation()
    } catch (error) {
      toast(errorMessage(error, '移动失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const runUpload = async (input: { readonly files: readonly File[]; readonly folders?: readonly DriveWebFolderUploadInput[] }) => {
    const parentId = currentFolderId(state)
    if (input.files.length === 0 && (input.folders?.length ?? 0) === 0) return
    setUploading(true)
    try {
      const result = await uploadDriveFiles({ parentId, files: input.files, folders: input.folders })
      toast(uploadResultMessage(result))
      await refreshAfterMutation()
    } catch (error) {
      toast(error instanceof Error ? error.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const pickAndUploadFolder = async () => {
    try {
      const picked = await pickDriveFolderForUpload()
      if (picked.kind === 'unsupported') {
        folderInputRef.current?.click()
        return
      }
      if (picked.kind === 'cancelled') return
      await runUpload({ files: [], folders: [picked.folder] })
    } catch (error) {
      toast(error instanceof Error ? error.message : '上传失败')
    }
  }

  return (
    <Tabs
      data-drive-telemetry-event='web.drive.view.select'
      value={activeView}
      onValueChange={(value) => setActiveView(value as DriveConsoleSystemView)}
      className='mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-3'
    >
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-3'>
          <h2 className='text-balance text-base font-semibold'>我的空间</h2>
          <DriveUsage usage={state.usage} loading={state.usageLoading} />
        </div>
        <div className='flex flex-wrap items-center justify-end gap-2'>
          <input
            ref={fileInputRef}
            type='file'
            multiple
            className='hidden'
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? [])
              event.currentTarget.value = ''
              void runUpload({ files })
            }}
          />
          <Button data-drive-telemetry-event='web.drive.file-upload.choose' type='button' variant='outline' size='sm' disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            <Upload data-icon='inline-start' />
            上传文件
          </Button>
          <input
            ref={setFolderInputRef}
            type='file'
            multiple
            className='hidden'
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? [])
              event.currentTarget.value = ''
              void runUpload({ files })
            }}
          />
          <Button data-drive-telemetry-event='web.drive.folder-upload.choose' type='button' variant='outline' size='sm' disabled={uploading} onClick={() => { void pickAndUploadFolder() }}>
            <FolderUp data-icon='inline-start' />
            上传文件夹
          </Button>
          <Button data-drive-telemetry-event='web.drive.folder-create.open' type='button' variant='outline' size='sm' onClick={() => setNameDialog({ mode: 'create', item: null, value: '' })}>
            新建文件夹
          </Button>
          <Button data-drive-telemetry-event='web.drive.shares.open' type='button' variant='outline' size='sm' onClick={() => setSharesOpen(true)}>分享管理</Button>
          <Button data-drive-telemetry-event='web.drive.refresh' type='button' variant='outline' size='sm' onClick={() => { void state.refresh() }}>刷新</Button>
        </div>
      </div>
      <TabsList>
        <TabsTrigger value='files'>文件</TabsTrigger>
        <TabsTrigger value='public-assets'>公开素材</TabsTrigger>
        <TabsTrigger value='trash'>回收站</TabsTrigger>
      </TabsList>
      {state.browser.status === 'loading' ? <div className='text-sm text-muted-foreground'>加载中</div> : null}
      {state.browser.status === 'error' ? <div className='text-sm text-destructive'>{state.browser.message}</div> : null}
      <TabsContent value='public-assets' className='min-h-0'>
        {state.browser.status === 'ready' ? (
          <DrivePublicAssetsView onChanged={state.refresh} />
        ) : null}
      </TabsContent>
      <TabsContent value='trash' className='min-h-0'>
        {state.browser.status === 'ready' ? (
          <DriveTrashView onChanged={state.refresh} />
        ) : null}
      </TabsContent>
      <TabsContent value='files' className='min-h-0'>
        {state.browser.status === 'ready' ? (
          <DriveFileTable
            snapshot={state.browser.snapshot}
            activeView={activeView}
            onOpenSystemView={setActiveView}
            onDelete={openDeleteDialog}
            onMove={setMoveTarget}
            onRename={(item) => setNameDialog({ mode: 'rename', item, value: item.name })}
            onShare={setShareTarget}
            onNavigate={onNavigate}
            onDropFiles={(files) => { void runUpload({ files }) }}
            onLoadMoreChildren={state.browser.loadMoreChildren}
            loadingMoreChildren={state.browser.loadingMoreChildren}
            loadMoreChildrenError={state.browser.loadMoreChildrenError}
          />
        ) : null}
      </TabsContent>
      <Dialog open={nameDialog !== null} onOpenChange={(open) => {
        if (!open) setNameDialog(null)
      }}>
        <DialogContent data-drive-telemetry-scope='portal' aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{nameDialog?.mode === 'rename' ? '重命名' : '新建文件夹'}</DialogTitle>
          </DialogHeader>
          <div className='grid gap-2'>
            <Label htmlFor={nameInputId}>{nameDialog?.mode === 'rename' ? '名称' : '文件夹名称'}</Label>
            <Input
              id={nameInputId}
              value={nameDialog?.value ?? ''}
              onChange={(event) => {
                const value = event.target.value
                setNameDialog((current) => current ? { ...current, value } : current)
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' disabled={submitting} onClick={() => setNameDialog(null)}>取消</Button>
            <Button data-drive-telemetry-event='web.drive.item.name-submit' type='button' disabled={submitting || !nameDialog?.value.trim()} onClick={() => { void submitNameDialog() }}>
              {nameDialog?.mode === 'rename' ? '保存' : '新建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DriveMoveDialog
        item={moveTarget}
        open={moveTarget !== null}
        submitting={submitting}
        onOpenChange={(open) => {
          if (!open) setMoveTarget(null)
        }}
        onSubmit={(parentId) => { void moveItem(parentId) }}
      />
      <ConfirmDialog
        contentProps={{ 'data-drive-telemetry-scope': 'portal' }}
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={deleteTarget ? `删除${deleteTarget.name}` : '删除'}
        desc='文件会进入回收站。'
        cancelBtnText='取消'
        confirmText='删除'
        destructive
        isLoading={submitting}
        onCloseAutoFocus={handleDeleteCloseAutoFocus}
        handleConfirm={() => { void deleteItem() }}
      />
      <DriveShareSettingsDialog
        item={shareTarget}
        open={shareTarget !== null}
        onOpenChange={(open) => {
          if (!open) setShareTarget(null)
        }}
        onCreated={refreshAfterMutation}
      />
      <DriveSharesDialog
        open={sharesOpen}
        onOpenChange={setSharesOpen}
        onChanged={refreshAfterMutation}
      />
    </Tabs>
  )
}

function currentFolderId(state: DriveConsoleState): string | null {
  if (state.browser.status !== 'ready') return null
  if (state.browser.snapshot.current.type !== 'folder') return null
  if (isConsoleRootSnapshot(state.browser.snapshot)) return null
  return state.browser.snapshot.current.id
}

function isConsoleRootSnapshot(snapshot: DriveBrowserSnapshotDto): boolean {
  return snapshot.breadcrumbs.length === 1 && snapshot.current.browserUrl === buildConsoleDriveRootUrl()
}

function uploadResultMessage(result: DriveWebUploadResult) {
  if (result.completed > 0 && result.failed === 0 && result.skipped === 0) return `已上传 ${result.completed} 个文件`
  if (result.completed > 0) return `已上传 ${result.completed} 个文件，失败 ${result.failed} 个，跳过 ${result.skipped} 个`
  if (result.skipped > 0 && result.failed === 0) return result.message ?? `已跳过 ${result.skipped} 个文件`
  return result.message ?? '上传失败'
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

function DriveUsage({ usage, loading }: { readonly usage: DriveUsageDto | null; readonly loading: boolean }) {
  if (!usage) return loading ? <span className='text-xs text-muted-foreground'>用量加载中</span> : null
  return (
    <span className='text-xs tabular-nums text-muted-foreground'>
      {formatDriveBrowserBytes(usage.usedBytes)} / {formatDriveBrowserBytes(usage.quotaBytes)}
    </span>
  )
}
