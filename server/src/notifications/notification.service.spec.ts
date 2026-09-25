import { Prisma, type UserNotification } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { NotificationService } from "./notification.service"

const createdAt = new Date("2026-09-23T08:00:00.000Z")
const record: UserNotification = {
  id: "message-1", userId: "user-1", source: "external", sourceKey: "external:key:request",
  title: "部署完成", body: "已更新", group: null, url: null, level: "active",
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
})
