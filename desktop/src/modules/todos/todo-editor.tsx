import type { TodoReminderKind } from "@synapse/shared/todo-contracts"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import type { useTodoEditor } from "./use-todo-editor"

export function TodoEditor({ editor, online }: { editor: ReturnType<typeof useTodoEditor>; online: boolean }) {
  const draft = editor.draft
  return <Dialog open={!!draft} onOpenChange={(open) => { if (!open) editor.close() }} data-track="todos.editor">
    {draft && <DialogContent className="sm:max-w-lg" aria-describedby={undefined} showCloseButton={!editor.saving}>
      <DialogHeader><DialogTitle>{draft.id ? "编辑待办" : "新建待办"}</DialogTitle></DialogHeader>
      <form id="todo-form" data-track="todos.form" className="space-y-4 py-2" onSubmit={(event) => { event.preventDefault(); void editor.save() }}>
        <div className="space-y-2"><Label htmlFor="todo-title">标题</Label><Input id="todo-title" data-track="todos.title" value={draft.title} disabled={editor.saving} onChange={(event) => editor.change("title", event.target.value)} autoFocus /></div>
        <div className="space-y-2"><Label htmlFor="todo-note">备注</Label><Textarea id="todo-note" data-track="todos.note" value={draft.note} disabled={editor.saving} onChange={(event) => editor.change("note", event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="todo-due">截止时间</Label><Input id="todo-due" type="datetime-local" data-track="todos.due" value={draft.due} disabled={editor.saving} onChange={(event) => editor.change("due", event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="todo-reminder">提醒</Label><NativeSelect id="todo-reminder" className="w-full" data-track="todos.reminder" value={draft.reminder} disabled={editor.saving} onChange={(event) => editor.change("reminder", event.target.value as TodoReminderKind)}>
          <NativeSelectOption value="none">不提醒</NativeSelectOption><NativeSelectOption value="at_due">截止时提醒</NativeSelectOption><NativeSelectOption value="before_due">提前提醒</NativeSelectOption><NativeSelectOption value="custom">自定义时间</NativeSelectOption>
        </NativeSelect></div>
        {draft.reminder === "before_due" && <div className="space-y-2"><Label htmlFor="todo-offset">提前</Label><NativeSelect id="todo-offset" className="w-full" data-track="todos.offset" value={draft.offsetMinutes} disabled={editor.saving} onChange={(event) => editor.change("offsetMinutes", Number(event.target.value) as 10 | 60 | 1440)}><NativeSelectOption value={10}>10 分钟</NativeSelectOption><NativeSelectOption value={60}>1 小时</NativeSelectOption><NativeSelectOption value={1440}>1 天</NativeSelectOption></NativeSelect></div>}
        {draft.reminder === "custom" && <div className="space-y-2"><Label htmlFor="todo-custom">提醒时间</Label><Input id="todo-custom" type="datetime-local" data-track="todos.custom" value={draft.custom} disabled={editor.saving} onChange={(event) => editor.change("custom", event.target.value)} /></div>}
        {editor.error && <p role="alert" className="text-sm text-destructive">{editor.error}</p>}
        {editor.conflict && <Button type="button" variant="outline" disabled={editor.saving} onClick={() => void editor.reload()}>重新载入</Button>}
      </form>
      <DialogFooter><Button type="button" variant="outline" onClick={editor.close} disabled={editor.saving}>取消</Button><Button type="submit" form="todo-form" disabled={editor.saving || !online}>{editor.saving ? "保存中" : "保存"}</Button></DialogFooter>
    </DialogContent>}
  </Dialog>
}
