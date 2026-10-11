import type { TodoReminderStatus } from "@synapse/shared/todo-contracts"
import type { NormalizedTodoFields } from "./todo.schemas"
type ReminderState = { reminderGeneration: number; reminderStatus: TodoReminderStatus }
export function nextTodoReminderState(fields: NormalizedTodoFields, current: (NormalizedTodoFields & ReminderState) | null, completedAt: Date | null, now: Date): ReminderState {
  const changed = !current || fields.reminder !== current.reminder || fields.offsetMinutes !== current.offsetMinutes || fields.remindAt?.getTime() !== current.remindAt?.getTime()
  const reminderGeneration = current ? current.reminderGeneration + Number(changed) : 1
  if (!fields.remindAt) return { reminderGeneration, reminderStatus: "none" }
  if (!changed && (current?.reminderStatus === "sent" || current?.reminderStatus === "expired")) return { reminderGeneration, reminderStatus: current.reminderStatus }
  return { reminderGeneration, reminderStatus: completedAt ? "cancelled" : fields.remindAt > now ? "pending" : "expired" }
}
