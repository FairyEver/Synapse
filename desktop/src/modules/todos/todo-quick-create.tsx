import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { Plus, StickyNote } from "lucide-react"
import type { TodoReminderKind, TodoReminderOffset } from "@synapse/shared/todo-contracts"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { TodoPrioritySelect } from "./todo-priority"
import { TodoReminderSelect } from "./todo-reminder-select"
import { TodoDuePicker } from "./todo-due-picker"
import type { TodoListView } from "./todo-state"
import { useTodoEditor } from "./use-todo-editor"
import { handleTodoImagePaste, TodoImagePicker } from "./todo-image-picker"
import { TodoImageStrip } from "./todo-image-strip"

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
  const noteId = `${prefix}-note`

  useEffect(() => {
    if (!focusTitle || saving) return
    title.current?.focus()
    setFocusTitle(false)
  }, [focusTitle, saving])

  if (!draft) return null
  const changeReminder = (reminder: TodoReminderKind, offsetMinutes: TodoReminderOffset | null) => {
    editor.changeReminder(reminder, offsetMinutes)
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
  return <Card asChild size="sm" className="gap-2 px-3">
    <form aria-label="快速新建待办" data-track="todos.quick-create" onSubmit={(event) => void submit(event)}>
      <div className="flex items-center gap-2">
        <Input ref={title} aria-label="待办标题" data-track="todos.quick-title" placeholder="输入待办标题"
          value={draft.title} disabled={saving} onChange={(event) => change("title", event.target.value)}
          onPaste={event => handleTodoImagePaste(event, editor.addImages)} />
        <Button type="submit" data-track="todos.quick-submit" disabled={!online || saving || !draft.title.trim()}>
          <Plus data-icon="inline-start" />{saving ? "保存中" : "保存"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="待办选项">
        <TodoPrioritySelect value={draft.priority} disabled={saving} onChange={(value) => change("priority", value)} />
        <TodoDuePicker open={showDue} value={draft.due} disabled={saving}
          onOpenChange={setShowDue} onChange={(due) => change("due", due)} />
        <TodoReminderSelect reminder={draft.reminder} offsetMinutes={draft.offsetMinutes} disabled={saving} onChange={changeReminder} />
        <Button type="button" variant={showNote || draft.note ? "secondary" : "ghost"} data-track="todos.quick-note"
          aria-expanded={showNote} aria-controls={showNote ? noteId : undefined} disabled={saving} onClick={() => setShowNote((open) => !open)}>
          <StickyNote data-icon="inline-start" />备注
        </Button>
        <TodoImagePicker label="图片" disabled={saving} onSelect={editor.addImages} />
      </div>
      {showNote && <div className="space-y-2">
        <Label htmlFor={noteId}>备注</Label>
        <Textarea id={noteId} rows={2} data-track="todos.note" disabled={saving} value={draft.note}
          onChange={(event) => change("note", event.target.value)} onPaste={event => handleTodoImagePaste(event, editor.addImages)} />
      </div>}
      <TodoImageStrip images={draft.images} disabled={saving} onRemove={editor.removeImage} />
      {editor.error && <p role="alert" className="text-sm text-destructive">{editor.error}</p>}
    </form>
  </Card>
}
