import {
  MoreHorizontal,
  Pencil,
  History,
  Trash2,
  Play,
  Square,
} from "lucide-react"

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
      {/* Title row */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`size-2 shrink-0 rounded-full ${getStatusDotClass(task)}`}
        />
        <span className="truncate font-medium text-sm">{task.name}</span>
      </div>

      {/* Info area */}
      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between">
          <span>Trigger</span>
          <span className="text-foreground">{formatTaskTrigger(task)}</span>
        </div>
        <div className="flex justify-between">
          <span>Last Run</span>
          <span className="text-foreground">
            {formatTaskDate(task.lastRunAt, "—")}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Next Run</span>
          <span className="text-foreground">
            {disabled ? "—" : formatTaskDate(task.nextRunAt, "—")}
          </span>
        </div>
      </div>

      {/* Action bar */}
      <div className="mt-3 flex items-center justify-between border-t pt-3">
        <div className="flex items-center gap-2">
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
          <Switch
            size="sm"
            checked={task.enabled}
            onCheckedChange={onToggleEnabled}
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-4" />
              编辑
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onHistory}>
              <History className="size-4" />
              历史
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} variant="destructive">
              <Trash2 className="size-4" />
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
