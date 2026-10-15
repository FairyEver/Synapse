import { Prisma, type UserNotification } from "@prisma/client"
import { NOTIFICATION_SOURCES } from "@synapse/shared"
import { describe, expect, it, vi } from "vitest"
import { NotificationService } from "./notification.service"

const createdAt = new Date("2026-09-23T08:00:00.000Z")
const record: UserNotification = {
  id: "message-1", userId: "user-1", source: "external", sourceKey: "external:key:request",
  title: "部署完成", body: "已更新", group: null, url: null, copyOnTap: false, level: "active",
  targetId: null, deviceId: null, readAt: null, resolvedAt: null, deletedAt: null, createdAt,
}

function harness() {
  const prisma = { userNotification: {
    create: vi.fn(async (): Promise<UserNotification> => record), findUnique: vi.fn(async () => record),
    findMany: vi.fn(async () => [record]), findFirst: vi.fn(async (): Promise<UserNotification | null> => record),
    count: vi.fn(async () => 1), updateMany: vi.fn(async () => ({ count: 1 })),
    deleteMany: vi.fn(async (_input: unknown) => ({ count: 1 })),
  } }
  const desktops = { broadcastToUser: vi.fn() }
  const mobiles = { sendToMobileClients: vi.fn() }
  const push = {
    sendNotification: vi.fn(async () => { throw new Error("APNs unavailable") }),
    sendTerminalApproval: vi.fn(async () => undefined),
  }
  const relay = { setNotificationSink: vi.fn() }
  const service = new NotificationService(prisma as never, desktops as never, mobiles as never, push as never, relay as never)
  return { service, prisma, desktops, mobiles, push, relay }
}

