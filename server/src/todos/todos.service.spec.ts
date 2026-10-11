import { describe, expect, it } from "vitest"
import { nextTodoReminderState } from "./todo-state"
import { normalizeTodoFields } from "./todo.schemas"

const now = new Date("2026-10-11T00:00:00Z")
const fields = normalizeTodoFields({ title: "事项", dueAt: "2026-10-12T01:00:00Z", reminder: "at_due" }, null, now)
const current = { ...fields, reminderGeneration: 1, reminderStatus: "pending" as const }
describe("todo reminder lifecycle during mutations", () => {
  it("does not advance a reminder generation for title or note updates", () => {
    const edited = normalizeTodoFields({ title: "新标题", note: "备注" }, current, now)
    expect(nextTodoReminderState(edited, current, null, now)).toEqual({ reminderGeneration: 1, reminderStatus: "pending" })
  })
  it("increments the generation when relative due time changes", () => {
    const edited = normalizeTodoFields({ dueAt: "2026-10-13T01:00:00Z" }, current, now)
    expect(nextTodoReminderState(edited, current, null, now)).toEqual({ reminderGeneration: 2, reminderStatus: "pending" })
  })
  it("does not advance custom reminders when only the due time changes", () => {
    const custom = { ...current, reminder: "custom" as const }
    const edited = normalizeTodoFields({ dueAt: "2026-10-13T01:00:00Z" }, custom, now)
    expect(nextTodoReminderState(edited, custom, null, now).reminderGeneration).toBe(1)
  })
  it("cancels pending reminders on completion and re-enables only future unsent reminders", () => {
    expect(nextTodoReminderState(current, current, now, now).reminderStatus).toBe("cancelled")
    expect(nextTodoReminderState(current, { ...current, reminderStatus: "cancelled" }, null, now).reminderStatus).toBe("pending")
    expect(nextTodoReminderState(current, { ...current, reminderStatus: "sent" }, null, now).reminderStatus).toBe("sent")
    expect(nextTodoReminderState(current, { ...current, reminderStatus: "cancelled" }, null, new Date("2026-10-13T00:00:00Z")).reminderStatus).toBe("expired")
  })
})
