import type { TodoFilter, TodoItemDto } from "@synapse/shared/todo-contracts"

export function mergeTodoItems(current: TodoItemDto[], incoming: TodoItemDto[], filter: TodoFilter, replace = false): TodoItemDto[] {
  const existing = new Map(current.map((item) => [item.id, item]))
  const result = new Map<string, TodoItemDto>(replace ? [] : existing)
  for (const item of incoming) {
    const previous = result.get(item.id) ?? existing.get(item.id)
    result.set(item.id, previous && previous.version > item.version ? previous : item)
  }
  return [...result.values()].filter((item) => filter === "all" || !item.completedAt).sort((a, b) => {
    if (!!a.completedAt !== !!b.completedAt) return a.completedAt ? 1 : -1
    if (a.completedAt && b.completedAt) return b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id)
    return (a.dueAt === null ? b.dueAt === null ? 0 : 1 : b.dueAt === null ? -1 : a.dueAt.localeCompare(b.dueAt)) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  })
}
export function todoErrorMessage(error: unknown): string { return error instanceof Error ? error.message : "操作失败，请重试" }
