import "reflect-metadata"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NotificationService } from "../src/notifications/notification.service"
import { TodoRepository } from "../src/todos/todo.repository"
import { TodosService } from "../src/todos/todos.service"
import { TodoReminderWorker } from "../src/todos/todo-reminder.worker"
import { TodoReminderOutbox } from "../src/todos/todo-reminder-outbox"

const now = new Date("2099-06-02T09:00:00Z")
const instant = "2099-06-02T08:00:00Z"
function latch() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
describe("todo reminder real transaction races", () => {
  let prisma: PrismaClient
  let repository: TodoRepository
  let service: TodosService
  let notifications: NotificationService
  let worker: TodoReminderWorker
  let outbox: TodoReminderOutbox
  let owner: string
  const push = { sendNotification: vi.fn(async (_user: string, _record: { id: string }) => ({ sent: 0, failed: 0, skipped: false })) }
  const events = { publish: vi.fn() }
  beforeAll(async () => {
    if (!process.env.TODOS_E2E_DATABASE_URL) throw new Error("TODOS_E2E_DATABASE_URL is required")
    prisma = new PrismaClient({ datasources: { db: { url: process.env.TODOS_E2E_DATABASE_URL } } })
    const suffix = randomUUID()
    owner = (await prisma.user.create({ data: { email: suffix + "@todo-reminder.invalid", handle: suffix, nickname: "测试", passwordHash: "test-only" } })).id
    repository = new TodoRepository(prisma as never)
    service = new TodosService(repository, events as never)
    notifications = new NotificationService(prisma as never, { broadcastToUser: () => ({ failedClientCount: 0 }) } as never, { sendToMobileClients: () => undefined } as never, push as never, {} as never)
    worker = new TodoReminderWorker(prisma as never, repository, notifications, events as never)
    outbox = new TodoReminderOutbox(prisma as never, notifications)
  })
  beforeEach(async () => {
    vi.restoreAllMocks()
    push.sendNotification.mockClear()
    events.publish.mockClear()
    await prisma.todoItem.deleteMany({ where: { userId: owner } })
    await prisma.userNotification.deleteMany({ where: { userId: owner } })
  })
  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: owner } })
      await prisma.$disconnect()
    }
  })
  const create = (remindAt = instant) => service.create(owner, { title: "提醒标题", note: "私密备注", reminder: "custom", remindAt, clientRequestId: randomUUID() })
  it("editing a due reminder before the worker scans still delivers the updated title once", async () => {
    const item = await create()
    const afterDue = new Date("2099-06-02T08:00:05Z")
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(afterDue)
    try {
      const edited = await service.update(owner, item.id, { title: "刚修改的标题", note: "仍为私密备注", expectedVersion: 1, clientRequestId: randomUUID() })
      expect(edited.reminderStatus).toBe("pending")
      await worker.scanDue(afterDue)
      await worker.scanDue(afterDue)
      const records = await prisma.userNotification.findMany({ where: { userId: owner } })
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({ body: "刚修改的标题", sourceKey: "todo:" + item.id + ":1" })
      expect((await service.get(owner, item.id)).reminderStatus).toBe("sent")
    } finally { vi.useRealTimers() }
  })
  it("mutation replay and unchanged completion publish no new event", async () => {
    const input = { title: "去重", clientRequestId: randomUUID() }
    const item = await service.create(owner, input)
    events.publish.mockClear()
    await service.create(owner, input)
    await service.setCompleted(owner, item.id, { completed: false, expectedVersion: 1, clientRequestId: randomUUID() })
    expect(events.publish).not.toHaveBeenCalled()
  })
  for (const action of ["completion", "delete"] as const) {
    it(action + "_cancel_before_trigger creates no notification", async () => {
      const item = await create()
      const held = latch(), release = latch(), workerWaiting = latch()
      const lock = repository.lock.bind(repository)
      let calls = 0
      vi.spyOn(repository, "lock").mockImplementation(async (...args) => {
        const call = ++calls
        if (call === 2) workerWaiting.resolve()
        const row = await lock(...args)
        if (call === 1) { held.resolve(); await release.promise }
        return row
      })
      const cancel = action === "completion"
        ? service.setCompleted(owner, item.id, { completed: true, expectedVersion: 1, clientRequestId: randomUUID() })
        : service.delete(owner, item.id, { expectedVersion: 1, clientRequestId: randomUUID() })
      await held.promise
      const scan = worker.scanDue(now)
      await workerWaiting.promise
      release.resolve()
      await Promise.all([cancel, scan])
      expect(await prisma.userNotification.count({ where: { userId: owner } })).toBe(0)
    })
    it(action + "_trigger_before_cancel retains one historical notification", async () => {
      const item = await create()
      const held = latch(), release = latch(), cancelWaiting = latch()
      const insert = notifications.createInTransaction.bind(notifications)
      vi.spyOn(notifications, "createInTransaction").mockImplementation(async (...args) => {
        const record = await insert(...args)
        held.resolve()
        await release.promise
        return record
      })
      const lock = repository.lock.bind(repository)
      let calls = 0
      vi.spyOn(repository, "lock").mockImplementation(async (...args) => {
        if (++calls === 2) cancelWaiting.resolve()
        return lock(...args)
      })
      const scan = worker.scanDue(now)
      await held.promise
      const cancellation = action === "completion"
        ? service.setCompleted(owner, item.id, { completed: true, expectedVersion: 1, clientRequestId: randomUUID() })
        : service.delete(owner, item.id, { expectedVersion: 1, clientRequestId: randomUUID() })
      const rejected = expect(cancellation).rejects.toMatchObject({ status: 409 })
      await cancelWaiting.promise
      release.resolve()
      await scan
      await rejected
      if (action === "completion") await service.setCompleted(owner, item.id, { completed: true, expectedVersion: 2, clientRequestId: randomUUID() })
      else await service.delete(owner, item.id, { expectedVersion: 2, clientRequestId: randomUUID() })
      expect(await prisma.userNotification.count({ where: { userId: owner } })).toBe(1)
    })
  }
  it("two_workers_and_restart keep one source key and one outbox", async () => {
    const item = await create()
    await Promise.all([worker.scanDue(now), worker.scanDue(now)])
    await worker.scanDue(now)
    expect((await prisma.userNotification.findMany({ where: { userId: owner } })).map((record) => record.sourceKey)).toEqual(["todo:" + item.id + ":1"])
    expect(await prisma.todoReminderDelivery.count({ where: { userId: owner } })).toBe(1)
    expect((await service.get(owner, item.id)).version).toBe(2)
    expect(push.sendNotification).not.toHaveBeenCalled()
  })
  it("old_generation snapshots cannot trigger a newly changed reminder", async () => {
    const item = await create()
    const find = prisma.todoItem.findMany.bind(prisma.todoItem)
    const spy = vi.spyOn(prisma.todoItem, "findMany").mockImplementationOnce(async (args: never) => {
      const snapshot = await find(args)
      await service.update(owner, item.id, { remindAt: "2099-06-02T10:00:00Z", expectedVersion: 1, clientRequestId: randomUUID() })
      return snapshot
    })
    await worker.scanDue(now)
    spy.mockRestore()
    expect(await prisma.userNotification.count({ where: { userId: owner } })).toBe(0)
    await worker.scanDue(new Date("2099-06-02T10:00:00Z"))
    expect((await prisma.userNotification.findFirst({ where: { userId: owner } }))?.sourceKey).toBe("todo:" + item.id + ":2")
  })
  it("outage_window_boundary compensates 24h and expires older reminders", async () => {
    const boundary = await create("2099-06-01T09:00:00Z")
    const expired = await create("2099-06-01T08:59:00Z")
    await worker.scanDue(now)
    expect((await service.get(owner, boundary.id)).reminderStatus).toBe("sent")
    expect((await service.get(owner, expired.id)).reminderStatus).toBe("expired")
    expect(await prisma.userNotification.count({ where: { userId: owner } })).toBe(1)
  })
  it("transaction_has_no_network or event if outbox insert rolls back", async () => {
    await create()
    events.publish.mockClear()
    vi.spyOn(notifications, "createInTransaction").mockImplementationOnce(async (tx, input) => {
      await tx.userNotification.create({ data: { userId: input.userId, source: input.source, title: input.title, body: input.body, level: "active", sourceKey: input.sourceKey } })
      throw new Error("test rollback")
    })
    await expect(worker.scanDue(now)).rejects.toThrow("test rollback")
    expect(await prisma.userNotification.count({ where: { userId: owner } })).toBe(0)
    expect(push.sendNotification).not.toHaveBeenCalled()
    expect(events.publish).not.toHaveBeenCalled()
  })
  it("limits each scan to 100 reminders", async () => {
    await prisma.todoItem.createMany({ data: Array.from({ length: 101 }, () => ({ userId: owner, title: "批次测试", reminder: "custom" as const, reminderStatus: "pending" as const, remindAt: new Date(instant), createRequestId: randomUUID(), createRequestHash: "test-only" })) })
    await worker.scanDue(now)
    expect(await prisma.userNotification.count({ where: { userId: owner } })).toBe(100)
    expect(await prisma.todoItem.count({ where: { userId: owner, reminderStatus: "pending" } })).toBe(1)
  })
  it("delivery_retry_reuses_notification and reclaims a crashed lease", async () => {
    await create()
    await worker.scanDue(now)
    const delivery = (await prisma.todoReminderDelivery.findFirst({ where: { userId: owner } }))!
    push.sendNotification.mockResolvedValueOnce({ sent: 0, failed: 1, skipped: false })
    await outbox.deliverPending(now)
    expect((await prisma.todoReminderDelivery.findUnique({ where: { id: delivery.id } }))?.status).toBe("pending")
    await prisma.todoReminderDelivery.update({ where: { id: delivery.id }, data: { leaseUntil: new Date(now.getTime() - 1), leaseToken: "crashed", nextAttemptAt: now } })
    await outbox.deliverPending(new Date(now.getTime() + 60000))
    expect(push.sendNotification.mock.calls.map((call) => call[1].id)).toEqual([delivery.notificationId, delivery.notificationId])
    expect(await prisma.userNotification.count({ where: { userId: owner } })).toBe(1)
    expect((await prisma.todoReminderDelivery.findUnique({ where: { id: delivery.id } }))?.status).toBe("delivered")
  })
  for (const state of ["read", "deleted", "expired"] as const) {
    it(state + " prevents another external banner", async () => {
      await create()
      await worker.scanDue(now)
      const delivery = (await prisma.todoReminderDelivery.findFirst({ where: { userId: owner } }))!
      if (state !== "expired") await prisma.userNotification.update({ where: { id: delivery.notificationId }, data: state === "read" ? { readAt: now } : { deletedAt: now } })
      await outbox.deliverPending(state === "expired" ? new Date("2099-06-03T08:01:00Z") : now)
      expect(push.sendNotification).not.toHaveBeenCalled()
      expect((await prisma.todoReminderDelivery.findUnique({ where: { id: delivery.id } }))?.status).not.toBe("pending")
    })
  }
})
