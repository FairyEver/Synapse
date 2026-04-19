import { useEffect, useMemo, useState } from "react"
import { Pencil, Trash2 } from "lucide-react"
import {
  deleteContent,
  openContentDetailWindow,
  updateContent,
} from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
import { useCurrentRepoProfile, useRepoProfileMap } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { useRepositoryManager } from "@/app-shell/repository"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { getCategoryLabel } from "@/lib/content-categories"
import { resolveDisplayName } from "@/lib/display-name"
import { ContentActionSplitButton } from "@/modules/content/components/content-action-split-button"
import { ContentDetailPanel } from "@/modules/content/components/content-detail-panel"
import { ContentItemIcon } from "@/modules/content/components/content-item-icon"
import { ContentItemMeta } from "@/modules/content/components/content-item-meta"
import { useContentDetailState } from "@/modules/content/hooks/use-content-detail-state"
import { SkillCreateDialog } from "@/modules/skills/components/skill-create-dialog"
import { SkillVersionView } from "@/modules/skills/components/skill-version-view"
import type { CreateSkillPayload } from "@/modules/skills/types"
import { serializeCreateSkillFiles } from "@/modules/skills/utils"
import type {
  SynapseDeleteContentPayload,
  SynapseSkillDetail,
  SynapseSkillMeta,
} from "@/types/content"

type SkillDetailDialogProps = {
  item: SynapseSkillMeta | null
  onContentChanged?: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  refreshSignal?: number
}

type ConflictState =
  | {
      latestHistoryDirname: string
      latestModifiedByDisplayName: string
      latestModifiedAt: string
      mode: "delete"
      payload: SynapseDeleteContentPayload
    }
  | {
      latestHistoryDirname: string
      latestModifiedByDisplayName: string
      latestModifiedAt: string
      mode: "save"
      payload: CreateSkillPayload
    }

function formatDateTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

function buildSkillInitialValue(detail: SynapseSkillDetail): CreateSkillPayload {
  return {
    title: detail.title,
    name: detail.name ?? "",
    description: detail.description,
    category: detail.category,
    icon: detail.icon,
    iconBg: detail.iconBg,
    content: detail.content,
    files: detail.attachments.map((attachment) => ({
      originalName: attachment.originalName,
      sha256: attachment.sha256,
      size: attachment.size,
    })),
  }
}

