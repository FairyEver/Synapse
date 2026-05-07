import { useState } from "react"

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
import type { TaskExportEntry } from "../types"
import { formatTaskTrigger } from "../utils"

function TaskImportDialog({
  open,
  onOpenChange,
  entries,
  onImport,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entries: TaskExportEntry[]
  onImport: (indices: number[]) => void
}) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(entries.map((_, i) => i)),
  )

  const allSelected = selected.size === entries.length && entries.length > 0
  const someSelected = selected.size > 0 && selected.size < entries.length

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(entries.map((_, i) => i)))
    }
  }

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导入任务</DialogTitle>
          <DialogDescription>选择要导入的任务</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b pb-2">
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={toggleAll}
          />
          <span className="text-sm text-muted-foreground">
            已选 {selected.size} 项
          </span>
        </div>
        <ScrollArea className="max-h-64">
          <div className="flex flex-col gap-1">
            {entries.map((entry, index) => (
              <label
                key={index}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <Checkbox
                  checked={selected.has(index)}
                  onCheckedChange={() => toggle(index)}
                />
                <span className="flex-1 truncate text-sm">{entry.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatTaskTrigger(entry)}
                </span>
              </label>
            ))}
          </div>
        </ScrollArea>
        <p className="text-xs text-muted-foreground">
          导入的任务默认为未启用状态
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={selected.size === 0}
            onClick={() => onImport(Array.from(selected))}
          >
            导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { TaskImportDialog }
