import { Badge } from "../../../../src/components/ui/badge"
import { ScrollArea } from "../../../../src/components/ui/scroll-area"
import { cn } from "../../../../src/lib/utils"
import type { SwarmTask } from "../../shared/schema"
import { formatRunStatus } from "../swarm-task-format"

type SwarmTaskSidebarProps = {
  readonly tasks: readonly SwarmTask[]
  readonly selectedTaskId: string | null
  readonly onSelectTask: (taskId: string) => void
}

export function SwarmTaskSidebar({
  tasks,
  selectedTaskId,
  onSelectTask,
}: SwarmTaskSidebarProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid">
          {tasks.map((task) => {
            const active = task.id === selectedTaskId
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onSelectTask(task.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "grid min-h-16 gap-1 border-b px-3 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
                  active && "bg-muted hover:bg-muted",
                )}
              >
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{task.name}</span>
                  {task.lastStatus ? (
                    <Badge variant="outline" className="text-muted-foreground">
                      {formatRunStatus(task.lastStatus)}
                    </Badge>
                  ) : null}
                </span>
                <span className="truncate text-xs text-muted-foreground">{task.currentConfig.workspacePath}</span>
              </button>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
