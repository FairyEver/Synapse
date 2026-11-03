import { TODO_PRIORITIES, type TodoFilter, type TodoItemDto, type TodoPriorityFilter, type TodoSort } from "@synapse/shared/todo-contracts"

export interface TodoListView { filter: TodoFilter; priority: TodoPriorityFilter | "all"; sort: TodoSort }
export const defaultTodoListView: TodoListView = { filter: "pending", priority: "all", sort: "due" }

function priorityRank(item: TodoItemDto): number {
  return item.priority == null ? TODO_PRIORITIES.length : TODO_PRIORITIES.indexOf(item.priority)
}

export function mergeTodoItems(current: TodoItemDto[], incoming: TodoItemDto[], view: TodoListView, replace = false): TodoItemDto[] {
  const existing = new Map(current.map((item) => [item.id, item]))
  const result = new Map<string, TodoItemDto>(replace ? [] : existing)
  for (const item of incoming) {
    const previous = result.get(item.id) ?? existing.get(item.id)
    result.set(item.id, previous && previous.version > item.version ? previous : item)
  }
  return [...result.values()].filter((item) =>
    (view.filter === "all" || !item.completedAt) && (view.priority === "all" || (item.priority ?? "none") === view.priority),
  ).sort((a, b) => {
    if (!!a.completedAt !== !!b.completedAt) return a.completedAt ? 1 : -1
    if (a.completedAt && b.completedAt) return b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id)
    return (view.sort === "priority" ? priorityRank(a) - priorityRank(b) : 0)
      || (a.dueAt === null ? b.dueAt === null ? 0 : 1 : b.dueAt === null ? -1 : a.dueAt.localeCompare(b.dueAt))
      || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  })
}
export function todoErrorMessage(error: unknown): string { return error instanceof Error ? error.message : "操作失败，请重试" }
