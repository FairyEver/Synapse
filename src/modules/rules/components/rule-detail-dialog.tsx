import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  LoaderCircle,
  PackageOpen,
  Pencil,
  Trash2,
} from "lucide-react"
import {
  deleteContent,
  readRuleDetail,
  readRuleHistory,
  readRuleHistoryVersion,
  updateRule,
} from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { InlineNotice } from "@/components/inline-notice"
import { MarkdownViewer } from "@/components/markdown-viewer"
import { Separator } from "@/components/ui/separator"
import { getContentIconOption } from "@/lib/content-appearance"
import { getCategoryLabel } from "@/lib/content-categories"
import { ContentActionSplitButton } from "@/modules/content/components/content-action-split-button"
import { ContentHistorySelect } from "@/modules/content/components/content-history-select"
import { ContentIconBadge } from "@/modules/content/components/content-icon-badge"
import { RuleCreateDialog } from "@/modules/rules/components/rule-create-dialog"
import type { CreateRulePayload } from "@/modules/rules/types"
import type {
  SynapseContentHistoryEntry,
  SynapseDeleteContentPayload,
  SynapseRuleDetail,
  SynapseRuleMeta,
} from "@/types/content"

type RuleHistoryVersion = SynapseRuleDetail & {
  historyDirname: string
  isCurrent: boolean
}

