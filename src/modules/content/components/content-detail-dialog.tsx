import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  FileText,
  History,
  LoaderCircle,
  PackageOpen,
  Pencil,
  Trash2,
} from "lucide-react"
import {
  deleteContent,
  updateRule,
  updateSkill,
} from "@/app-shell/content"
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { InlineNotice } from "@/components/inline-notice"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getContentIconOption } from "@/lib/content-appearance"
import { getCategoryLabel } from "@/lib/content-categories"
import { ContentActionSplitButton } from "@/modules/content/components/content-action-split-button"
import { useContentDetail } from "@/modules/content/hooks/use-content-detail"
import { ContentIconBadge } from "@/modules/content/components/content-icon-badge"
import { RuleCreateDialog } from "@/modules/rules/components/rule-create-dialog"
import type { CreateRulePayload } from "@/modules/rules/types"
import { SkillCreateDialog } from "@/modules/skills/components/skill-create-dialog"
import type { CreateSkillPayload } from "@/modules/skills/types"
import type {
  SynapseContentMeta,
  SynapseDeleteContentPayload,
  SynapseRuleDetail,
  SynapseSkillDetail,
  SynapseUpdateRulePayload,
  SynapseUpdateSkillPayload,
} from "@/types/content"

type ContentDetailDialogProps = {
  item: SynapseContentMeta | null
  onOpenChange: (open: boolean) => void
  onStatusChange?: (message: string | null, tone?: "default" | "destructive") => void
  open: boolean
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
      mode: "rule"
      payload: CreateRulePayload
    }
  | {
      latestHistoryDirname: string
      latestModifiedByDisplayName: string
      latestModifiedAt: string
      mode: "skill"
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

function buildSkillInitialValue(detail: SynapseSkillDetail): CreateSkillPayload {
  return {
    title: detail.title,
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

function ContentVersionView({
  isHistorical,
  version,
}: {
  isHistorical: boolean
  version: NonNullable<ReturnType<typeof useContentDetail>["displayedVersion"]>
}) {
  return (
    <div className="flex flex-col gap-4">
      {isHistorical ? (
        <InlineNotice
          message={`你在查看历史版本（${formatDateTime(version.modifiedAt)}），这不是当前内容。`}
        />
      ) : null}

      {version.deleted ? (
        <InlineNotice message="该内容已被删除。" tone="destructive" />
      ) : null}

      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
          {version.content}
        </pre>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground">附件</p>
        {version.attachments.length > 0 ? (
          <div className="rounded-lg border border-border">
            <ul className="divide-y divide-border">
              {version.attachments.map((attachment) => (
                <li key={`${attachment.sha256}:${attachment.originalName}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="truncate text-foreground">{attachment.originalName}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {attachment.size} B
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">没有附件。</p>
        )}
      </div>
    </div>
  )
}

function ContentHistoryPanel({
  history,
  isLoading,
  selectedHistoryDirname,
  setSelectedHistoryDirname,
}: {
  history: ReturnType<typeof useContentDetail>["history"]
  isLoading: boolean
  selectedHistoryDirname: string | null
  setSelectedHistoryDirname: (historyDirname: string | null) => void
}) {
  if (isLoading && history.length === 0) {
    return (
      <Empty className="min-h-[320px] rounded-lg border border-border bg-muted/20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LoaderCircle className="animate-spin" />
          </EmptyMedia>
          <EmptyTitle>正在读取历史</EmptyTitle>
          <EmptyDescription>请稍等一下。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (history.length === 0) {
    return (
      <Empty className="min-h-[320px] rounded-lg border border-border bg-muted/20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <History />
          </EmptyMedia>
          <EmptyTitle>还没有历史记录</EmptyTitle>
          <EmptyDescription>当前内容只有一条版本。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="rounded-lg border border-border">
      <ul className="divide-y divide-border">
        {history.map((entry) => {
          const isSelected = selectedHistoryDirname
            ? selectedHistoryDirname === entry.dirname
            : entry.isCurrent

          return (
            <li key={entry.dirname}>
              <button
                type="button"
                className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted/20"
                onClick={() => {
                  setSelectedHistoryDirname(entry.isCurrent ? null : entry.dirname)
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">
                    {formatDateTime(entry.modifiedAt)}
                  </span>
                  {entry.isCurrent ? (
                    <span className="text-xs text-muted-foreground">当前版本</span>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {entry.modifiedByDisplayName || "未命名用户"} #{entry.modifiedBy.slice(0, 8)}
                </p>
                {entry.deleted ? (
                  <p className="text-sm text-muted-foreground">删除了此内容</p>
                ) : null}
                {isSelected ? (
                  <p className="text-xs text-muted-foreground">正在查看</p>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ContentDetailDialog({
  item,
  onOpenChange,
  onStatusChange,
  open,
}: ContentDetailDialogProps) {
  const {
    detail,
    displayedVersion,
    history,
    isLoading,
    previewError,
    selectedHistoryDirname,
    setSelectedHistoryDirname,
  } = useContentDetail(item, open)
  const [activeTab, setActiveTab] = useState("content")
  const [isRuleEditOpen, setIsRuleEditOpen] = useState(false)
  const [isSkillEditOpen, setIsSkillEditOpen] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [conflictState, setConflictState] = useState<ConflictState | null>(null)

  useEffect(() => {
    if (!open) {
      setActiveTab("content")
      setSelectedHistoryDirname(null)
      setIsRuleEditOpen(false)
      setIsSkillEditOpen(false)
      setIsDeleteConfirmOpen(false)
      setConflictState(null)
    }
  }, [open, setSelectedHistoryDirname])

  if (!item) {
    return null
  }

  const resolvedItem = detail ?? item
  const categoryLabel = getCategoryLabel(item.type, resolvedItem.category)
  const iconOption = getContentIconOption(resolvedItem.icon)

  const handleRuleSave = async (payload: CreateRulePayload, force = false) => {
    if (!detail || detail.type !== "rule") {
      return
    }

    const result = await updateRule({
      ...payload,
      id: detail.id,
      baseHistoryDirname: detail.latestHistoryDirname,
      force,
    })

    if (result.status === "conflict") {
      setConflictState({
        latestHistoryDirname: result.latestHistoryDirname,
        latestModifiedAt: result.latestModifiedAt,
        latestModifiedByDisplayName: result.latestModifiedByDisplayName,
        mode: "rule",
        payload,
      })
      return
    }

    setIsRuleEditOpen(false)
    onStatusChange?.(result.message)
  }

  const handleSkillSave = async (payload: CreateSkillPayload, force = false) => {
    if (!detail || detail.type !== "skill") {
      return
    }

    const result = await updateSkill({
      ...payload,
      id: detail.id,
      baseHistoryDirname: detail.latestHistoryDirname,
      force,
      files: payload.files.map((file) => ({
        originalName: file.originalName,
        sha256: file.sha256,
        size: file.size,
        bytes: file.file ? new Uint8Array(await file.file.arrayBuffer()) : undefined,
      })),
    })

    if (result.status === "conflict") {
      setConflictState({
        latestHistoryDirname: result.latestHistoryDirname,
        latestModifiedAt: result.latestModifiedAt,
        latestModifiedByDisplayName: result.latestModifiedByDisplayName,
        mode: "skill",
        payload,
      })
      return
    }

    setIsSkillEditOpen(false)
    onStatusChange?.(result.message)
  }

  const handleDelete = async (force = false) => {
    if (!detail) {
      return
    }

    const result = await deleteContent({
      id: detail.id,
      type: detail.type,
      baseHistoryDirname: detail.latestHistoryDirname,
      force,
    })

    if (result.status === "conflict") {
      setConflictState({
        latestHistoryDirname: result.latestHistoryDirname,
        latestModifiedAt: result.latestModifiedAt,
        latestModifiedByDisplayName: result.latestModifiedByDisplayName,
        mode: "delete",
        payload: {
          id: detail.id,
          type: detail.type,
          baseHistoryDirname: detail.latestHistoryDirname,
        },
      })
      return
    }

    setIsDeleteConfirmOpen(false)
    onOpenChange(false)
    onStatusChange?.(result.message)
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

    if (nextConflictState.mode === "rule") {
      await handleRuleSave(
        {
          ...nextConflictState.payload,
        },
        true,
      )
      return
    }

    await handleSkillSave(
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
            <AlertDialogTitle>确认删除这条内容？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后，这条内容会从列表里隐藏，但历史记录仍会保留在仓库里。
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
            <AlertDialogTitle>有人在你之后改过这条内容</AlertDialogTitle>
            <AlertDialogDescription>
              {conflictState
                ? `${conflictState.latestModifiedByDisplayName || "未命名用户"} 在 ${formatDateTime(conflictState.latestModifiedAt)} 改过这条内容。你的修改会成为最新版本。`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                if (conflictState) {
                  setActiveTab("history")
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
        <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="px-5 pt-5">
            <div className="flex items-start justify-between gap-4 pr-8">
              <div className="flex min-w-0 items-start gap-4">
                <ContentIconBadge size="lg" tone={resolvedItem.iconBg} title={resolvedItem.title}>
                  {iconOption ? (
                    <iconOption.icon className="size-6" />
                  ) : (
                    <span className="block max-w-full truncate px-1 leading-none">{resolvedItem.icon}</span>
                  )}
                </ContentIconBadge>

                <div className="min-w-0 space-y-2">
                  <DialogTitle className="truncate">{resolvedItem.title}</DialogTitle>
                  <DialogDescription className="text-sm">{resolvedItem.description}</DialogDescription>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>分类：{categoryLabel}</span>
                    <span>创建者：{resolvedItem.createdByDisplayName || "未命名用户"}</span>
                    <span>修改于：{formatDateTime(resolvedItem.modifiedAt)}</span>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (detail?.type === "rule") {
                      setIsRuleEditOpen(true)
                    } else if (detail?.type === "skill") {
                      setIsSkillEditOpen(true)
                    }
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
                <ContentActionSplitButton item={resolvedItem} onStatusChange={onStatusChange} />
              </div>
            </div>
          </DialogHeader>

          <Separator className="mt-5" />

          <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
            {previewError ? (
              <Empty className="min-h-[360px] rounded-lg border border-border bg-muted/20">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <AlertTriangle />
                  </EmptyMedia>
                  <EmptyTitle>无法显示内容</EmptyTitle>
                  <EmptyDescription>{previewError}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : isLoading && !displayedVersion ? (
              <Empty className="min-h-[360px] rounded-lg border border-border bg-muted/20">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <LoaderCircle className="animate-spin" />
                  </EmptyMedia>
                  <EmptyTitle>正在读取内容</EmptyTitle>
                  <EmptyDescription>请稍等一下。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : displayedVersion ? (
              <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1">
                <TabsList variant="line" className="w-fit">
                  <TabsTrigger value="content">
                    <FileText />
                    内容
                  </TabsTrigger>
                  <TabsTrigger value="history">
                    <History />
                    历史
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="content" className="mt-4 min-h-0 overflow-auto">
                  <ContentVersionView
                    isHistorical={!displayedVersion.isCurrent}
                    version={displayedVersion}
                  />
                </TabsContent>

                <TabsContent value="history" className="mt-4 min-h-0 overflow-auto">
                  <ContentHistoryPanel
                    history={history}
                    isLoading={isLoading}
                    selectedHistoryDirname={selectedHistoryDirname}
                    setSelectedHistoryDirname={setSelectedHistoryDirname}
                  />
                </TabsContent>
              </Tabs>
            ) : (
              <Empty className="min-h-[360px] rounded-lg border border-border bg-muted/20">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <PackageOpen />
                  </EmptyMedia>
                  <EmptyTitle>找不到这条内容</EmptyTitle>
                  <EmptyDescription>它可能已经被删除。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {detail?.type === "rule" ? (
        <RuleCreateDialog
          initialValue={buildRuleInitialValue(detail)}
          mode="edit"
          open={isRuleEditOpen}
          onOpenChange={setIsRuleEditOpen}
          onSubmit={(payload) => handleRuleSave(payload)}
        />
      ) : null}

      {detail?.type === "skill" ? (
        <SkillCreateDialog
          initialValue={buildSkillInitialValue(detail)}
          mode="edit"
          open={isSkillEditOpen}
          onOpenChange={setIsSkillEditOpen}
          onSubmit={(payload) => handleSkillSave(payload)}
        />
      ) : null}
    </>
  )
}

export { ContentDetailDialog }
