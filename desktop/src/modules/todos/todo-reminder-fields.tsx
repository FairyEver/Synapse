import type { TodoReminderKind } from "@synapse/shared/todo-contracts"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import type { TodoEditorDraft, useTodoEditor } from "./use-todo-editor"

export function TodoReminderSelect({ id, value, disabled, onChange }: {
  id?: string; value: TodoReminderKind; disabled: boolean; onChange: (reminder: TodoReminderKind) => void
}) {
  return <NativeSelect id={id} aria-label="提醒" className={id ? "w-full" : undefined} data-track="todos.reminder"
    disabled={disabled} value={value} onChange={(event) => onChange(event.target.value as TodoReminderKind)}>
    <NativeSelectOption value="none">不提醒</NativeSelectOption>
    <NativeSelectOption value="at_due">截止时提醒</NativeSelectOption>
    <NativeSelectOption value="before_due">提前提醒</NativeSelectOption>
    <NativeSelectOption value="custom">自定义时间</NativeSelectOption>
  </NativeSelect>
}

export function TodoReminderFields({ prefix, draft, disabled, change }: {
  prefix: string; draft: TodoEditorDraft; disabled: boolean; change: ReturnType<typeof useTodoEditor>["change"]
}) {
  if (draft.reminder === "before_due") {
    const id = `${prefix}-offset`
    return <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>提前</Label>
      <NativeSelect id={id} className="w-full" data-track="todos.offset" disabled={disabled} value={draft.offsetMinutes}
        onChange={(event) => change("offsetMinutes", Number(event.target.value) as TodoEditorDraft["offsetMinutes"])}>
        <NativeSelectOption value={10}>10 分钟</NativeSelectOption>
        <NativeSelectOption value={60}>1 小时</NativeSelectOption>
        <NativeSelectOption value={1440}>1 天</NativeSelectOption>
      </NativeSelect>
    </div>
  }
  if (draft.reminder === "custom") {
    const id = `${prefix}-custom`
    return <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>提醒时间</Label>
      <Input id={id} type="datetime-local" data-track="todos.custom" disabled={disabled} value={draft.custom}
        onChange={(event) => change("custom", event.target.value)} />
    </div>
  }
  return null
}
