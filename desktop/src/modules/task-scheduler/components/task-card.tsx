import {
  Pencil,
  History,
  Trash2,
  Play,
  Square,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { ScheduledTask } from "@/types/task-scheduler"
import { formatTaskTrigger, formatTaskDate } from "../utils"

type TaskCardProps = {
  task: ScheduledTask
  busy: boolean
  onRun: () => void
  onStop: () => void
  onToggleEnabled: (enabled: boolean) => void
  onEdit: () => void
  onHistory: () => void
  onDelete: () => void
}

function getStatusDotClass(task: ScheduledTask): string {
  if (!task.enabled) return "bg-muted-foreground"
  if (task.lastStatus === "failed" || task.lastStatus === "timeout") return "bg-destructive"
  return "bg-green-500"
}

function TaskCard({
  task,
  busy,
  onRun,
  onStop,
  onToggleEnabled,
  onEdit,
  onHistory,
  onDelete,
}: TaskCardProps) {
  const disabled = !task.enabled

  return (
    <div
      className={`rounded-lg bg-background px-4 py-4 hover:ring-2 hover:ring-muted-foreground/25 transition-shadow ${disabled ? "opacity-60" : ""}`}
    >
      {/* Header: 状态 + 标题 + 开关 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`size-2 shrink-0 rounded-full ${getStatusDotClass(task)}`}
          />
          <span className="truncate font-medium text-sm">{task.name}</span>
        </div>
        <Switch
          size="sm"
          checked={task.enabled}
          onCheckedChange={onToggleEnabled}
        />
      </div>

      {/* Info area */}
      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between">
          <span>触发</span>
          <span className="text-foreground">{formatTaskTrigger(task)}</span>
        </div>
        <div className="flex justify-between">
          <span>上次</span>
          <span className="text-foreground">
            {formatTaskDate(task.lastRunAt, "—")}
          </span>
        </div>
        <div className="flex justify-between">
          <span>下次</span>
          <span className="text-foreground">
            {disabled ? "—" : formatTaskDate(task.nextRunAt, "—")}
          </span>
        </div>
      </div>

      {/* Footer: 操作按钮图标，靠右显示 */}
      <div className="mt-3 flex items-center justify-end gap-1 border-t pt-3">
        <Tooltip>
          <TooltipTrigger asChild>
            {busy ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onStop}
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                onClick={onRun}
              >
                <Play className="size-3.5" />
              </Button>
            )}
          </TooltipTrigger>
          <TooltipContent>{busy ? "停止" : "运行"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onEdit}>
              <Pencil className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>编辑</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onHistory}>
              <History className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>历史</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onDelete}>
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