type RuleDetailDialogProps = {
  item: SynapseRuleMeta | null
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
      payload: CreateRulePayload
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

function buildRuleInitialValue(detail: SynapseRuleDetail): CreateRulePayload {
  return {
    title: detail.title,
    description: detail.description,
    category: detail.category,
    icon: detail.icon,
    iconBg: detail.iconBg,
    content: detail.content,
  }
}

function RuleVersionView({
  version,
}: {
  version: RuleHistoryVersion
}) {
  return (
    <div className="flex flex-col gap-4">
      {version.deleted ? (
        <InlineNotice message="该规则已被删除。" tone="destructive" />
      ) : null}

      <MarkdownViewer content={version.content} />
    </div>
  )
}

function RuleDetailDialog({
  item,
  onContentChanged,
  onOpenChange,
  open,
  refreshSignal = 0,
}: RuleDetailDialogProps) {
  const logger = useMemo(() => createRendererLogger("rules.detail"), [])
  const { activeRepository } = useAppConfig()
  const { promise } = useAppNotifications()
  const { waitForBackgroundPush } = useRepositoryManager()
  const [detail, setDetail] = useState<SynapseRuleDetail | null>(null)
  const [displayedVersion, setDisplayedVersion] = useState<RuleHistoryVersion | null>(null)
  const [history, setHistory] = useState<SynapseContentHistoryEntry[]>([])
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedHistoryDirname, setSelectedHistoryDirname] = useState<string | null>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [conflictState, setConflictState] = useState<ConflictState | null>(null)

  useEffect(() => {
    if (!open || item === null) {
      setDetail(null)
      setDisplayedVersion(null)
      setHistory([])
      setPreviewError(null)
      setIsLoading(false)
      setSelectedHistoryDirname(null)
      return
    }

    let cancelled = false

    setDetail(null)
    setDisplayedVersion(null)
    setHistory([])
    setPreviewError(null)
    setIsLoading(true)
    setSelectedHistoryDirname(null)

    void (async () => {
      try {
        const [nextDetail, nextHistory] = await Promise.all([
          readRuleDetail(item.id),
          readRuleHistory(item.id),
        ])

        if (nextDetail.type !== "rule") {
          throw new Error("读取到的内容不是规则。")
        }

        if (cancelled) {
          return
        }

        setDetail(nextDetail)
        setDisplayedVersion({
          ...nextDetail,
          historyDirname: nextDetail.latestHistoryDirname,
          isCurrent: true,
        })
        setHistory(nextHistory)
        setSelectedHistoryDirname(nextDetail.latestHistoryDirname)
        setPreviewError(null)
      } catch (loadError) {
        logger.error("Failed to load rule detail.", {
          contentId: item.id,
          loadError,
        })

        if (cancelled) {
          return
        }

        setDetail(null)
        setDisplayedVersion(null)
        setHistory([])
        setPreviewError(loadError instanceof Error ? loadError.message : "读取规则详情失败。")
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [item, logger, open, refreshSignal])

  useEffect(() => {
    if (!open || !item || !detail || !selectedHistoryDirname || selectedHistoryDirname === detail.latestHistoryDirname) {
      if (detail) {
        setDisplayedVersion({
          ...detail,
          historyDirname: detail.latestHistoryDirname,
          isCurrent: true,
        })
      }

      setPreviewError(null)
      setIsLoading(false)
      return
    }

    let cancelled = false

    setIsLoading(true)
    setPreviewError(null)

    void (async () => {
      try {
        const nextVersion = await readRuleHistoryVersion(item.id, selectedHistoryDirname)

        if (nextVersion.type !== "rule") {
          throw new Error("读取到的历史版本不是规则。")
        }

        if (cancelled) {
          return
        }

        setDisplayedVersion(nextVersion)
        setPreviewError(null)
      } catch (loadError) {
        logger.error("Failed to load rule history version.", {
          contentId: item.id,
          historyDirname: selectedHistoryDirname,
          loadError,
        })

        if (cancelled) {
          return
        }

        setPreviewError(loadError instanceof Error ? loadError.message : "读取规则历史失败。")
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [detail, item, logger, open, selectedHistoryDirname])

  useEffect(() => {
    if (!open) {
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
  const categoryLabel = getCategoryLabel("rule", resolvedItem.category)
  const iconOption = getContentIconOption(resolvedItem.icon)
  const historyEntries = detail
    ? history.length > 0
      ? history
      : [{
          dirname: detail.latestHistoryDirname,
          modifiedAt: detail.modifiedAt,
          modifiedBy: detail.modifiedBy,
          modifiedByDisplayName: detail.modifiedByDisplayName,
          deleted: detail.deleted,
          isCurrent: true,
        }]
    : []

  const handleSave = (payload: CreateRulePayload, force = false) => {
    if (!detail) {
      return
    }

    void promise(
      async () => {
        const result = await updateRule({
          ...payload,
          id: detail.id,
          baseHistoryDirname: detail.latestHistoryDirname,
          force,
        })

        if (result.status === "saved" && result.pendingPushCount > 0 && activeRepository) {
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

          setIsEditOpen(false)
          onContentChanged?.()
          return "保存成功。"
        },
        error: (error) => error instanceof Error ? error.message : "保存失败。",
      },
    ).catch((error) => {
      logger.error("Rule save failed from detail dialog.", {
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
        loading: "正在删除 Rule...",
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
        error: (error) => error instanceof Error ? error.message : "删除 Rule 失败。",
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

    handleSave(
      {
        ...nextConflictState.payload,
      },
      true,
    )
  }

  return (
    <>
      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这条规则？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后，这条规则会从列表里隐藏，但历史记录仍会保留在仓库里。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>
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
            <AlertDialogTitle>有人在你之后改过这条规则</AlertDialogTitle>
            <AlertDialogDescription>
              {conflictState
                ? `${conflictState.latestModifiedByDisplayName || "未命名用户"} 在 ${formatDateTime(conflictState.latestModifiedAt)} 改过这条规则。你的修改会成为最新版本。`
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
            <AlertDialogAction onClick={() => void handleConflictContinue()}>
              继续保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]">
          <DialogHeader className="px-5 pt-5">
            <div className="flex min-w-0 items-start gap-4 pr-8">
                <ContentIconBadge size="lg" tone={resolvedItem.iconBg} title={resolvedItem.title}>
                  {iconOption ? (
                    <iconOption.icon className="size-6" />
                  ) : (
                    <span className="block max-w-full truncate px-1 leading-none">{resolvedItem.icon}</span>
                  )}
                </ContentIconBadge>

                <div className="flex min-w-0 flex-col gap-3">
                  <DialogTitle className="truncate">{resolvedItem.title}</DialogTitle>
                  <DialogDescription className="text-sm">{resolvedItem.description}</DialogDescription>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="max-w-full truncate">
                      @{resolvedItem.createdByDisplayName || "未命名用户"}
                    </Badge>
                    <Badge variant="secondary">{categoryLabel}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!detail}
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
            {isLoading && !displayedVersion ? (
              <Empty className="min-h-[360px] rounded-lg border border-border bg-muted/20">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <LoaderCircle className="animate-spin" />
                  </EmptyMedia>
                  <EmptyTitle>正在读取规则</EmptyTitle>
                  <EmptyDescription>请稍等一下。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : displayedVersion ? (
              <div className="flex min-h-0 flex-1 flex-col">
                {selectedHistoryDirname ? (
                  <ContentHistorySelect
                    history={historyEntries}
                    latestHistoryDirname={detail?.latestHistoryDirname ?? displayedVersion.historyDirname}
                    selectedHistoryDirname={selectedHistoryDirname}
                    onSelectedHistoryDirnameChange={setSelectedHistoryDirname}
                  />
                ) : null}

                <div className="mt-4 min-h-0 overflow-auto">
                  {previewError ? (
                    <Empty className="min-h-[360px] rounded-lg border border-border bg-muted/20">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <AlertTriangle />
                        </EmptyMedia>
                        <EmptyTitle>无法显示规则</EmptyTitle>
                        <EmptyDescription>{previewError}</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <RuleVersionView
                      version={displayedVersion}
                    />
                  )}
                </div>
              </div>
            ) : previewError ? (
              <Empty className="min-h-[360px] rounded-lg border border-border bg-muted/20">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <AlertTriangle />
                  </EmptyMedia>
                  <EmptyTitle>无法显示规则</EmptyTitle>
                  <EmptyDescription>{previewError}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Empty className="min-h-[360px] rounded-lg border border-border bg-muted/20">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <PackageOpen />
                  </EmptyMedia>
                  <EmptyTitle>找不到这条规则</EmptyTitle>
                  <EmptyDescription>它可能已经被删除。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {detail ? (
        <RuleCreateDialog
          initialValue={buildRuleInitialValue(detail)}
          mode="edit"
          open={isEditOpen}
          onOpenChange={setIsEditOpen}
          onSubmit={(payload) => handleSave(payload)}
        />
      ) : null}
    </>
  )
}

export { RuleDetailDialog }
