import { useRef, useState } from 'react'
import {
  buildConsoleDriveRootUrl,
  type DriveAccessSettingsInput,
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
import { shouldRenderDriveSingleFileReader } from '@/features/drive-browser/shared/drive-view-model'
import { formatDriveBrowserBytes } from '@/features/drive-browser/shared/drive-format'
import { driveApi } from '@/lib/api'
import { DriveFileTable, type DriveConsoleSystemView } from './drive-file-table'
import { DriveMoveDialog } from './drive-move-dialog'
import { DrivePublicAssetsView } from './drive-public-assets-view'
import { DriveSharesDialog, DriveShareSettingsDialog } from './drive-share-dialogs'
import { DriveSiteCreateDialog, DriveSitesDialog } from './drive-sites-dialogs'
import { DriveTrashView } from './drive-trash-view'
import { uploadDriveFiles, type DriveWebUploadResult } from './drive-upload'
import { useDriveConsole, type DriveConsoleState } from './use-drive-console'

type NameDialogState =
  | { readonly mode: 'create'; readonly item: null; readonly value: string }
  | { readonly mode: 'rename'; readonly item: DriveBrowserItemDto; readonly value: string }

export function DriveConsolePage() {
  return (
    <>
      <Header fixed>
        <h1 className='text-balance text-lg font-semibold'>网盘</h1>
      </Header>
      <Main fixed fluid>
        <DriveConsoleRoot />
      </Main>
    </>
  )
}

export function DriveConsoleItemPage({
  itemId,
  surface = 'console',
}: {
  readonly itemId: string
  readonly surface?: DriveBrowserSurface
}) {
  if (surface === 'standalone') {
    return <DriveBrowserPage context='owner' itemId={itemId} surface='standalone' />
  }

  return (
    <>
      <Header fixed>
        <h1 className='text-balance text-lg font-semibold'>网盘</h1>
      </Header>
      <DriveConsoleItemMain itemId={itemId} surface={surface} />
    </>
  )
}

function DriveConsoleRoot() {
  const state = useDriveConsole({ context: 'root' })
  return <DriveConsoleContent state={state} />
}

function DriveConsoleItemMain({ itemId, surface }: { readonly itemId: string; readonly surface: DriveBrowserSurface }) {
  const state = useDriveConsole({ context: 'item', itemId, surface })
  const fileReader = state.browser.status === 'ready' && shouldRenderDriveSingleFileReader(state.browser.snapshot)

  return (
    <Main fixed fluid className={fileReader ? 'p-0' : undefined}>
      {fileReader ? (
        <DriveSingleFileReaderView snapshot={state.browser.snapshot} editContext={state.browser} embedded />
      ) : (
        <DriveConsoleContent state={state} />
      )}
    </Main>
  )
}

function DriveConsoleContent({ state }: { readonly state: DriveConsoleState }) {
  const [activeView, setActiveView] = useState<DriveConsoleSystemView>('files')
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [moveTarget, setMoveTarget] = useState<DriveBrowserItemDto | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DriveBrowserItemDto | null>(null)
  const [shareTarget, setShareTarget] = useState<DriveBrowserItemDto | null>(null)
  const [sharesOpen, setSharesOpen] = useState(false)
  const [siteFolder, setSiteFolder] = useState<DriveBrowserItemDto | null>(null)
  const [sitesOpen, setSitesOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
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
      setDeleteTarget(null)
      await refreshAfterMutation()
    } catch (error) {
      toast(errorMessage(error, '删除失败'))
    } finally {
      setSubmitting(false)
    }
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

  const createShare = async (settings: DriveAccessSettingsInput) => {
    if (!shareTarget) return
    setSubmitting(true)
    try {
      await driveApi.createShare(shareTarget.id, settings)
      setShareTarget(null)
      await refreshAfterMutation()
    } catch (error) {
      toast(errorMessage(error, '分享失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const runUpload = async (files: readonly File[]) => {
    const parentId = currentFolderId(state)
    if (files.length === 0) return
    setUploading(true)
    try {
      const result = await uploadDriveFiles({ parentId, files })
      toast(uploadResultMessage(result))
      await refreshAfterMutation()
    } catch (error) {
      toast(error instanceof Error ? error.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Tabs
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
              void runUpload(files)
            }}
          />
          <Button type='button' variant='outline' size='sm' disabled={uploading} onClick={() => fileInputRef.current?.click()}>
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
              void runUpload(files)
            }}
          />
          <Button type='button' variant='outline' size='sm' disabled={uploading} onClick={() => folderInputRef.current?.click()}>
            <FolderUp data-icon='inline-start' />
            上传文件夹
          </Button>
          <Button type='button' variant='outline' size='sm' onClick={() => setNameDialog({ mode: 'create', item: null, value: '' })}>
            新建文件夹
          </Button>
          <Button type='button' variant='outline' size='sm' onClick={() => setSharesOpen(true)}>我的分享</Button>
          <Button type='button' variant='outline' size='sm' onClick={() => setSitesOpen(true)}>站点</Button>
          <Button type='button' variant='outline' size='sm' onClick={() => { void state.refresh() }}>刷新</Button>
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
            onDelete={setDeleteTarget}
            onMove={setMoveTarget}
            onPublishSite={setSiteFolder}
            onRename={(item) => setNameDialog({ mode: 'rename', item, value: item.name })}
            onShare={setShareTarget}
            onDropFiles={(files) => { void runUpload(files) }}
          />
        ) : null}
      </TabsContent>
      <Dialog open={nameDialog !== null} onOpenChange={(open) => {
        if (!open) setNameDialog(null)
      }}>
        <DialogContent aria-describedby={undefined}>
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
            <Button type='button' disabled={submitting || !nameDialog?.value.trim()} onClick={() => { void submitNameDialog() }}>
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
        handleConfirm={() => { void deleteItem() }}
      />
      <DriveShareSettingsDialog
        itemName={shareTarget?.name ?? ''}
        open={shareTarget !== null}
        submitting={submitting}
        onOpenChange={(open) => {
          if (!open) setShareTarget(null)
        }}
        onConfirm={createShare}
      />
      <DriveSharesDialog
        open={sharesOpen}
        onOpenChange={setSharesOpen}
        onChanged={refreshAfterMutation}
      />
      <DriveSiteCreateDialog
        folder={siteFolder}
        open={siteFolder !== null}
        onOpenChange={(open) => {
          if (!open) setSiteFolder(null)
        }}
        onCreated={refreshAfterMutation}
      />
      <DriveSitesDialog open={sitesOpen} onOpenChange={setSitesOpen} />
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
