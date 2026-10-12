import { describe, expect, it, vi } from "vitest"
import { TodoReminderWorker } from "./todo-reminder.worker"

const now = new Date("2099-06-02T09:00:00Z")
const row = { id: "t", userId: "u", title: "标题", note: "不进入通知", reminderGeneration: 2, remindAt: new Date("2099-06-02T08:59:00Z"), reminderStatus: "pending", completedAt: null, deletedAt: null, version: 3 }
function harness(current = row) {
  const tx = { todoItem: { update: vi.fn(async ({ data }: { data: object }) => ({ ...current, ...data, version: current.version + 1 })) }, todoReminderDelivery: { create: vi.fn(async () => ({})) } }
  const prisma = { todoItem: { findMany: vi.fn(async () => [row]) } }
  const repository = { transaction: async (work: (tx: unknown) => unknown) => work(tx), lock: vi.fn(async () => current) }
  const notifications = { createInTransaction: vi.fn(async () => ({ id: "n" })) }
  const events = { publish: vi.fn() }
  const worker = new TodoReminderWorker(prisma as never, repository as never, notifications as never, events as never)
  return { worker, tx, notifications, events }
}
describe("TodoReminderWorker", () => {
  it("does not trigger a cancelled or stale generation", async () => {
    for (const current of [{ ...row, completedAt: now }, { ...row, reminderGeneration: 3 }, { ...row, reminderStatus: "cancelled" }]) {
      const { worker, notifications, events } = harness(current as typeof row)
      await worker.scanDue(now)
      expect(notifications.createInTransaction).not.toHaveBeenCalled()
      expect(events.publish).not.toHaveBeenCalled()
    }
  })
  it("keeps network and events outside a transaction that rolls back", async () => {
    const { worker, tx, events } = harness()
    tx.todoReminderDelivery.create.mockRejectedValueOnce(new Error("rollback"))
    await expect(worker.scanDue(now)).rejects.toThrow("rollback")
    expect(events.publish).not.toHaveBeenCalled()
  })
  it("commits title-only notification and publishes only id/version", async () => {
    const { worker, notifications, events } = harness()
    await worker.scanDue(now)
    expect(notifications.createInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: "u", source: "todo-reminder", sourceKey: "todo:t:2", title: "待办提醒", body: "标题", targetId: "t", level: "active" }))
    expect(events.publish).toHaveBeenCalledWith("u", { id: "t", version: 4 })
  })
})
