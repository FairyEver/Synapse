export const TODO_REMINDER_KINDS = ["none", "at_due", "before_due", "custom"] as const
export const TODO_REMINDER_STATUSES = ["none", "pending", "sent", "cancelled", "expired"] as const
export const TODO_REMINDER_OFFSETS = [10, 60, 1440] as const
export type TodoFilter = "pending" | "all"
export type TodoReminderKind = typeof TODO_REMINDER_KINDS[number]
export type TodoReminderStatus = typeof TODO_REMINDER_STATUSES[number]
export interface TodoFieldsInput {
  title: string
  note?: string | null
  dueAt?: string | null
  reminder?: TodoReminderKind
  offsetMinutes?: 10 | 60 | 1440 | null
  remindAt?: string | null
}
export type TodoCreateInput = TodoFieldsInput & { clientRequestId: string }
export type TodoUpdateInput = Partial<TodoFieldsInput> & { expectedVersion: number; clientRequestId: string }
export interface TodoCompletionInput { completed: boolean; expectedVersion: number; clientRequestId: string }
export interface TodoDeleteInput { expectedVersion: number; clientRequestId: string }
export interface TodoListInput { filter?: TodoFilter; query?: string; offset?: number; limit?: number }
export interface TodoItemDto {
  id: string
  title: string
  note: string | null
  dueAt: string | null
  reminder: TodoReminderKind
  offsetMinutes: 10 | 60 | 1440 | null
  remindAt: string | null
  reminderGeneration: number
  reminderStatus: TodoReminderStatus
  completedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}
export interface TodoPageDto { items: TodoItemDto[]; nextOffset: number | null }
export interface TodoDeleteResult { id: string; version: number; deleted: true }
export interface TodoChangedPayload { id: string; version: number }
export type TodoLocator = { id: string; reference?: never } | { reference: string; id?: never }

export function countTodoCodePoints(value: string): number { return Array.from(value).length }
export function isValidTodoText(value: string): boolean {
  for (const char of value) {
    const point = char.codePointAt(0)!
    if (point === 0 || (point >= 0xd800 && point <= 0xdfff)) return false
  }
  return true
}
/** RFC 3339 instant with minute precision; reject JS's rollover of invalid calendar dates. */
export function parseTodoInstant(value: string): Date | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00(?:\.0+)?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!parts) return null
  const [, year, month, day, hour, minute, offset] = parts
  const calendar = new Date(0)
  calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day))
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1 || calendar.getUTCDate() !== Number(day)
    || Number(hour) > 23 || Number(minute) > 59) return null
  if (offset !== "Z" && (Number(offset!.slice(1, 3)) > 23 || Number(offset!.slice(4, 6)) > 59)) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}
export function parseTodoReference(value: string): string | null {
  return /^synapse:\/\/todos\/([A-Za-z0-9_-]{1,200})$/.exec(value)?.[1] ?? null
}
