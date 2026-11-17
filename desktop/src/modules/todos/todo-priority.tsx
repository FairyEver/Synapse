import { TODO_PRIORITIES, type TodoPriority } from "@synapse/shared/todo-contracts"
import { Badge } from "@/components/ui/badge"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

export const priorityLabels = { p0: "P0", p1: "P1", p2: "P2", p3: "P3", none: "未设置" } as const
const priorityBadgeVariants: Record<TodoPriority, "default" | "secondary" | "destructive" | "outline"> = {
  p0: "destructive",
  p1: "default",
  p2: "secondary",
  p3: "outline",
}

export function TodoPriorityBadge({ priority }: { priority: TodoPriority }) {
  return <Badge variant={priorityBadgeVariants[priority]}>{priorityLabels[priority]}</Badge>
}

export function TodoPrioritySelect({ id, value, disabled, onChange }: {
  id?: string; value: TodoPriority | null; disabled: boolean; onChange: (priority: TodoPriority | null) => void
}) {
  return <NativeSelect id={id} aria-label="优先级" className={id ? "w-full" : undefined} data-track="todos.priority" disabled={disabled} value={value ?? "none"}
    onChange={(event) => onChange(event.target.value === "none" ? null : event.target.value as TodoPriority)}>
    <NativeSelectOption value="none">{id ? "未设置" : "优先级未设置"}</NativeSelectOption>
    {TODO_PRIORITIES.map((priority) => <NativeSelectOption key={priority} value={priority}>{priorityLabels[priority]}</NativeSelectOption>)}
  </NativeSelect>
}
