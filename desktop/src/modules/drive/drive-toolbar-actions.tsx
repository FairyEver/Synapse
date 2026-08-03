import type { ReactNode } from "react"
import { Ellipsis, RefreshCw } from "lucide-react"
import type { DriveSyncSnapshotDto } from "@synapse/shared"

import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { DriveSyncStatusButton } from "./drive-sync-dialog"
import type { DriveRendererAction } from "./markdown/drive-renderer-actions"

function DriveToolbarActions({
  children,
  createDisabled,
  onCreateFolder,
  onOpenLocalSync,
  onOpenPublicLinks,
  onOpenSyncStatus,
  onRefresh,
  onUploadFiles,
  onUploadFolder,
  publicLinksDisabled,
  refreshDisabled,
  rendererActions,
  syncSnapshot,
  uploadDisabled,
}: {
  readonly children: ReactNode
  readonly createDisabled: boolean
  readonly publicLinksDisabled: boolean
  readonly refreshDisabled: boolean
  readonly rendererActions: readonly DriveRendererAction[]
  readonly syncSnapshot: DriveSyncSnapshotDto | null
  readonly uploadDisabled: boolean
  readonly onCreateFolder: () => void
  readonly onOpenLocalSync: () => void
  readonly onOpenPublicLinks: () => void
  readonly onOpenSyncStatus: () => void
  readonly onRefresh: () => void
  readonly onUploadFiles: () => void
  readonly onUploadFolder: () => void
}) {
  const createMenuDisabled = createDisabled && uploadDisabled
  const moreMenuDisabled = uploadDisabled && publicLinksDisabled

  return (
    <div className="flex items-center justify-end gap-0" data-testid="drive-toolbar-actions">
      {children}
      {rendererActions.map((action) => (
        <SystemAppTopBarActionButton key={action.id} type="button" disabled={action.disabled} onClick={action.onClick}>
          {action.badge ? `${action.label} ${action.badge}` : action.label}
        </SystemAppTopBarActionButton>
      ))}
      <DriveSyncStatusButton snapshot={syncSnapshot} onOpen={onOpenSyncStatus} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SystemAppTopBarActionButton type="button" disabled={createMenuDisabled}>
            新建
          </SystemAppTopBarActionButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={createDisabled} onSelect={onCreateFolder}>新建文件夹</DropdownMenuItem>
          <DropdownMenuItem disabled={uploadDisabled} onSelect={onUploadFiles}>上传文件</DropdownMenuItem>
          <DropdownMenuItem disabled={uploadDisabled} onSelect={onUploadFolder}>上传文件夹</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DriveRefreshToolbarAction disabled={refreshDisabled} onRefresh={onRefresh} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SystemAppTopBarActionButton
            iconOnly
            type="button"
            disabled={moreMenuDisabled}
            aria-label="更多"
            tooltip="更多"
          >
            <Ellipsis className="size-4" />
          </SystemAppTopBarActionButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={uploadDisabled} onSelect={onOpenLocalSync}>本地同步</DropdownMenuItem>
          <DropdownMenuItem disabled={publicLinksDisabled} onSelect={onOpenPublicLinks}>分享管理</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function DrivePublicAssetToolbarActions({
  uploadDisabled,
  refreshDisabled,
  onUpload,
  onRefresh,
}: {
  readonly uploadDisabled: boolean
  readonly refreshDisabled: boolean
  readonly onUpload: () => void
  readonly onRefresh: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-0">
      <SystemAppTopBarActionButton type="button" disabled={uploadDisabled} onClick={onUpload}>
        上传公开素材
      </SystemAppTopBarActionButton>
      <DriveRefreshToolbarAction disabled={refreshDisabled} onRefresh={onRefresh} />
    </div>
  )
}

function DriveTrashToolbarActions({
  refreshDisabled,
  onRefresh,
}: {
  readonly refreshDisabled: boolean
  readonly onRefresh: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-0">
      <DriveRefreshToolbarAction disabled={refreshDisabled} onRefresh={onRefresh} />
    </div>
  )
}

function DriveRefreshToolbarAction({
  disabled,
  onRefresh,
}: {
  readonly disabled: boolean
  readonly onRefresh: () => void
}) {
  return (
    <SystemAppTopBarActionButton
      iconOnly
      type="button"
      disabled={disabled}
      aria-label="刷新"
      tooltip="刷新"
      onClick={onRefresh}
    >
      <RefreshCw className="size-4" />
    </SystemAppTopBarActionButton>
  )
}

export {
  DrivePublicAssetToolbarActions,
  DriveToolbarActions,
  DriveTrashToolbarActions,
}
