import { TODO_PRIORITY_FILTERS, type TodoSort } from "@synapse/shared/todo-contracts"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { priorityLabels } from "./todo-priority"
import type { TodoListView } from "./todo-state"

export function TodoListControls({ priority, sort, onPriorityChange, onSortChange }: {
  priority: TodoListView["priority"]; sort: TodoSort
  onPriorityChange: (priority: TodoListView["priority"]) => void; onSortChange: (sort: TodoSort) => void
}) {
  return <div className="flex flex-wrap items-center gap-2">
    <ToggleGroup type="single" variant="outline" role="radiogroup" aria-label="筛选优先级" data-track="todos.priority-filter"
      value={priority} onValueChange={(value) => { if (value) onPriorityChange(value as TodoListView["priority"]) }}>
      <ToggleGroupItem value="all" aria-label="全部优先级">全部优先级</ToggleGroupItem>
      {TODO_PRIORITY_FILTERS.map((value) => <ToggleGroupItem key={value} value={value}
        aria-label={value === "none" ? "筛选未设置优先级" : `筛选${priorityLabels[value]}优先级`}>
        {priorityLabels[value]}
      </ToggleGroupItem>)}
    </ToggleGroup>
    <NativeSelect aria-label="排序方式" data-track="todos.sort" value={sort} onChange={(event) => onSortChange(event.target.value as TodoSort)}>
      <NativeSelectOption value="due">按截止时间</NativeSelectOption>
      <NativeSelectOption value="priority">按优先级</NativeSelectOption>
    </NativeSelect>
  </div>
}
