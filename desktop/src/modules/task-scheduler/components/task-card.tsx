import {
  History,
  Pencil,
  Play,
  Square,
  Trash2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { SynapseProjectConfig } from "@/types/config"
import type { ScheduledTask } from "@/types/task-scheduler"
import {
  formatTaskDate,
  formatTaskNextRun,
  formatTaskScope,
  formatTaskStatus,
  formatTaskTrigger,
} from "../utils"

type TaskCardProps = {
  task: ScheduledTask
  projects: readonly SynapseProjectConfig[]
  busy: boolean
  onRun: () => void
  onStop: () => void
  onToggleEnabled: (enabled: boolean) => void
  onEdit: () => void
  onHistory: () => void
  onDelete: () => void
}

function getStatusBadge(task: ScheduledTask): {
  label: string
  variant: "default" | "secondary" | "destructive" | "outline"
} {
  if (task.validation?.status === "needs_update") {
    return { label: "需要更新", variant: "outline" }
  }
  if (!task.enabled) {
    return { label: "已停用", variant: "outline" }
  }
  if (task.lastStatus === "failed" || task.lastStatus === "timeout") {
    return { label: "上次失败", variant: "destructive" }
  }
  return { label: "已启用", variant: "secondary" }
}

function getPrimaryActionLabel(task: ScheduledTask): string {
  if (task.activeRun?.status === "running") return "运行中"
  if (task.lastStatus === "failed" || task.lastStatus === "timeout") return "重试"
  return "运行"
}

function formatLastRun(task: ScheduledTask): string {
  const date = formatTaskDate(task.lastRunAt, "—")
  if (!task.lastStatus) return date
  return `${date} · ${formatTaskStatus(task.lastStatus)}`
}

function formatTaskDescription(description: string | undefined): string {
  return description?.trim() || "暂无备注"
}

function TaskCard({
  task,
  projects,
  busy,
  onRun,
  onStop,
  onToggleEnabled,
  onEdit,
  onHistory,
  onDelete,
}: TaskCardProps) {
  const needsUpdate = task.validation?.status === "needs_update"
  const disabled = !task.enabled
  const activeRunning = task.activeRun?.status === "running"
  const badge = getStatusBadge(task)
  const primaryLabel = getPrimaryActionLabel(task)
  const nextRun = formatTaskNextRun(task)
  const lastRun = formatLastRun(task)
  const scope = formatTaskScope(task, projects)
  const description = formatTaskDescription(task.description)

  return (
    <div
      className={`flex h-full flex-col rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 ${disabled ? "opacity-70" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <Switch
          size="sm"
          checked={task.enabled}
          disabled={busy || needsUpdate}
          aria-label={needsUpdate
            ? `需要更新后才能启用任务 ${task.name}`
            : task.enabled ? `停用任务 ${task.name}` : `启用任务 ${task.name}`}
          onCheckedChange={onToggleEnabled}
        />
      </div>

      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{task.name}</h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="shrink-0">
          {activeRunning ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={onStop}
            >
              <Square className="size-3.5" />
              停止
            </Button>
          ) : (
            <Button
              variant={task.lastStatus === "failed" || task.lastStatus === "timeout" ? "default" : "secondary"}
              size="sm"
              disabled={disabled || busy}
              onClick={onRun}
            >
              <Play className="size-3.5" />
              {primaryLabel}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/50 p-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">下次执行</p>
          <p className="mt-1 truncate text-sm font-medium">{nextRun}</p>
        </div>
        <div className="min-w-0 border-l border-border pl-3">
          <p className="text-xs text-muted-foreground">计划</p>
          <p className="mt-1 truncate text-sm font-medium">
            {formatTaskTrigger(task)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-1 text-xs">
        <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
          <span className="text-muted-foreground">上次</span>
          <span className="truncate">{lastRun}</span>
        </div>
        <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
          <span className="text-muted-foreground">范围</span>
          <span className="truncate">{scope}</span>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-end gap-1 pt-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label="编辑"
              onClick={onEdit}
            >
              <Pencil className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>编辑</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label="历史"
              onClick={onHistory}
            >
              <History className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>历史</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="destructive"
              size="icon-sm"
              disabled={busy}
              aria-label="删除"
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>删除</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

export { TaskCard }
export type { TaskCardProps }
