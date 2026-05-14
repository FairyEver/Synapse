import {
  History,
  MoreHorizontal,
  Pencil,
  Play,
  Trash2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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

function TaskCard({
  task,
  projects,
  busy,
  onRun,
  onToggleEnabled,
  onEdit,
  onHistory,
  onDelete,
}: TaskCardProps) {
  const disabled = !task.enabled
  const activeRunning = task.activeRun?.status === "running"
  const badge = getStatusBadge(task)
  const primaryLabel = getPrimaryActionLabel(task)
  const nextRun = formatTaskNextRun(task)
  const lastRun = formatLastRun(task)
  const scope = formatTaskScope(task, projects)

  return (
    <div
      className={`rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 ${disabled ? "opacity-70" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <Switch
          size="sm"
          checked={task.enabled}
          disabled={busy}
          onCheckedChange={onToggleEnabled}
        />
      </div>

      <div className="mt-4 min-w-0">
        <h3 className="truncate text-sm font-medium">{task.name}</h3>
        {task.description ? (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {task.description}
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/50 p-3">
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
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
          <span className="text-muted-foreground">上次</span>
          <span className="truncate">{lastRun}</span>
        </div>
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
          <span className="text-muted-foreground">范围</span>
          <span className="truncate">{scope}</span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={!activeRunning && (task.lastStatus === "failed" || task.lastStatus === "timeout") ? "default" : "secondary"}
              size="sm"
              disabled={disabled || busy || activeRunning}
              onClick={onRun}
            >
              <Play className="size-3.5" />
              {primaryLabel}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{primaryLabel}</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={busy}>
              <MoreHorizontal className="size-3.5" />
              <span className="sr-only">更多操作</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="size-3.5" />
              编辑
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onHistory}>
              <History className="size-3.5" />
              历史
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 className="size-3.5" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export { TaskCard }
export type { TaskCardProps }
