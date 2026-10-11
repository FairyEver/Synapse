import type { TodoItemDto } from "@synapse/shared/todo-contracts"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { TodoRow } from "./todo-row"

export function TodoList({ items, loading, error, emptyTitle, more, disabled, writingIds, onNew, onOpen, onComplete, onDelete, onCopy, onMore }: { items: TodoItemDto[]; loading: boolean; error: string | null; emptyTitle: string; more: boolean; disabled: boolean; writingIds: Set<string>; onNew: () => void; onOpen: (item: TodoItemDto) => void; onComplete: (item: TodoItemDto) => void; onDelete: (item: TodoItemDto) => void; onCopy: (item: TodoItemDto) => void; onMore: () => void }) {
  return <Card className="gap-0 py-0" aria-label="待办列表">
    {loading && !items.length ? <div role="status" aria-label="加载待办中" className="space-y-4 p-5"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
      : !items.length ? <Empty><EmptyHeader><EmptyTitle>{error ? "待办加载失败" : emptyTitle}</EmptyTitle></EmptyHeader>{!error && <EmptyContent><Button type="button" variant="outline" onClick={onNew} disabled={disabled}>新建待办</Button></EmptyContent>}</Empty>
      : <ul className="divide-y">{items.map((item) => <TodoRow key={item.id} item={item} disabled={disabled || writingIds.has(item.id)} onOpen={() => onOpen(item)} onComplete={() => onComplete(item)} onDelete={() => onDelete(item)} onCopy={() => onCopy(item)} />)}</ul>}
    {more && <Button type="button" variant="ghost" className="w-full rounded-none" disabled={loading} onClick={onMore}>加载更多</Button>}
  </Card>
}
