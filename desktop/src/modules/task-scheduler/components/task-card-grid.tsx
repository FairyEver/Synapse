import { History, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import type { ScheduledTask } from "@/types/task-scheduler"
import { TaskCard } from "./task-card"

type TaskCardGridProps = {
  tasks: ScheduledTask[]
  busy: boolean
  onRun: (task: ScheduledTask) => void
  onStop: (task: ScheduledTask) => void
  onToggleEnabled: (task: ScheduledTask, enabled: boolean) => void
  onEdit: (task: ScheduledTask) => void
  onHistory: (task: ScheduledTask) => void
  onDelete: (task: ScheduledTask) => void
  onCreateNew: () => void
}

function TaskCardGrid({
  tasks,
  busy,
  onRun,
  onStop,
  onToggleEnabled,
  onEdit,
  onHistory,
  onDelete,
  onCreateNew,
}: TaskCardGridProps) {
  if (tasks.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <History />
          </EmptyMedia>
          <EmptyTitle>暂无任务</EmptyTitle>
          <EmptyDescription>新建任务后会按计划执行。</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={onCreateNew}>
            <Plus />
            新建任务
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          busy={busy}
          onRun={() => onRun(task)}
          onStop={() => onStop(task)}
          onToggleEnabled={(enabled) => onToggleEnabled(task, enabled)}
          onEdit={() => onEdit(task)}
          onHistory={() => onHistory(task)}
          onDelete={() => onDelete(task)}
        />
      ))}
    </div>
  )
}

export { TaskCardGrid }
export type { TaskCardGridProps }
