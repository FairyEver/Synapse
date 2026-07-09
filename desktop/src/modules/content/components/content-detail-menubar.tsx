import { useCallback, useEffect, useState, type MouseEvent } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Menubar } from "@/components/ui/menubar"
import { useAppNotifications } from "@/app-shell/notifications"
import { getContentTypeDefinition } from "@/config/content-types"
import {
  EditorInstallStatusPanel,
  type EditorInstallStatusPanelProps,
} from "@/modules/content/components/editor-install-status-panel"
import { useContentDownloadActions } from "@/modules/content/hooks/use-content-download-actions"
import type { SynapseContentMeta } from "@/types/content"
import type { SynapseEditorId, SynapseEditorInstallScope } from "@/types/editor"

type ContentInstallTargetRequest = {
  editorId: SynapseEditorId
  projectId?: string
  projectPath?: string
  scope: SynapseEditorInstallScope
}

type ContentDetailMenubarProps = {
  canDelete: boolean
  canEdit: boolean
  canOpenInNewWindow: boolean
  installStatus?: EditorInstallStatusPanelProps | null
  installTargetRequest?: ContentInstallTargetRequest | null
  isFavorite: boolean
  isRepositoryInitializing: boolean
  item: SynapseContentMeta
  onDelete: (event: MouseEvent<HTMLElement>) => void
  onEdit: () => void
  onInstalled?: () => Promise<void> | void
  onInstallTargetRequestConsumed?: () => void
  onOpenInNewWindow: () => void
  onToggleFavorite: () => Promise<void>
}

function ContentDetailMenubar({
  canDelete,
  canEdit,
  canOpenInNewWindow,
  installStatus,
  installTargetRequest,
  isFavorite,
  isRepositoryInitializing,
  item,
  onDelete,
  onEdit,
  onInstalled,
  onInstallTargetRequestConsumed,
  onOpenInNewWindow,
  onToggleFavorite,
}: ContentDetailMenubarProps) {
  const {
    canCopy: canCopyContent,
    canDownload,
    canInstall,
    handleCopy,
    handleDownload,
    hasAttachments,
    installAction,
    installDialog,
    isBusy,
    openInstallDialogForEditorId,
  } = useContentDownloadActions({ item, onInstalled })
  const { error: showError, warning } = useAppNotifications()

  const definition = getContentTypeDefinition(item.type)
  const primaryAction = definition.listPrimaryAction ?? "download"
  const canCopyInDetailToolbar = item.type !== "skill" && canCopyContent
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false)

  const onCopyClick = useCallback(() => {
    if (hasAttachments) {
      setIsCopyDialogOpen(true)
    } else {
      void handleCopy()
    }
  }, [hasAttachments, handleCopy])

  useEffect(() => {
    if (!installTargetRequest) {
      return
    }

    void openInstallDialogForEditorId({
      editorId: installTargetRequest.editorId,
      initialSelection: {
        projectId: installTargetRequest.projectId,
        projectPath: installTargetRequest.projectPath,
        scope: installTargetRequest.scope,
      },
    })
      .then((opened) => {
        if (!opened) {
          warning("未找到可用的安装目标。")
        }
      })
      .finally(() => {
        onInstallTargetRequestConsumed?.()
      })
  }, [installTargetRequest, onInstallTargetRequestConsumed, openInstallDialogForEditorId, warning])

  return (
    <>
      <Menubar className="w-fit">
        {canEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-sm px-1.5"
            onClick={onEdit}
          >
            编辑
          </Button>
        ) : null}

        {primaryAction === "copy" ? (
          <>
            {canCopyInDetailToolbar ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-sm px-1.5"
                disabled={isBusy}
                onClick={() => {
                  void handleCopy()
                }}
              >
                复制
              </Button>
            ) : null}
            {canDownload ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-sm px-1.5"
                disabled={isBusy}
                onClick={() => {
                  void handleDownload()
                }}
              >
                下载
              </Button>
            ) : null}
          </>
        ) : (
          <>
            {canDownload ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-sm px-1.5"
                disabled={isBusy}
                onClick={() => {
                  void handleDownload()
                }}
              >
                下载
              </Button>
            ) : null}

            {canInstall ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-sm px-1.5"
                disabled={isBusy || installAction?.disabled}
                onClick={() => {
                  installAction?.onSelect?.()
                }}
              >
                安装
              </Button>
            ) : null}

            {canCopyInDetailToolbar ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-sm px-1.5"
                disabled={isBusy}
                onClick={onCopyClick}
              >
                复制
              </Button>
            ) : null}
          </>
        )}

        {installStatus ? (
          <EditorInstallStatusPanel {...installStatus} />
        ) : null}

        {canDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-sm px-1.5"
            disabled={isRepositoryInitializing}
            onClick={onDelete}
          >
            删除
          </Button>
        ) : null}

        {canOpenInNewWindow ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-sm px-1.5"
            onClick={onOpenInNewWindow}
          >
            新窗口打开
          </Button>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-sm px-1.5"
          disabled={isRepositoryInitializing}
          onClick={() => {
            void onToggleFavorite().catch(() => {
              showError("收藏操作失败")
            })
          }}
        >
          {isFavorite ? "取消收藏" : "收藏"}
        </Button>
      </Menubar>

      {installDialog}

      <AlertDialog open={isCopyDialogOpen} onOpenChange={setIsCopyDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>复制提示</AlertDialogTitle>
            <AlertDialogDescription>
              该技能包含多个文件，仅复制主文件内容。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>关闭</AlertDialogCancel>
            <AlertDialogAction
              disabled={isBusy}
              onClick={() => {
                void handleCopy()
              }}
            >
              复制
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export { ContentDetailMenubar }
export type { ContentInstallTargetRequest }
