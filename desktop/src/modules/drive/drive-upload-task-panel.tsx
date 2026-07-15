import { memo } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { DriveUploadTask, DriveUploadTaskItem, DriveUploadTaskItemStatus } from "./drive-upload-task"

export function DriveUploadTaskPanel({
  task,
  open,
  retrying = false,
  onClear,
  onOpenChange,
  onRetry,
}: {
  readonly task: DriveUploadTask | null
  readonly open: boolean
  readonly retrying?: boolean
  readonly onClear?: () => void
  readonly onOpenChange: (open: boolean) => void
  readonly onRetry?: () => void
}) {
  const completedCount = task ? task.completedItems + task.failedItems + task.skippedItems : 0
  const progressValue = task && task.totalItems > 0 ? Math.round((completedCount / task.totalItems) * 100) : 0
  const currentItem = task?.items.find((item) => item.status === "uploading")
    ?? task?.items.find((item) => item.status === "queued")
    ?? null
  const canRetry = Boolean(task && task.status !== "running" && task.failedItems > 0 && onRetry)
  const canClear = Boolean(task && task.status !== "running" && onClear)

  return (
    <Sheet open={open} onOpenChange={onOpenChange} data-track="drive-upload-task-panel">
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>上传任务</SheetTitle>
          <SheetDescription className="min-w-0">
            <EndTruncatedText value={task ? task.destinationPath : "无任务"} />
          </SheetDescription>
        </SheetHeader>
        {task ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-foreground">{uploadTaskStatusText(task)}</span>
                <span className="tabular-nums text-muted-foreground">{completedCount} / {task.totalItems}</span>
              </div>
              <Progress value={progressValue} aria-label="上传进度" />
              <div className="grid grid-cols-3 gap-2 text-sm">
                <UploadMetric label="已完成" value={task.completedItems} />
                <UploadMetric label="失败" value={task.failedItems} />
                <UploadMetric label="跳过" value={task.skippedItems} />
              </div>
            </div>

            {currentItem ? (
              <div className="space-y-1 border-y py-3">
                <div className="text-xs text-muted-foreground">当前</div>
                <EndTruncatedText value={displayPath(currentItem)} className="text-sm font-medium text-foreground" />
                {currentItem.status === "uploading" && currentItem.uploadedBytes !== null && currentItem.totalBytes !== null ? (
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="tabular-nums">{formatBytes(currentItem.uploadedBytes)} / {formatBytes(currentItem.totalBytes)}</span>
                    <span className="tabular-nums">{formatUploadPercent(currentItem.uploadedBytes, currentItem.totalBytes)}</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-1 pr-3">
                {task.items.map((item) => (
                  <UploadTaskItemRow key={item.key} item={item} />
                ))}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="px-4 text-sm text-muted-foreground">暂无上传</div>
        )}
        {(canRetry || canClear) ? (
          <SheetFooter>
            <div className="flex items-center justify-end gap-2">
              {canClear ? (
                <Button type="button" variant="outline" onClick={onClear}>
                  清除
                </Button>
              ) : null}
              {canRetry ? (
                <Button type="button" disabled={retrying} onClick={onRetry}>
                  {retrying ? "重试中" : "重试失败项"}
                </Button>
              ) : null}
            </div>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function UploadMetric({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="rounded-md border px-2 py-1.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums text-foreground">{value}</div>
    </div>
  )
}

const UploadTaskItemRow = memo(function UploadTaskItemRow({ item }: { readonly item: DriveUploadTaskItem }) {
  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
      <div className="min-w-0 flex-1">
        <EndTruncatedText value={displayPath(item)} className="text-sm font-medium text-foreground" />
        <div className="truncate text-xs text-muted-foreground">
          {item.mimeType ?? "未知类型"}{item.message ? ` · ${item.message}` : ""}
        </div>
      </div>
      <Badge variant={statusBadgeVariant(item.status)} className={cn("shrink-0", item.status === "uploading" && "animate-pulse")}>
        {statusLabel(item.status)}
      </Badge>
    </div>
  )
})

function EndTruncatedText({ value, className }: { readonly value: string; readonly className?: string }) {
  return (
    <span dir="rtl" className={cn("block truncate text-left", className)} title={value}>
      {value}
    </span>
  )
}

function uploadTaskStatusText(task: DriveUploadTask): string {
  if (task.status === "running") return "正在上传"
  if (task.status === "failed") return "上传失败"
  return "上传完成"
}

function displayPath(item: DriveUploadTaskItem): string {
  return item.relativePath ?? item.name
}

function statusBadgeVariant(status: DriveUploadTaskItemStatus): "secondary" | "destructive" | "outline" {
  if (status === "failed") return "destructive"
  if (status === "completed") return "secondary"
  return "outline"
}

function statusLabel(status: DriveUploadTaskItemStatus): string {
  if (status === "queued") return "等待"
  if (status === "preparing") return "准备"
  if (status === "uploading") return "上传中"
  if (status === "completed") return "完成"
  if (status === "skipped") return "跳过"
  return "失败"
}

function formatUploadPercent(uploadedBytes: number, totalBytes: number): string {
  if (totalBytes <= 0) return "0%"
  const percent = Math.min(100, Math.max(0, Math.round((uploadedBytes / totalBytes) * 100)))
  return `${percent}%`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
