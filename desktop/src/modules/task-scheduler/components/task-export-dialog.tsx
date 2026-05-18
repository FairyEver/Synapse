import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { track } from "@/lib/ui-tracking"
import type { ScheduledTask } from "@/types/task-scheduler"
import { formatTaskTrigger } from "../utils"

function TaskExportDialog({
  open,
  onOpenChange,
  tasks,
  onExport,
  isExporting = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tasks: ScheduledTask[]
  onExport: (selectedIds: string[]) => void
  isExporting?: boolean
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    const taskIds = new Set(tasks.map((task) => task.id))
    setSelected((prev) => {
      const next = new Set(Array.from(prev).filter((id) => taskIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [tasks])

  const allSelected = selected.size === tasks.length && tasks.length > 0
  const someSelected = selected.size > 0 && selected.size < tasks.length

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(tasks.map((t) => t.id)))
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleExport() {
    const selectedTasks = tasks.filter((task) => selected.has(task.id))
    track({
      component: "task-scheduler",
      name: "task-export-submit",
      action: "submit",
      metadata: {
        boundary: "renderer.task-scheduler.export.dialog",
        taskCount: tasks.length,
        selectedCount: selectedTasks.length,
        agentTaskCount: selectedTasks.filter((task) => task.action.type === "builtin.agent").length,
        actionTypes: Array.from(new Set(selectedTasks.map((task) => task.action.type))).sort(),
        triggerTypes: Array.from(new Set(selectedTasks.map((task) => task.trigger.type))).sort(),
      },
    })
    onExport(selectedTasks.map((task) => task.id))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导出任务</DialogTitle>
          <DialogDescription>选择要导出的任务</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b pb-2">
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={toggleAll}
            aria-label="全选"
          />
          <span className="text-sm text-muted-foreground">
            已选 {selected.size} 项
          </span>
        </div>
        <ScrollArea className="max-h-64">
          <div className="flex flex-col gap-1">
            {tasks.map((task) => (
              <label
                key={task.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <Checkbox
                  checked={selected.has(task.id)}
                  onCheckedChange={() => toggle(task.id)}
                />
                <span className="flex-1 truncate text-sm">{task.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatTaskTrigger(task)}
                </span>
              </label>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" disabled={isExporting} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={selected.size === 0 || isExporting}
            onClick={handleExport}
          >
            {isExporting ? "导出中..." : "导出"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { TaskExportDialog }
