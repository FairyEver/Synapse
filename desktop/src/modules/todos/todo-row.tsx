import { Calendar, Bell, MoreHorizontal } from "lucide-react"
import type { MouseEvent } from "react"
import { TODO_PRIORITIES, type TodoItemDto, type TodoPriority } from "@synapse/shared/todo-contracts"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { priorityLabels, TodoPriorityBadge } from "./todo-priority"
import { formatTodoInstant } from "./todo-time"
import { TodoImageStrip } from "./todo-image-strip"

export function TodoRow({ item, disabled, onOpen, onEdit, onComplete, onDelete, onCopy, onPriority }: {
  item: TodoItemDto; disabled: boolean; onOpen: () => void; onEdit: () => void; onComplete: () => void
  onDelete: () => void; onCopy: () => void; onPriority: (priority: TodoPriority | null) => void
}) {
  const priority = item.priority ?? "none"
  const overdue = !item.completedAt && !!item.dueAt && new Date(item.dueAt).getTime() < Date.now()
  const handleOpen = (event: MouseEvent<HTMLButtonElement>) => {
    const selection = event.currentTarget.ownerDocument.getSelection()
    if (event.detail > 0 && selection && !selection.isCollapsed && selection.rangeCount > 0
      && selection.getRangeAt(0).intersectsNode(event.currentTarget)) return
    onOpen()
  }
  return <li className="flex items-center gap-2 px-3 py-3 sm:gap-4 sm:px-5">
    <Checkbox checked={!!item.completedAt} disabled={disabled} data-track="todos.complete" aria-label={`${item.completedAt ? "恢复" : "完成"} ${item.title}`} onCheckedChange={onComplete} />
    <div className="min-w-0 flex-1 space-y-2">
    <button type="button" data-track="todos.open" data-allow-select="true" className="block w-full min-w-0 text-left focus-visible:outline-2 focus-visible:outline-ring" onClick={handleOpen}>
      <span className={`block break-words text-sm font-medium ${item.completedAt ? "text-muted-foreground line-through" : ""}`}>{item.title}</span>
      {item.note && <span className="mt-1 block truncate text-sm text-muted-foreground">{item.note}</span>}
      {(item.dueAt || item.remindAt) && <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {item.dueAt && <span className={`flex items-center gap-1 ${overdue ? "text-destructive" : ""}`}><Calendar className="size-3.5" />{overdue ? "已逾期 · " : "截止 "}{formatTodoInstant(item.dueAt)}</span>}
        {item.remindAt && <span className="flex items-center gap-1"><Bell className="size-3.5" />{item.reminderStatus === "sent" ? "已提醒" : item.reminderStatus === "cancelled" ? "提醒已取消" : item.reminderStatus === "expired" ? "提醒已过期" : `提醒 ${formatTodoInstant(item.remindAt)}`}</span>}
      </span>}
    </button>
    <TodoImageStrip images={(item.imageIds ?? []).map(id => ({ id }))} todoId={item.id} limit={3} />
    </div>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" className="min-w-14 shrink-0 text-xs text-muted-foreground" data-track="todos.row-priority"
          aria-label={`${item.title}的优先级：${priorityLabels[priority]}`} disabled={disabled}>
          {item.priority ? <TodoPriorityBadge priority={item.priority} /> : priorityLabels.none}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label="设置优先级">
        <DropdownMenuRadioGroup value={priority}>
          {(["none", ...TODO_PRIORITIES] as const).map((value) =>
            <DropdownMenuRadioItem key={value} value={value} data-track="todos.set-priority"
              onSelect={() => onPriority(value === "none" ? null : value)}>
              {priorityLabels[value]}
            </DropdownMenuRadioItem>,
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" data-track="todos.menu" aria-label={`${item.title}的操作`} disabled={disabled}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
      <DropdownMenuGroup>
        <DropdownMenuItem data-track="todos.edit" onSelect={onEdit}>编辑</DropdownMenuItem>
        <DropdownMenuItem data-track="todos.complete" onSelect={onComplete}>{item.completedAt ? "恢复" : "完成"}</DropdownMenuItem>
        <DropdownMenuItem data-track="todos.copy" onSelect={onCopy}>复制 ID</DropdownMenuItem>
        <DropdownMenuItem data-track="todos.delete" variant="destructive" onSelect={onDelete}>删除</DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent></DropdownMenu>
  </li>
}
