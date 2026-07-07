import { Search } from "lucide-react"
import { Input } from "../../../../src/components/ui/input"
import { ScrollArea } from "../../../../src/components/ui/scroll-area"
import { cn } from "../../../../src/lib/utils"
import type { SwarmTask } from "../../shared/schema"

type SwarmTaskSidebarProps = {
  readonly tasks: readonly SwarmTask[]
  readonly selectedTaskId: string | null
  readonly search: string
  readonly onSearchChange: (value: string) => void
  readonly onSelectTask: (taskId: string) => void
}

export function SwarmTaskSidebar({
  tasks,
  selectedTaskId,
  search,
  onSearchChange,
  onSelectTask,
}: SwarmTaskSidebarProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            className="pl-9"
            placeholder="搜索任务"
            aria-label="搜索任务"
          />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid">
          {tasks.map((task) => {
            const active = task.id === selectedTaskId
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onSelectTask(task.id)}
                className={cn(
                  "grid gap-1 border-b px-3 py-3 text-left",
                  active && "bg-muted",
                )}
              >
                <span className="truncate text-sm font-medium">{task.name}</span>
                <span className="truncate text-xs text-muted-foreground">{task.currentConfig.workspacePath}</span>
              </button>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