function SkillDetailDialog({
  item,
  onContentChanged,
  onOpenChange,
  open,
  refreshSignal = 0,
}: SkillDetailDialogProps) {
  const logger = useMemo(() => createRendererLogger("skills.detail"), [])
  const { currentRepoProfileState } = useCurrentRepoProfile()
  const repoProfileMap = useRepoProfileMap()
  const { activeRepository } = useAppConfig()
  const { error, promise } = useAppNotifications()
  const { operations, waitForBackgroundPush } = useRepositoryManager()
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [conflictState, setConflictState] = useState<ConflictState | null>(null)
  const {
    detail,
    displayedVersion,
    historyEntries,
    isLoading,
    previewError,
    selectedHistoryDirname,
    setSelectedHistoryDirname,
    setViewMode,
    viewMode,
  } = useContentDetailState<"skill">({
    invalidTypeMessage: "读取到的内容不是 Skill。",
    item,
    loadDetailErrorMessage: "读取 Skill 详情失败。",
    loadHistoryErrorMessage: "读取 Skill 历史失败。",
    logCategory: "skills.detail",
    open,
    refreshSignal,
  })
  const activeRepositoryOperation = activeRepository ? operations[activeRepository.uuid] ?? null : null
  const isRepositoryInitializing =
    activeRepositoryOperation?.isRunning
    && activeRepositoryOperation.operation === "initialize"
  const submitDisabledReason =
    currentRepoProfileState?.status === "needs-onboarding"
      ? "请先完成当前目录的身份设置"
      : isRepositoryInitializing
        ? "当前目录正在初始化，请稍后。"
      : null

  useEffect(() => {
    if (!open) {
      setViewMode("rendered")
      setSelectedHistoryDirname(null)
      setIsEditOpen(false)
      setIsDeleteConfirmOpen(false)
      setConflictState(null)
    }
  }, [open])

  if (!item) {
    return null
  }

  const resolvedItem = detail ?? item
  const deleteTarget = detail ?? item
  const categoryLabel = getCategoryLabel(item.type, resolvedItem.category)
  const authorLabel = resolveDisplayName(
    resolvedItem.createdBy,
    repoProfileMap,
    resolvedItem.createdByDisplayName,
  )

  const handleSave = (payload: CreateSkillPayload, force = false) => {
    if (!detail) {
      return
    }

    setIsEditOpen(false)
    onOpenChange(false)

    void promise(
      async () => {
        const result = await updateContent(item.type, {
          ...payload,
          id: detail.id,
          baseHistoryDirname: detail.latestHistoryDirname,
          force,
          files: await serializeCreateSkillFiles(payload.files),
        })

        if (result.status !== "saved") {
          return result
        }

        onContentChanged?.()

        if (result.pendingPushCount > 0 && activeRepository) {
          await waitForBackgroundPush(activeRepository.uuid)
        }

        return result
      },
      {
        loading: "正在保存...",
        success: (result) => {
          if (result.status === "conflict") {
            setConflictState({
              latestHistoryDirname: result.latestHistoryDirname,
              latestModifiedAt: result.latestModifiedAt,
              latestModifiedByDisplayName: result.latestModifiedByDisplayName,
              mode: "save",
              payload,
            })
            return null
          }

          return result.pendingPushCount > 0 ? "已保存并同步。" : "保存成功。"
        },
        error: (error) => error instanceof Error ? error.message : "保存失败。",
      },
    ).catch((error) => {
      logger.error("Skill save failed from detail dialog.", {
        contentId: detail.id,
        error,
      })
    })
  }

  const handleDelete = async (force = false) => {
    await promise(
      () => deleteContent({
        id: deleteTarget.id,
        type: deleteTarget.type,
        baseHistoryDirname: deleteTarget.latestHistoryDirname,
        force,
      }),
      {
        loading: "正在删除 Skill...",
        success: (result) => {
          if (result.status === "conflict") {
            setConflictState({
              latestHistoryDirname: result.latestHistoryDirname,
              latestModifiedAt: result.latestModifiedAt,
              latestModifiedByDisplayName: result.latestModifiedByDisplayName,
              mode: "delete",
              payload: {
                id: deleteTarget.id,
                type: deleteTarget.type,
                baseHistoryDirname: deleteTarget.latestHistoryDirname,
              },
            })
            return null
          }

          setIsDeleteConfirmOpen(false)
          onContentChanged?.()
          onOpenChange(false)
          return result.message
        },
        error: (error) => error instanceof Error ? error.message : "删除 Skill 失败。",
      },
    )
  }

  const handleConflictContinue = async () => {
    if (!conflictState) {
      return
    }

    const nextConflictState = conflictState
    setConflictState(null)

    if (nextConflictState.mode === "delete") {
      await handleDelete(true)
      return
    }

    try {
      await handleSave(
        {
          ...nextConflictState.payload,
        },
        true,
      )
    } catch {
      return
    }
  }

  const handleOpenInNewWindow = async () => {
    try {
      await openContentDetailWindow({
        contentType: item.type,
        id: item.id,
        title: resolvedItem.title,
        viewMode,
        historyDirname: selectedHistoryDirname ?? displayedVersion?.historyDirname,
      })
    } catch (openWindowError) {
      logger.error("Failed to open skill detail window.", {
        contentId: item.id,
        error: openWindowError,
      })
      error(openWindowError instanceof Error ? openWindowError.message : "打开新窗口失败。")
    }
  }

  return (
    <>
      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这条 Skill？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后，这条 Skill 会从列表里隐藏，但历史记录仍会保留在仓库里。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRepositoryInitializing}
              onClick={() => void handleDelete()}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={conflictState !== null} onOpenChange={(openState) => {
        if (!openState) {
          setConflictState(null)
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>有人在你之后改过这条 Skill</AlertDialogTitle>
            <AlertDialogDescription>
              {conflictState
                ? `${conflictState.latestModifiedByDisplayName || "未命名用户"} 在 ${formatDateTime(conflictState.latestModifiedAt)} 改过这条 Skill。你的修改会成为最新版本。`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                if (conflictState) {
                  setSelectedHistoryDirname(conflictState.latestHistoryDirname)
                }
              }}
            >
              查看对方修改了什么
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isRepositoryInitializing}
              onClick={() => void handleConflictContinue()}
            >
              继续保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle className="sr-only">{resolvedItem.title}</DialogTitle>
            <DialogDescription className="sr-only">{resolvedItem.description}</DialogDescription>

            <div className="flex min-w-0 items-start gap-3 pr-8">
              <ContentItemIcon
                icon={resolvedItem.icon}
                title={resolvedItem.title}
                tone={resolvedItem.iconBg}
              />

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <ContentItemMeta
                  author={authorLabel}
                  category={categoryLabel}
                  description={resolvedItem.description}
                  title={resolvedItem.title}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!detail || isRepositoryInitializing}
                    onClick={() => {
                      setIsEditOpen(true)
                    }}
                  >
                    <Pencil />
                    编辑
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isRepositoryInitializing}
                    onClick={() => setIsDeleteConfirmOpen(true)}
                  >
                    <Trash2 />
                    删除
                  </Button>
                  <ContentActionSplitButton item={resolvedItem} />
                </div>
              </div>
            </div>
          </DialogHeader>

          <Separator className="mt-5" />

          <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
            <ContentDetailPanel
              detail={detail}
              displayedVersion={displayedVersion}
              emptyDescription="它可能已经被删除。"
              emptyTitle="找不到这条 Skill"
              errorTitle="无法显示 Skill"
              history={historyEntries}
              isLoading={isLoading}
              loadingTitle="正在读取 Skill"
              onSelectedHistoryDirnameChange={setSelectedHistoryDirname}
              onViewModeChange={setViewMode}
              previewError={previewError}
              renderVersion={({ mode, version }) => (
                <SkillVersionView mode={mode} version={version} />
              )}
              selectedHistoryDirname={selectedHistoryDirname}
              toolbarAction={(
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!displayedVersion}
                  onClick={() => {
                    void handleOpenInNewWindow()
                  }}
                >
                  新窗口
                </Button>
              )}
              viewMode={viewMode}
            />
          </div>
        </DialogContent>
      </Dialog>

      {detail ? (
        <SkillCreateDialog
          initialValue={buildSkillInitialValue(detail)}
          mode="edit"
          open={isEditOpen}
          onOpenChange={setIsEditOpen}
          onSubmit={(payload) => handleSave(payload)}
          submitDisabled={submitDisabledReason !== null}
          submitDisabledReason={submitDisabledReason}
        />
      ) : null}
    </>
  )
}

export { SkillDetailDialog }
