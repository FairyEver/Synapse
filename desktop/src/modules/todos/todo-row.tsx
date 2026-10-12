import { Calendar, Bell, MoreHorizontal } from "lucide-react"
import type { MouseEvent } from "react"
import type { TodoItemDto } from "@synapse/shared/todo-contracts"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { formatTodoInstant } from "./todo-time"

export function TodoRow({ item, disabled, onOpen, onComplete, onDelete, onCopy }: { item: TodoItemDto; disabled: boolean; onOpen: () => void; onComplete: () => void; onDelete: () => void; onCopy: () => void }) {
  const overdue = !item.completedAt && !!item.dueAt && new Date(item.dueAt).getTime() < Date.now()
  const handleOpen = (event: MouseEvent<HTMLButtonElement>) => {
    const selection = event.currentTarget.ownerDocument.getSelection()
    if (event.detail > 0 && selection && !selection.isCollapsed && selection.rangeCount > 0
      && selection.getRangeAt(0).intersectsNode(event.currentTarget)) return
    onOpen()
  }
  return <li className="flex items-center gap-4 px-5 py-4">
    <Checkbox checked={!!item.completedAt} disabled={disabled} data-track="todos.complete" aria-label={`${item.completedAt ? "恢复" : "完成"} ${item.title}`} onCheckedChange={onComplete} />
    <button type="button" data-track="todos.open" data-allow-select="true" className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-ring" onClick={handleOpen}>
      <span className={`block break-words text-sm font-medium ${item.completedAt ? "text-muted-foreground line-through" : ""}`}>{item.title}</span>
      {item.note && <span className="mt-1 block truncate text-sm text-muted-foreground">{item.note}</span>}
      {(item.dueAt || item.remindAt) && <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {item.dueAt && <span className={`flex items-center gap-1 ${overdue ? "text-destructive" : ""}`}><Calendar className="size-3.5" />{overdue ? "已逾期 · " : "截止 "}{formatTodoInstant(item.dueAt)}</span>}
        {item.remindAt && <span className="flex items-center gap-1"><Bell className="size-3.5" />{item.reminderStatus === "sent" ? "已提醒" : item.reminderStatus === "cancelled" ? "提醒已取消" : item.reminderStatus === "expired" ? "提醒已过期" : `提醒 ${formatTodoInstant(item.remindAt)}`}</span>}
      </span>}
    </button>
    <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" data-track="todos.menu" aria-label={`${item.title}的操作`} disabled={disabled}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
      <DropdownMenuGroup>
        <DropdownMenuItem data-track="todos.edit" onSelect={onOpen}>编辑</DropdownMenuItem>
        <DropdownMenuItem data-track="todos.complete" onSelect={onComplete}>{item.completedAt ? "恢复" : "完成"}</DropdownMenuItem>
        <DropdownMenuItem data-track="todos.copy" onSelect={onCopy}>复制 ID</DropdownMenuItem>
        <DropdownMenuItem data-track="todos.delete" variant="destructive" onSelect={onDelete}>删除</DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent></DropdownMenu>
  </li>
}
