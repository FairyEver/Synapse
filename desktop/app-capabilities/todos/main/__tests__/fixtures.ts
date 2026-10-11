import type { TodoItemDto } from "@synapse/shared/todo-contracts"
export const todoFixture: TodoItemDto = {
  id: "todo-1", title: "事项", note: null, dueAt: null, reminder: "none", offsetMinutes: null, remindAt: null,
  reminderGeneration: 1, reminderStatus: "none", completedAt: null, version: 1,
  createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z",
}