describe("NotificationService", () => {
  it("projects discussion metadata without exposing its internal share context", async () => {
    const { service, prisma } = harness()
    prisma.userNotification.findFirst.mockResolvedValueOnce({
      ...record, source: "drive-discussion",
      driveDiscussionTarget: { kind: "annotation", action: "replied", sourceShareId: "private-share", snapshot: { detailTitle: "完整标题", content: "本次回复", original: { kind: "text", text: "原文", sourceShareId: "private-share" } } },
    } as UserNotification)
    const result = await service.get("user-1", "message-1")
    expect(result).toMatchObject({ driveDiscussion: { kind: "annotation", action: "replied" } })
    expect(result).not.toHaveProperty("driveDiscussionTarget")
    expect(result).not.toHaveProperty("sourceShareId")
    expect(result).toMatchObject({ driveDiscussion: { snapshot: { detailTitle: "完整标题", content: "本次回复", original: { kind: "text", text: "原文" } } } })
    expect(JSON.stringify(result)).not.toContain("private-share")
  })
  it("stops delivery when its lease is cancelled during the record read", async () => {
    const { service, prisma, desktops, mobiles, push } = harness()
    const controller = new AbortController()
    let resolve!: (value: UserNotification) => void
    prisma.userNotification.findFirst.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const delivery = service.deliverCommitted("user-1", "message-1", controller.signal)
    controller.abort(); resolve(record)
    await expect(delivery).rejects.toMatchObject({ name: "AbortError" })
    expect(desktops.broadcastToUser).not.toHaveBeenCalled()
    expect(mobiles.sendToMobileClients).not.toHaveBeenCalled()
    expect(push.sendNotification).not.toHaveBeenCalled()
  })
  it("treats resolved failed or skipped pushes as retryable, but no devices as success", async () => {
    const { service, push } = harness()
    for (const outcome of [{ sent: 0, failed: 1, skipped: false }, { sent: 0, failed: 0, skipped: true }]) {
      push.sendNotification.mockImplementationOnce(async () => outcome as never)
      await expect(service.deliverCommitted("user-1", "message-1")).rejects.toThrow()
    }
    push.sendNotification.mockImplementationOnce(async () => ({ sent: 0, failed: 0, skipped: false }) as never)
    await expect(service.deliverCommitted("user-1", "message-1")).resolves.toBeUndefined()
  })
  it("does not push a notification that has already been read", async () => {
    const { service, prisma, push, desktops } = harness()
    prisma.userNotification.findFirst.mockResolvedValueOnce({ ...record, readAt: new Date() })
    await service.deliverCommitted("user-1", "message-1")
    expect(push.sendNotification).not.toHaveBeenCalled()
    expect(desktops.broadcastToUser).not.toHaveBeenCalled()
  })
  it("applies the source before cursor pagination and retains the unread intersection", async () => {
    const { service, prisma } = harness()
    const mail = { ...record, source: "mail" }
    const rows = Array.from({ length: 51 }, (_, index) => ({ ...mail, id: `mail-${index}` }))
    prisma.userNotification.findMany.mockResolvedValueOnce(rows)

    await expect(service.list("user-1", { source: "mail", filter: "unread", cursor: "message-1" }))
      .resolves.toEqual({ items: rows.slice(0, 50), nextCursor: "mail-49" })
    expect(prisma.userNotification.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1", deletedAt: null, createdAt: { gte: expect.any(Date) },
        source: "mail", readAt: null,
        OR: [{ createdAt: { lt: record.createdAt } }, { createdAt: record.createdAt, id: { lt: record.id } }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
      include: { driveDiscussionTarget: { select: { kind: true, action: true, snapshot: true } } },
    })
  })

  it("preserves all-source reads and restricts pending to unresolved terminal attention", async () => {
    const { service, prisma } = harness()
    await service.list("user-1", {})
    expect(prisma.userNotification.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { userId: "user-1", deletedAt: null, createdAt: { gte: expect.any(Date) } },
    }))
    await service.list("user-1", { source: "terminal-attention", filter: "pending" })
    expect(prisma.userNotification.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { userId: "user-1", deletedAt: null, createdAt: { gte: expect.any(Date) }, source: "terminal-attention", resolvedAt: null },
    }))
  })

  it("returns an empty pending intersection for every other source", async () => {
    const { service, prisma } = harness()
    for (const source of NOTIFICATION_SOURCES.filter((source) => source !== "terminal-attention")) {
      await expect(service.list("user-1", { source, filter: "pending", cursor: "message-1" }))
        .resolves.toEqual({ items: [], nextCursor: null })
    }
    expect(prisma.userNotification.findFirst).not.toHaveBeenCalled()
    expect(prisma.userNotification.findMany).not.toHaveBeenCalled()
  })

  it("keeps a persisted message when APNs fails and publishes its ID", async () => {
    const { service, prisma, desktops, mobiles } = harness()
    await expect(service.create({ userId: "user-1", source: "external", title: "部署完成", body: "已更新" })).resolves.toEqual(record)
    expect(prisma.userNotification.create).toHaveBeenCalledOnce()
    expect(desktops.broadcastToUser.mock.calls[0]?.[1]).toMatchObject({ type: "notification.changed", payload: { notificationId: "message-1" } })
    expect(mobiles.sendToMobileClients.mock.calls[0]?.[0]).toMatchObject({ userId: "user-1" })
  })

  it("returns the existing message for an idempotent retry without another push", async () => {
    const { service, prisma, push, desktops } = harness()
    prisma.userNotification.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }))
    await expect(service.create({ userId: "user-1", source: "external", sourceKey: "external:key:request", title: "部署完成", body: "已更新" })).resolves.toEqual(record)
    expect(push.sendNotification).not.toHaveBeenCalled()
    expect(desktops.broadcastToUser).not.toHaveBeenCalled()
  })

  it("preserves terminal lock-screen actions while routing a tap through the message ID", async () => {
    const { service, prisma, push } = harness()
    prisma.userNotification.findFirst.mockResolvedValueOnce(null)
    prisma.userNotification.create.mockResolvedValueOnce({ ...record, source: "terminal-attention", targetId: "session-1", deviceId: "desktop-1" })
    await service.create({ userId: "user-1", source: "terminal-attention", title: "等待确认", body: "需要操作", targetId: "session-1", deviceId: "desktop-1" })
    expect(push.sendTerminalApproval).toHaveBeenCalledWith("user-1", expect.objectContaining({ notificationId: "message-1", sessionId: "session-1" }))
    expect(push.sendNotification).not.toHaveBeenCalled()
  })

  it("synchronizes read and delete state and removes records older than 90 days", async () => {
    const { service, prisma, desktops, mobiles } = harness()
    await service.markRead("user-1", "message-1")
    await service.delete("user-1", "message-1")
    expect(prisma.userNotification.updateMany).toHaveBeenCalledTimes(2)
    expect(desktops.broadcastToUser).toHaveBeenCalledTimes(2)
    expect(mobiles.sendToMobileClients).toHaveBeenCalledTimes(2)
    await service.pruneExpired()
    expect(prisma.userNotification.deleteMany.mock.calls[0]?.[0]).toMatchObject({ where: { createdAt: { lt: expect.any(Date) } } })
    const cutoff = (prisma.userNotification.deleteMany.mock.calls[0]?.[0] as { where: { createdAt: { lt: Date } } }).where.createdAt.lt
    expect(Math.abs(Date.now() - cutoff.getTime() - 90 * 24 * 60 * 60 * 1000)).toBeLessThan(2_000)
  })

  it("lets the owner mark a notification unread again without changing its pending state", async () => {
    const { service, prisma, desktops } = harness()
    await service.markRead("user-1", "message-1", false)
    expect(prisma.userNotification.updateMany).toHaveBeenCalledWith({
      where: { id: "message-1", userId: "user-1", readAt: { not: null }, deletedAt: null },
      data: { readAt: null },
    })
    expect(desktops.broadcastToUser).toHaveBeenCalledOnce()
  })

  it("withdraws the open-terminal handle for a session that is gone", async () => {
    // 会话结束之后，它留下的那条「打开终端」不再指向任何东西。清的是 `targetId`，不是
    // 删记录：那条消息说的是「那一轮跑完了」，这件事发生过，历史要留着。
    const { service, prisma, desktops } = harness()
    await service.invalidateTerminalTarget("user-1", "desktop-1", "session-1")

    expect(prisma.userNotification.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        deviceId: "desktop-1",
        targetId: "session-1",
        source: { in: ["terminal-attention", "terminal-complete"] },
        deletedAt: null,
      },
      data: { targetId: null, resolvedAt: expect.any(Date) },
    })
    expect(desktops.broadcastToUser).toHaveBeenCalledOnce()
  })

  it("leaves the handle alone when a session merely stops waiting", async () => {
    // 会话还在、只是不再等人回答 —— 那时「打开终端」照样打得开。所以这一条只放下待处理
    // 标记，不碰句柄。两件事在这里分岔，分岔的理由是同一个：句柄作不作废，取决于那条
    // 会话还在不在。
    const { service, prisma } = harness()
    await service.resolveAttention("user-1", "desktop-1", "session-1")

    expect(prisma.userNotification.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        source: "terminal-attention",
        deviceId: "desktop-1",
        targetId: "session-1",
        resolvedAt: null,
      },
      data: { resolvedAt: expect.any(Date) },
    })
  })

  it("clears all messages and ignores only unresolved terminal attention", async () => {
    const { service, prisma, desktops } = harness()
    await service.deleteAll("user-1", "all")
    await service.deleteAll("user-1", "pending")

    expect(prisma.userNotification.updateMany).toHaveBeenNthCalledWith(1, {
      where: { userId: "user-1", deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    })
    expect(prisma.userNotification.updateMany).toHaveBeenNthCalledWith(2, {
      where: { userId: "user-1", deletedAt: null, source: "terminal-attention", resolvedAt: null },
      data: { deletedAt: expect.any(Date) },
    })
    expect(desktops.broadcastToUser).toHaveBeenCalledTimes(2)
  })

  it("writes copyOnTap through to storage", async () => {
    const { service, prisma } = harness()
    await service.create({ userId: "user-1", source: "system-notifier", title: "绕口令", body: "四是四", copyOnTap: true })
    expect(prisma.userNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ copyOnTap: true }),
    })
  })

  it("carries the stored flag into the phone push", async () => {
    const { service, prisma, push } = harness()
    prisma.userNotification.create.mockResolvedValueOnce({ ...record, source: "system-notifier", copyOnTap: true })
    await service.create({ userId: "user-1", source: "system-notifier", title: "绕口令", body: "四是四", copyOnTap: true })
    // 首次投递这条调用不带 signal，所以断言只有两个参数。
    expect(push.sendNotification).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ copyOnTap: true }),
    )
  })

  it("keeps a passive copyable message in the account without pushing it", async () => {
    const { service, prisma, push } = harness()
    prisma.userNotification.create.mockResolvedValueOnce({ ...record, source: "system-notifier", level: "passive", copyOnTap: true })
    await service.create({ userId: "user-1", source: "system-notifier", title: "绕口令", body: "四是四", copyOnTap: true })
    expect(prisma.userNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ copyOnTap: true }),
    })
    expect(push.sendNotification).not.toHaveBeenCalled()
  })

  it("forwards the stored flag when a retry redelivers the message", async () => {
    const { service, prisma, push } = harness()
    // 夹具里推送默认是抛异常的；这一条要走到断言，先让这一次投递成功。
    push.sendNotification.mockImplementationOnce(async () => ({ sent: 1, failed: 0, skipped: false }) as never)
    prisma.userNotification.findFirst.mockResolvedValueOnce({ ...record, source: "system-notifier", copyOnTap: true })
    await service.deliverCommitted("user-1", "message-1")
    // 重投这条走 record 而不是入参；补投递会把 signal 一起传下去，所以这里是三个参数。
    expect(push.sendNotification).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ copyOnTap: true }),
      undefined,
    )
  })
})
