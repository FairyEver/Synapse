import { useCallback, useEffect, useState } from "react"
import { File, FolderOpen, LoaderCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { MarkdownViewer } from "@/components/markdown-viewer"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { cn } from "@/lib/utils"
import type { EditorScanItemSource, EditorScanSkillFileEntry } from "@/types/editor-scan"
import { useScanItemContent, useSkillFiles } from "../hooks/use-scan-item-content"

const logger = createRendererLogger("editor-scan")

type ScanItemForDetail = {
  type: "skill" | "rule"
  name: string
  path: string
  source: EditorScanItemSource
  preview: string
  fileCount?: number
  metadata?: Record<string, string>
}

type ScanItemDetailDialogProps = {
  item: ScanItemForDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function ScanItemDetailDialog({ item, open, onOpenChange }: ScanItemDetailDialogProps) {
  const { content, loading, error } = useScanItemContent(open ? item?.path ?? null : null)
  const skillFiles = useSkillFiles(
    open && item?.type === "skill" ? item.path : null,
  )
  const { success, error: notifyError } = useAppNotifications()
  const [viewMode, setViewMode] = useState<"rendered" | "source">("rendered")
  const [contentReady, setContentReady] = useState(false)

  useEffect(() => {
    if (!open) {
      setViewMode("rendered")
      setContentReady(false)
      return
    }
    const timer = setTimeout(() => setContentReady(true), 200)
    return () => clearTimeout(timer)
  }, [open])

  const handleCopy = useCallback(async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      success("已复制到剪贴板。")
      logger.info("Scan item content copied.", { path: item?.path })
    } catch {
      notifyError("复制失败。")
    }
  }, [content, item?.path, success, notifyError])

  const handleOpenInFinder = useCallback(() => {
    if (!item) return
    getSynapseBridge()?.shell.showItemInFolder(item.path)
  }, [item])

  if (!item) return null

  const metaEntries = item.metadata
    ? Object.entries(item.metadata).filter(([, v]) => v)
    : []

  return (
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

        <div className="border-t px-5 py-3">
          <button
            type="button"
            className="flex max-w-full items-center gap-1 text-xs text-muted-foreground/50 hover:text-foreground transition-colors"
            onClick={handleOpenInFinder}
          >
            <FolderOpen className="size-3 shrink-0" />
            <span className="truncate">{item.path}</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
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
export type { ScanItemForDetail }
