import { Circle, CircleAlert, LoaderCircle, MoreHorizontal, Trash2, type LucideIcon } from "lucide-react"
import { Button } from "../../../../src/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../../src/components/ui/dropdown-menu"
import { ScrollArea } from "../../../../src/components/ui/scroll-area"
import { cn } from "../../../../src/lib/utils"
import type { SwarmTask } from "../../shared/schema"
import { formatRunStatus } from "../swarm-task-format"

type SwarmTaskSidebarProps = {
  readonly tasks: readonly SwarmTask[]
  readonly selectedTaskId: string | null
  readonly onSelectTask: (taskId: string) => void
  readonly onRenameTask: (task: SwarmTask) => void
  readonly onDeleteTask: (task: SwarmTask) => void
}

type TaskStatusIcon = {
  readonly Icon: LucideIcon
  readonly label: string
  readonly className: string
}

export function SwarmTaskSidebar({
  tasks,
  selectedTaskId,
  onSelectTask,
  onRenameTask,
  onDeleteTask,
}: SwarmTaskSidebarProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid">
          {tasks.map((task) => {
            const active = task.id === selectedTaskId
            const statusIcon = getTaskStatusIcon(task.lastStatus)
            return (
              <div
                key={task.id}
                className={cn(
                  "group flex min-h-12 items-center gap-1 border-b transition-colors hover:bg-muted/60",
                  active && "bg-muted hover:bg-muted",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectTask(task.id)}
                  aria-current={active ? "page" : undefined}
                  className="flex min-h-12 min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
                >
                  <span
                    className="flex size-4 shrink-0 items-center justify-center"
                    aria-label={statusIcon.label}
                    title={statusIcon.label}
                  >
                    <statusIcon.Icon className={cn("size-3.5", statusIcon.className)} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.name}</span>
                </button>
                <DropdownMenu data-track="swarm-task-row-menu">
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="mr-2 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
                      aria-label={`${task.name} 操作`}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onRenameTask(task)}>
                      重命名
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={isActiveRunStatus(task.lastStatus)}
                      onClick={() => onDeleteTask(task)}
                    >
                      <Trash2 className="size-3.5" />
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

function isActiveRunStatus(status: SwarmTask["lastStatus"]): boolean {
  return status === "running" || status === "draining"
}

function getTaskStatusIcon(status: SwarmTask["lastStatus"]): TaskStatusIcon {
  if (isActiveRunStatus(status)) {
    return {
      Icon: LoaderCircle,
      label: status ? formatRunStatus(status) : "未运行",
      className: "animate-spin text-foreground",
    }
  }
  if (status === "failed" || status === "partial") {
    return {
      Icon: CircleAlert,
      label: formatRunStatus(status),
      className: "text-destructive",
    }
  }
  return {
    Icon: Circle,
    label: status ? formatRunStatus(status) : "未运行",
    className: "text-muted-foreground",
  }
}
