import { useCallback, useEffect, useRef, useState } from "react"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import type { TodoItemDto } from "@synapse/shared/todo-contracts"
import { useAccount } from "@/app-shell/account"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import type { TodoOpenRequest } from "../apps/types"
import { useTodos } from "./use-todos"
import { useTodoEditor } from "./use-todo-editor"
import { useTodoTarget } from "./use-todo-target"
import { TodoList } from "./todo-list"
import { TodoEditor } from "./todo-editor"
import { todoErrorMessage } from "./todo-state"

const tabs = [{ id: "pending" as const, label: "未完成" }, { id: "all" as const, label: "全部" }]
export function TodosModule({ openRequest, onOpenRequestConsumed }: { openRequest?: TodoOpenRequest | null; onOpenRequestConsumed?: (requestId: string) => void } = {}) {
  const { startLogin } = useAccount()
  const todos = useTodos()
  const editor = useTodoEditor({ generation: todos.generation, online: todos.online, onSaved: todos.refresh })
  const [deleting, setDeleting] = useState<TodoItemDto | null>(null), [deleteBusy, setDeleteBusy] = useState(false)
  const deleteLock = useRef(false), currentGeneration = useRef(todos.generation), deletingGeneration = useRef(todos.generation)
  currentGeneration.current = todos.generation
  const selectAll = useCallback(() => todos.setFilter("all"), [todos.setFilter])
  const target = useTodoTarget({ request: openRequest, ready: todos.authenticated, generation: todos.generation, blocked: !!editor.draft || editor.saving, open: editor.open, selectAll, consumed: onOpenRequestConsumed })
  useEffect(() => { deleteLock.current = false; setDeleting(null); setDeleteBusy(false) }, [todos.generation])
  const create = () => { target.cancel(); editor.open() }
  const open = (item: TodoItemDto) => { target.cancel(); editor.open(item) }
  const complete = async (item: TodoItemDto) => { target.cancel(); try { await todos.setCompleted(item, !item.completedAt) } catch (cause) { toast.error(todoErrorMessage(cause)) } }
  const remove = async () => { if (!deleting || deleteLock.current) return; const identity = todos.generation; deleteLock.current = true; setDeleteBusy(true); try { await todos.remove(deleting); if (currentGeneration.current === identity) setDeleting(null) } catch (cause) { if (currentGeneration.current === identity) toast.error(todoErrorMessage(cause)) } finally { if (currentGeneration.current === identity) { deleteLock.current = false; setDeleteBusy(false) } } }
  const copy = async (item: TodoItemDto) => { try { await navigator.clipboard.writeText(`synapse://todos/${item.id}`); toast("ID 已复制") } catch { toast.error("复制失败") } }
  const undo = async () => { try { await todos.undoCompletion() } catch (cause) { toast.error(todoErrorMessage(cause)) } }
  return <SystemAppWindowShell tabs={tabs} value={todos.filter} onValueChange={(filter) => { target.cancel(); todos.setFilter(filter) }} actions={<Button type="button" data-track="todos.new" onClick={create} disabled={!todos.authenticated || !todos.online}><Plus />新建待办</Button>}>
    <ScrollArea className="h-full"><div className="mx-auto max-w-4xl space-y-4 p-6">
      {!todos.authenticated ? <div className="flex items-center gap-3 text-sm"><span>登录后查看待办事项</span><Button type="button" onClick={() => void startLogin()}>登录</Button></div> : <>
        {(todos.error || target.error || !todos.online) && <div role="alert" className="flex items-center justify-between gap-3 text-sm text-destructive"><span>{target.error ?? todos.error ?? "连接失败，请重试"}</span><Button type="button" variant="outline" onClick={() => void (target.error ? target.retry() : todos.refresh())} disabled={todos.loading}>重试</Button></div>}
        {todos.undo && <div role="status" className="flex items-center justify-between gap-3 text-sm"><span>已完成</span><Button type="button" variant="ghost" onClick={() => void undo()} disabled={!todos.online}>撤销</Button></div>}
        <TodoList emptyTitle={todos.filter === "all" ? "没有待办事项" : "没有未完成事项"} items={todos.items} loading={todos.loading} error={todos.error} more={todos.nextOffset !== null} disabled={!todos.online} writingIds={todos.writingIds} onNew={create} onOpen={open} onComplete={(item) => void complete(item)} onDelete={(item) => { target.cancel(); deletingGeneration.current = todos.generation; setDeleting(item) }} onCopy={(item) => void copy(item)} onMore={() => void todos.loadMore()} />
      </>}
    </div></ScrollArea>
    <TodoEditor editor={editor} online={todos.online} />
    <AlertDialog open={!!deleting && deletingGeneration.current === todos.generation} onOpenChange={(open) => { if (!open && !deleteBusy) setDeleting(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除待办？</AlertDialogTitle><AlertDialogDescription>{deleting?.title}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleteBusy}>取消</AlertDialogCancel><Button type="button" variant="destructive" onClick={() => void remove()} disabled={deleteBusy || !todos.online}>{deleteBusy ? "删除中" : "删除"}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </SystemAppWindowShell>
}
