import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { TodoPrioritySelect } from "./todo-priority"
import { TodoReminderFields, TodoReminderSelect } from "./todo-reminder-fields"
import type { useTodoEditor } from "./use-todo-editor"

export function TodoEditor({ editor, online }: { editor: ReturnType<typeof useTodoEditor>; online: boolean }) {
  const draft = editor.draft
  return <Dialog open={!!draft} onOpenChange={(open) => { if (!open) editor.close() }} data-track="todos.editor">
    {draft && <DialogContent className="sm:max-w-lg" aria-describedby={undefined} showCloseButton={!editor.saving}>
      <DialogHeader><DialogTitle>编辑待办</DialogTitle></DialogHeader>
      <form id="todo-form" data-track="todos.form" className="space-y-4 py-2" onSubmit={(event) => { event.preventDefault(); void editor.save() }}>
        <div className="space-y-2"><Label htmlFor="todo-title">标题</Label><Input id="todo-title" data-track="todos.title" value={draft.title} disabled={editor.saving} onChange={(event) => editor.change("title", event.target.value)} autoFocus /></div>
        <div className="space-y-2"><Label htmlFor="todo-priority">优先级</Label><TodoPrioritySelect id="todo-priority" value={draft.priority} disabled={editor.saving} onChange={(value) => editor.change("priority", value)} /></div>
        <div className="space-y-2"><Label htmlFor="todo-note">备注</Label><Textarea id="todo-note" data-track="todos.note" value={draft.note} disabled={editor.saving} onChange={(event) => editor.change("note", event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="todo-due">截止时间</Label><Input id="todo-due" type="datetime-local" data-track="todos.due" value={draft.due} disabled={editor.saving} onChange={(event) => editor.change("due", event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="todo-reminder">提醒</Label><TodoReminderSelect id="todo-reminder" value={draft.reminder} disabled={editor.saving} onChange={(value) => editor.change("reminder", value)} /></div>
        <TodoReminderFields prefix="todo" draft={draft} disabled={editor.saving} change={editor.change} />
        {editor.error && <p role="alert" className="text-sm text-destructive">{editor.error}</p>}
        {editor.conflict && <Button type="button" variant="outline" disabled={editor.saving} onClick={() => void editor.reload()}>重新载入</Button>}
      </form>
      <DialogFooter><Button type="button" variant="outline" onClick={editor.close} disabled={editor.saving}>取消</Button><Button type="submit" form="todo-form" disabled={editor.saving || !online}>{editor.saving ? "保存中" : "保存"}</Button></DialogFooter>
    </DialogContent>}
  </Dialog>
}
