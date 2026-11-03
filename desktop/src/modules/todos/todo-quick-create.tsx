import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { Calendar, Plus, StickyNote } from "lucide-react"
import type { TodoReminderKind } from "@synapse/shared/todo-contracts"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { TodoPrioritySelect } from "./todo-priority"
import { TodoReminderFields, TodoReminderSelect } from "./todo-reminder-fields"
import type { TodoListView } from "./todo-state"
import { useTodoEditor } from "./use-todo-editor"

export function TodoQuickCreate({ generation, online, priorityFilter, onSaved }: {
  generation: number; online: boolean; priorityFilter: TodoListView["priority"]; onSaved: () => Promise<void>
}) {
  const editor = useTodoEditor({ generation, online, onSaved, quickCreate: true })
  const { draft, saving, change } = editor
  const [showDue, setShowDue] = useState(false)
  const [showNote, setShowNote] = useState(false)
  const [focusTitle, setFocusTitle] = useState(false)
  const title = useRef<HTMLInputElement>(null)
  const latestFilter = useRef(priorityFilter)
  latestFilter.current = priorityFilter
  const prefix = useId()
  const dueId = `${prefix}-due`
  const noteId = `${prefix}-note`

  useEffect(() => {
    if (!focusTitle || saving) return
    title.current?.focus()
    setFocusTitle(false)
  }, [focusTitle, saving])

  if (!draft) return null
  const changeReminder = (reminder: TodoReminderKind) => {
    change("reminder", reminder)
    if ((reminder === "at_due" || reminder === "before_due") && !draft.due) setShowDue(true)
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!online || saving || !draft.title.trim()) return
    const created = await editor.save()
    if (!created) return
    setShowDue(false); setShowNote(false); setFocusTitle(true)
    const filter = latestFilter.current
    toast.success(filter !== "all" && filter !== (created.priority ?? "none")
      ? "已添加待办，当前筛选未显示" : "已添加待办")
  }
  const hasReminderTime = draft.reminder === "before_due" || draft.reminder === "custom"

  return <Card asChild size="sm" className="gap-2 px-3">
    <form aria-label="快速新建待办" data-track="todos.quick-create" onSubmit={(event) => void submit(event)}>
      <div className="flex items-center gap-2">
        <Input ref={title} aria-label="待办标题" data-track="todos.quick-title" placeholder="输入待办标题"
          value={draft.title} disabled={saving} onChange={(event) => change("title", event.target.value)} />
        <Button type="submit" data-track="todos.quick-submit" disabled={!online || saving || !draft.title.trim()}>
          <Plus data-icon="inline-start" />{saving ? "添加中" : "添加待办"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="待办选项">
        <TodoPrioritySelect value={draft.priority} disabled={saving} onChange={(value) => change("priority", value)} />
        <Button type="button" variant={showDue || draft.due ? "secondary" : "ghost"} data-track="todos.quick-due"
          aria-expanded={showDue} aria-controls={showDue ? dueId : undefined} disabled={saving} onClick={() => setShowDue((open) => !open)}>
          <Calendar data-icon="inline-start" />{draft.due ? `截止 ${draft.due.slice(5).replace("T", " ")}` : "截止时间"}
        </Button>
        <TodoReminderSelect value={draft.reminder} disabled={saving} onChange={changeReminder} />
        <Button type="button" variant={showNote || draft.note ? "secondary" : "ghost"} data-track="todos.quick-note"
          aria-expanded={showNote} aria-controls={showNote ? noteId : undefined} disabled={saving} onClick={() => setShowNote((open) => !open)}>
          <StickyNote data-icon="inline-start" />备注
        </Button>
      </div>
      {(showDue || hasReminderTime) && <div className="grid gap-3 sm:grid-cols-2">
        {showDue && <div className="min-w-0 space-y-2">
          <Label htmlFor={dueId}>截止时间</Label>
          <Input id={dueId} type="datetime-local" data-track="todos.due" disabled={saving} value={draft.due}
            onChange={(event) => change("due", event.target.value)} />
        </div>}
        <TodoReminderFields prefix={prefix} draft={draft} disabled={saving} change={change} />
      </div>}
      {showNote && <div className="space-y-2">
        <Label htmlFor={noteId}>备注</Label>
        <Textarea id={noteId} rows={2} data-track="todos.note" disabled={saving} value={draft.note}
          onChange={(event) => change("note", event.target.value)} />
      </div>}
      {editor.error && <p role="alert" className="text-sm text-destructive">{editor.error}</p>}
    </form>
  </Card>
}
