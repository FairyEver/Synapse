import { TODO_PRIORITIES, type TodoPriority } from "@synapse/shared/todo-contracts"
import { Badge } from "@/components/ui/badge"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

export const priorityLabels = { high: "高", medium: "中", low: "低", none: "未设置" } as const
const priorityBadgeColors: Record<TodoPriority, string> = {
  high: "bg-red-700 text-white",
  medium: "bg-purple-700 text-white",
  low: "bg-blue-700 text-white",
}

export function TodoPriorityBadge({ priority }: { priority: TodoPriority }) {
  return <Badge className={priorityBadgeColors[priority]}>{priorityLabels[priority]}</Badge>
}

export function TodoPrioritySelect({ id, value, disabled, onChange }: {
  id?: string; value: TodoPriority | null; disabled: boolean; onChange: (priority: TodoPriority | null) => void
}) {
  return <NativeSelect id={id} aria-label="优先级" className={id ? "w-full" : undefined} data-track="todos.priority" disabled={disabled} value={value ?? "none"}
    onChange={(event) => onChange(event.target.value === "none" ? null : event.target.value as TodoPriority)}>
    <NativeSelectOption value="none">{id ? "未设置" : "优先级未设置"}</NativeSelectOption>
    {TODO_PRIORITIES.map((priority) => <NativeSelectOption key={priority} value={priority}>{priorityLabels[priority]}优先级</NativeSelectOption>)}
  </NativeSelect>
}
