import { Fragment, useCallback, useState } from "react"
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
import {
  Menubar,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "@/components/ui/menubar"
import { getContentTypeDefinition } from "@/config/content-types"
import { useContentDownloadActions } from "@/modules/content/hooks/use-content-download-actions"
import type { SynapseContentMeta } from "@/types/content"

type ContentDetailMenubarProps = {
  canDelete: boolean
  canEdit: boolean
  canOpenInNewWindow: boolean
  isFavorite: boolean
  isRepositoryInitializing: boolean
  isSyncing?: boolean
  item: SynapseContentMeta
  onDelete: () => void
  onEdit: () => void
  onOpenInNewWindow: () => void
  onToggleFavorite: () => Promise<void>
}

function ContentDetailMenubar({
  canDelete,
  canEdit,
  canOpenInNewWindow,
  isFavorite,
  isRepositoryInitializing,
  isSyncing = false,
  item,
  onDelete,
  onEdit,
  onOpenInNewWindow,
  onToggleFavorite,
}: ContentDetailMenubarProps) {
  const {
    canCopy,
    canDownload,
    canInstall,
    handleCopy,
    handleDownload,
    hasAttachments,
    installDialog,
    installMenuItems,
    isBusy,
    loadInstallTargets,
  } = useContentDownloadActions({ item })

  const definition = getContentTypeDefinition(item.type)
  const primaryAction = definition.listPrimaryAction ?? "download"
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false)

  const onCopyClick = useCallback(() => {
    if (hasAttachments) {
      setIsCopyDialogOpen(true)
    } else {
      void handleCopy()
    }
  }, [hasAttachments, handleCopy])

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
            {canCopy ? (
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
              <MenubarMenu>
                <MenubarTrigger
                  onFocus={() => {
                    loadInstallTargets()
                  }}
                  onPointerEnter={() => {
                    loadInstallTargets()
                  }}
                >
                  安装
                </MenubarTrigger>
                <MenubarContent className="w-56">
                  <MenubarGroup>
                    {installMenuItems.map((action) => (
                      <MenubarItem
                        key={action.key}
                        disabled={action.disabled}
                        onSelect={action.onSelect}
                      >
                        {action.icon}
                        {action.label}
                      </MenubarItem>
                    ))}
                  </MenubarGroup>
                </MenubarContent>
              </MenubarMenu>
            ) : null}

            {canCopy ? (
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

        {canDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-sm px-1.5"
            disabled={isRepositoryInitializing || isSyncing}
            onClick={onDelete}
          >
            删除
          </Button>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-sm px-1.5"
          disabled={!canOpenInNewWindow}
          onClick={onOpenInNewWindow}
        >
          新窗口打开
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-sm px-1.5"
          disabled={isRepositoryInitializing || isSyncing}
          onClick={() => {
            void onToggleFavorite()
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
