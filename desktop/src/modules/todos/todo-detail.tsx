import { Pencil, X } from "lucide-react"
import type { TodoItemDto } from "@synapse/shared/todo-contracts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TodoPriorityBadge } from "./todo-priority"
import { TodoImageStrip } from "./todo-image-strip"

const dateTime = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
const formatTime = (value: string) => dateTime.format(new Date(value))
const reminderLabels = { none: "不提醒", pending: "待提醒", sent: "已提醒", cancelled: "已取消", expired: "已过期" }

export function TodoDetail({ item, disabled, onClose, onEdit }: { item: TodoItemDto | null; disabled: boolean; onClose: () => void; onEdit: (item: TodoItemDto) => void }) {
  const overdue = !!item?.dueAt && !item.completedAt && new Date(item.dueAt).getTime() < Date.now()
  return <Sheet open={!!item} onOpenChange={(open) => { if (!open) onClose() }} data-track="todos.detail">
    {item && <SheetContent side="right" showCloseButton={false} aria-describedby={undefined} className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl motion-reduce:animate-none motion-reduce:transition-none">
      <SheetHeader className="flex-row items-center justify-between border-b px-6 py-4">
        <SheetTitle>待办详情</SheetTitle>
        <SheetClose asChild><Button type="button" variant="ghost" size="icon" aria-label="关闭详情"><X /></Button></SheetClose>
      </SheetHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 p-6" data-allow-select="true">
          <div className="space-y-3">
            <Badge variant="secondary">{item.completedAt ? "已完成" : overdue ? "已逾期" : "未完成"}</Badge>
            <h2 className="text-xl leading-relaxed font-semibold wrap-anywhere">{item.title}</h2>
          </div>
          {item.note && <section className="space-y-2" aria-label="备注">
            <h3 className="text-sm font-medium text-muted-foreground">备注</h3>
            <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-7">{item.note}</p>
          </section>}
          {!!item.imageIds?.length && <section className="space-y-2" aria-label="图片">
            <h3 className="text-sm font-medium">图片</h3>
            <TodoImageStrip images={item.imageIds.map(id => ({ id }))} todoId={item.id} />
          </section>}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-4 border-t pt-6 text-sm">
            <dt className="text-muted-foreground">优先级</dt><dd>{item.priority ? <TodoPriorityBadge priority={item.priority} /> : "未设置"}</dd>
            <dt className="text-muted-foreground">截止时间</dt><dd className={overdue ? "text-destructive" : undefined}>{item.dueAt ? formatTime(item.dueAt) : "未设置"}</dd>
            <dt className="text-muted-foreground">提醒时间</dt><dd>{item.remindAt ? <><span>{formatTime(item.remindAt)}</span><span className="mt-1 block text-xs text-muted-foreground">{reminderLabels[item.reminderStatus]}</span></> : "不提醒"}</dd>
            {item.completedAt && <><dt className="text-muted-foreground">完成时间</dt><dd>{formatTime(item.completedAt)}</dd></>}
            <dt className="text-muted-foreground">创建时间</dt><dd>{formatTime(item.createdAt)}</dd>
            <dt className="text-muted-foreground">更新时间</dt><dd>{formatTime(item.updatedAt)}</dd>
          </dl>
        </div>
      </ScrollArea>
      <SheetFooter className="border-t p-4"><Button type="button" variant="outline" data-track="todos.detail.edit" disabled={disabled} onClick={() => onEdit(item)}><Pencil data-icon="inline-start" />编辑</Button></SheetFooter>
    </SheetContent>}
  </Sheet>
}
