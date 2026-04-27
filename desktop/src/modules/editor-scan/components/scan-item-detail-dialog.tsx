import { useCallback, useEffect, useState } from "react"
import { File, FolderOpen, LoaderCircle } from "lucide-react"
import { readDetail } from "@/app-shell/content"
import {
  createContentOpenRequestId,
  requestOpenContentCreate,
  requestOpenContentDetail,
} from "@/app-shell/content-navigation"
import { useCurrentRepoProfile } from "@/app-shell/identity-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Menubar } from "@/components/ui/menubar"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { MarkdownViewer } from "@/components/markdown-viewer"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { useActiveRepository, usePendingPushes } from "@/app-shell/use-repository-manager"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { cn } from "@/lib/utils"
import type { EditorScanSkillFileEntry, ScanItemForDetail } from "@/types/editor-scan"
import { useScanItemContent, useSkillFiles } from "../hooks/use-scan-item-content"
import {
  buildRuleQuickPublishPayload,
  buildSkillQuickPublishPayload,
  formatQuickPublishSourceLabel,
} from "../lib/quick-publish"

const logger = createRendererLogger("editor-scan")

type ScanItemDetailDialogProps = {
  item: ScanItemForDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function ScanItemDetailDialog({ item, open, onOpenChange }: ScanItemDetailDialogProps) {
  const { content: loadedContent, loading, error } = useScanItemContent(
    open && item?.content == null ? item?.path ?? null : null,
  )
  const skillFiles = useSkillFiles(
    open && item?.type === "skill" ? item.path : null,
  )
  const activeRepository = useActiveRepository()
  const { currentRepoProfileState } = useCurrentRepoProfile()
  const pendingPushState = usePendingPushes(activeRepository?.uuid ?? "")
  const { success, error: notifyError } = useAppNotifications()
  const [viewMode, setViewMode] = useState<"rendered" | "source">("rendered")
  const [contentReady, setContentReady] = useState(false)
  const [quickPublishError, setQuickPublishError] = useState<string | null>(null)
  const [isQuickPublishBusy, setIsQuickPublishBusy] = useState(false)
  const [fallbackReason, setFallbackReason] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setViewMode("rendered")
      setContentReady(false)
      setQuickPublishError(null)
      setFallbackReason(null)
      return
    }
    const timer = setTimeout(() => setContentReady(true), 200)
    return () => clearTimeout(timer)
  }, [open])

  const handleCopy = useCallback(async () => {
    const content = item?.content ?? loadedContent
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      success("已复制到剪贴板。")
      logger.info("Scan item content copied.", { path: item?.path })
    } catch {
      notifyError("复制失败。")
    }
  }, [item?.content, loadedContent, item?.path, success, notifyError])

  const handleOpenInFinder = useCallback(() => {
    if (!item) return
    getSynapseBridge()?.shell.showItemInFolder(item.path)
  }, [item])

  const disabledReason =
    !activeRepository
      ? "先选择本地目录"
      : currentRepoProfileState?.status === "needs-onboarding"
        ? "先完成当前目录的身份设置"
        : (pendingPushState?.count ?? 0) > 0
          ? "正在同步变更，请稍后"
          : !item?.path
            ? "本地路径为空"
            : null

  const publishAsNew = useCallback(async () => {
    if (!item || disabledReason) return
    setIsQuickPublishBusy(true)
    setQuickPublishError(null)

    try {
      const bridge = getSynapseBridge()
      if (!bridge) {
        throw new Error("当前窗口无法读取本地内容。")
      }

      const draft = await bridge.editorScan.prepareQuickPublishDraft({
        itemType: item.type,
        itemPath: item.path,
        itemName: item.name,
        ruleContent: item.type === "rule" ? item.content : undefined,
        metadata: item.metadata,
      })
      const sourceLabel = formatQuickPublishSourceLabel(item)

      if (draft.itemType === "rule") {
        requestOpenContentCreate({
          kind: "create",
          requestId: createContentOpenRequestId(),
          contentType: "rule",
          initialValue: buildRuleQuickPublishPayload(draft),
          sourceLabel,
        })
      } else {
        requestOpenContentCreate({
          kind: "create",
          requestId: createContentOpenRequestId(),
          contentType: "skill",
          initialValue: buildSkillQuickPublishPayload(draft),
          sourceLabel,
        })
      }

      onOpenChange(false)
    } catch (error) {
      logger.error("Quick publish draft preparation failed.", { path: item.path, error })
      setQuickPublishError(error instanceof Error ? error.message : "读取本地内容失败。")
    } finally {
      setIsQuickPublishBusy(false)
    }
  }, [disabledReason, item, onOpenChange])

  const handlePrimaryAction = useCallback(async () => {
    if (!item || disabledReason) return

    if (!item.synapseContentId) {
      await publishAsNew()
      return
    }

    setIsQuickPublishBusy(true)
    setQuickPublishError(null)
    try {
      const detail = await readDetail(item.type, item.synapseContentId)
      if (detail.deleted) {
        setFallbackReason("仓库内容已删除。")
        return
      }

      requestOpenContentDetail({
        kind: "detail",
        requestId: createContentOpenRequestId(),
        contentType: item.type,
        contentId: item.synapseContentId,
      })
      onOpenChange(false)
    } catch (error) {
      logger.warn("Linked repository content is unavailable.", {
        contentId: item.synapseContentId,
        contentType: item.type,
        error,
      })
      setFallbackReason("仓库内容不可用。")
    } finally {
      setIsQuickPublishBusy(false)
    }
  }, [disabledReason, item, onOpenChange, publishAsNew])

  if (!item) return null

  const metaEntries = item.metadata
    ? Object.entries(item.metadata).filter(([, v]) => v)
    : []
  const content = item.content ?? loadedContent
  const primaryActionLabel = item.synapseContentId ? "从仓库中显示" : "保存到仓库"

  return (
    <>
      <AlertDialog
        open={fallbackReason !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setFallbackReason(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>关联内容不可用</AlertDialogTitle>
            <AlertDialogDescription>
              {fallbackReason} 可以作为新内容保存。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setFallbackReason(null)
                void publishAsNew()
              }}
            >
              作为新内容保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]">
          <DialogHeader className="px-5 pt-5">
          <DialogTitle className="sr-only">{item.name}</DialogTitle>
          <DialogDescription className="sr-only">
            {item.type === "skill" ? "Skill" : "Rule"} 详情
          </DialogDescription>

          <div className="flex min-w-0 flex-col gap-3 pr-8">
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{item.name}</span>
                <Badge
                  variant={item.source === "synapse" ? "default" : "secondary"}
                  className="shrink-0 text-[10px] px-1.5 py-0"
                >
                  {item.source === "synapse" ? "Synapse" : "外部"}
                </Badge>
                <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
                  {item.type === "skill" ? "Skill" : "Rule"}
                </Badge>
              </div>

              {metaEntries.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {metaEntries.map(([k, v]) => `${k}: ${v}`).join(" · ")}
                </p>
              ) : null}

              {item.type === "skill" && item.fileCount != null ? (
                <p className="text-xs text-muted-foreground">
                  {item.fileCount} 个文件
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <Menubar className="w-fit">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="rounded-sm px-1.5"
                  disabled={!content}
                  onClick={() => void handleCopy()}
                >
                  复制内容
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="rounded-sm px-1.5"
                  onClick={handleOpenInFinder}
                >
                  在 Finder 中显示
                </Button>
              </Menubar>

              <Tabs
                value={viewMode}
                onValueChange={(v) => setViewMode(v === "source" ? "source" : "rendered")}
                className="ml-auto shrink-0 gap-0"
              >
                <TabsList>
                  <TabsTrigger value="rendered">预览</TabsTrigger>
                  <TabsTrigger value="source">源码</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {quickPublishError ? (
              <Alert variant="destructive">
                <AlertDescription>{quickPublishError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          </DialogHeader>

          <Separator className="mt-5" />

          <div className={cn(
            "flex min-h-0 flex-1 flex-col px-5 py-4 transition-opacity duration-200",
            contentReady ? "opacity-100" : "opacity-0",
          )}>
            {contentReady ? (
              <ScanItemContentArea
                content={content}
                error={error}
                loading={loading}
                viewMode={viewMode}
                skillFiles={skillFiles}
              />
            ) : null}
          </div>

          <div className="flex items-center gap-3 border-t px-5 py-3">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground/50 transition-colors hover:text-foreground"
              onClick={handleOpenInFinder}
            >
              <FolderOpen className="size-3 shrink-0" />
              <span className="truncate">{item.path}</span>
            </button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      type="button"
                      size="sm"
                      disabled={isQuickPublishBusy || disabledReason !== null}
                      onClick={() => void handlePrimaryAction()}
                    >
                      {isQuickPublishBusy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
                      {primaryActionLabel}
                    </Button>
                  </span>
                </TooltipTrigger>
                {disabledReason ? (
                  <TooltipContent>{disabledReason}</TooltipContent>
                ) : null}
              </Tooltip>
            </TooltipProvider>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

type ScanItemContentAreaProps = {
  content: string | null
  error: string | null
  loading: boolean
  viewMode: "rendered" | "source"
  skillFiles: EditorScanSkillFileEntry[]
}

function ScanItemContentArea({
  content,
  error,
  loading,
  viewMode,
  skillFiles,
}: ScanItemContentAreaProps) {
  if (loading) {
    return (
      <Empty className="min-h-[360px] rounded-lg border border-border bg-muted/20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LoaderCircle className="animate-spin" />
          </EmptyMedia>
          <EmptyTitle>正在加载内容</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  if (error) {
    return (
      <Empty className="min-h-[360px] rounded-lg border border-border bg-muted/20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LoaderCircle />
          </EmptyMedia>
          <EmptyTitle>读取失败</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (!content) {
    return (
      <Empty className="min-h-[360px] rounded-lg border border-border bg-muted/20">
        <EmptyHeader>
          <EmptyTitle>暂无内容</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <MarkdownViewer content={content} mode={viewMode} showTabs={false} surface="plain" />
      {skillFiles.length > 0 ? (
        <SkillFilesSection files={skillFiles} />
      ) : null}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function SkillFilesSection({ files }: { files: EditorScanSkillFileEntry[] }) {
  return (
    <div className="mt-4 border-t pt-4">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        关联文件
      </p>
      <div className="flex flex-col gap-1">
        {files.map((f) => (
          <div
            key={f.name}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground"
          >
            <File className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{f.name}</span>
            <span className="ml-auto shrink-0 tabular-nums">{formatFileSize(f.size)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export { ScanItemDetailDialog }
