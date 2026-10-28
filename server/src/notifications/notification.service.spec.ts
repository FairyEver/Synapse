import { Prisma, type UserNotification } from "@prisma/client"
import { NOTIFICATION_SOURCES } from "@synapse/shared"
import { Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { NotificationImageUnavailableError } from "./notification-image.service"
import { NotificationService } from "./notification.service"

const createdAt = new Date("2026-09-23T08:00:00.000Z")
type StoredNotification = UserNotification & { image: { id: string; mimeType: string; byteSize: number } | null }

const record: StoredNotification = {
  id: "message-1", userId: "user-1", source: "external", sourceKey: "external:key:request",
  title: "部署完成", body: "已更新", group: null, url: null, copyOnTap: false, level: "active",
  targetId: null, deviceId: null, readAt: null, resolvedAt: null, deletedAt: null, createdAt,
  imageId: null, image: null,
}

function harness() {
  const prisma = { userNotification: {
    create: vi.fn(async (): Promise<StoredNotification> => record), upsert: vi.fn(async (): Promise<StoredNotification> => record), findUnique: vi.fn(async () => record),
    findMany: vi.fn(async () => [record]), findFirst: vi.fn(async (): Promise<StoredNotification | null> => record),
    count: vi.fn(async () => 1), updateMany: vi.fn(async () => ({ count: 1 })),
    deleteMany: vi.fn(async (_input: unknown) => ({ count: 1 })),
  }, mailMessage: { findMany: vi.fn(async (): Promise<{ id: string; subject: string }[]> => []) },
  notificationImage: { findFirst: vi.fn(async (): Promise<{ id: string } | null> => ({ id: "img-1" })) },
  $transaction: vi.fn(async (run: (client: unknown) => Promise<unknown>) => run(prisma)) }
  const desktops = { broadcastToUser: vi.fn() }
  const mobiles = { sendToMobileClients: vi.fn() }
  const push = {
    sendNotification: vi.fn(async () => { throw new Error("APNs unavailable") }),
    sendTerminalApproval: vi.fn(async () => undefined),
  }
  const relay = { setNotificationSink: vi.fn() }
  const images = { claimInTransaction: vi.fn(async () => undefined), deleteByIds: vi.fn(async () => undefined) }
  const service = new NotificationService(prisma as never, desktops as never, mobiles as never, push as never, relay as never, images as never)
  return { service, prisma, desktops, mobiles, push, relay, images }
}

describe("NotificationService", () => {
  it("adds full subjects to existing mail notifications in one permission-scoped query", async () => {
    const { service, prisma } = harness()
    const subject = "【需求变更留档】" + "很长的站内信标题".repeat(12)
    const mail = { ...record, source: "mail-internal", title: "新站内信", targetId: "mail-1" }
    prisma.userNotification.findMany.mockResolvedValueOnce([mail, { ...mail, id: "message-2" }, { ...mail, id: "message-3", targetId: "deleted-mail" }, record])
    prisma.mailMessage.findMany.mockResolvedValueOnce([{ id: "mail-1", subject }])

    const result = await service.list("user-1", {})
    expect(result.items[0]).toMatchObject({ title: "新站内信", body: record.body, mailSubject: subject })
    expect(result.items[1]).toHaveProperty("mailSubject", subject)
    expect(result.items[2]).not.toHaveProperty("mailSubject")
    expect(result.items[3]).not.toHaveProperty("mailSubject")
    expect(prisma.mailMessage.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ["mail-1", "deleted-mail"] }, OR: [{ senderId: "user-1", senderDeletedAt: null }, { recipients: { some: { userId: "user-1", deletedAt: null } } }] },
      select: { id: true, subject: true }, take: 2,
    })
  })

  it("includes a readable mail subject in detail but skips mail queries for other sources", async () => {
    const { service, prisma } = harness()
    prisma.userNotification.findFirst.mockResolvedValueOnce({ ...record, source: "mail-internal", targetId: "mail-1" })
    prisma.mailMessage.findMany.mockResolvedValueOnce([{ id: "mail-1", subject: "版本公告" }])
    await expect(service.get("user-1", record.id)).resolves.toHaveProperty("mailSubject", "版本公告")
    prisma.mailMessage.findMany.mockClear()
    await service.list("user-1", {})
    await service.get("user-1", record.id)
    expect(prisma.mailMessage.findMany).not.toHaveBeenCalled()
  })

  it("projects discussion metadata without exposing its internal share context", async () => {
    const { service, prisma } = harness()
    prisma.userNotification.findFirst.mockResolvedValueOnce({
      ...record, source: "drive-discussion",
      driveDiscussionTarget: { kind: "annotation", action: "replied", sourceShareId: "private-share", snapshot: { detailTitle: "完整标题", content: "本次回复", original: { kind: "text", text: "原文", sourceShareId: "private-share" } } },
    } as StoredNotification)
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
    let resolve!: (value: StoredNotification) => void
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
    const mail = { ...record, source: "mail-internal" }
    const rows = Array.from({ length: 51 }, (_, index) => ({ ...mail, id: `mail-${index}` }))
    prisma.userNotification.findMany.mockResolvedValueOnce(rows)

    await expect(service.list("user-1", { source: "mail-internal", filter: "unread", cursor: "message-1" }))
      .resolves.toEqual({ items: rows.slice(0, 50), nextCursor: "mail-49" })
    expect(prisma.userNotification.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1", deletedAt: null, createdAt: { gte: expect.any(Date) },
        source: "mail-internal", readAt: null,
        OR: [{ createdAt: { lt: record.createdAt } }, { createdAt: record.createdAt, id: { lt: record.id } }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
      include: {
        driveDiscussionTarget: { select: { kind: true, action: true, snapshot: true } },
        image: { select: { id: true, mimeType: true, byteSize: true } },
      },
    })
  })

  it("carries the claimed image into both the list and the detail projection", async () => {
    const { service, prisma } = harness()
    const image = { id: "img-1", mimeType: "image/png", byteSize: 4 }
    prisma.userNotification.findMany.mockResolvedValueOnce([{ ...record, imageId: image.id, image }])
    prisma.userNotification.findFirst.mockResolvedValueOnce({ ...record, imageId: image.id, image })

    await expect(service.list("user-1", {})).resolves.toMatchObject({ items: [{ image }] })
    await expect(service.get("user-1", record.id)).resolves.toMatchObject({ image })

    // 图片不是读时拼出来的：查询本身就要把它带回来，投影只是原样展开。
    expect(prisma.userNotification.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      include: expect.objectContaining({ image: { select: { id: true, mimeType: true, byteSize: true } } }),
    }))
    expect(prisma.userNotification.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      include: expect.objectContaining({ image: { select: { id: true, mimeType: true, byteSize: true } } }),
    }))
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
    // 两次清空都只把带图的行读回来算对象键，删除条件本身仍是全范围。
    for (const call of prisma.userNotification.findMany.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({
        where: expect.objectContaining({ imageId: { not: null } }),
      }))
    }
    expect(prisma.userNotification.findMany).toHaveBeenCalledTimes(2)
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

  it("claims the image inside the same transaction that creates the notification", async () => {
    const claim = vi.fn(async () => undefined)
    const created = vi.fn(async () => ({ id: "n1", imageId: "img-1" }))
    const tx = { userNotification: { create: created } }
    const service = new NotificationService(
      { $transaction: async (run: (client: unknown) => Promise<unknown>) => run(tx) } as never,
      { broadcastToUser: vi.fn() } as never,
      { sendToMobileClients: vi.fn() } as never,
      { sendNotification: vi.fn(async () => ({ failed: 0, skipped: false })) } as never,
      {} as never,
      { claimInTransaction: claim } as never,
    )
    await service.create({ userId: "u1", source: "system-notifier", title: "图", body: "看图", imageId: "img-1" })
    expect(claim).toHaveBeenCalledWith(tx, "u1", "img-1")
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ imageId: "img-1" }) }))
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

  it("resolves the image through the caller-owned notification row", async () => {
    // 图片 ID 来自路由，光凭它不能证明归属；必须先用「这条通知属于谁」把范围收住。
    const findFirst = vi.fn(async () => ({ imageId: "img-1" }))
    const open = vi.fn(async () => ({ stream: Readable.from([Buffer.from([1])]), mimeType: "image/png", byteSize: 1 }))
    const service = new NotificationService(
      { userNotification: { findFirst } } as never,
      { broadcastToUser: vi.fn() } as never,
      { sendToMobileClients: vi.fn() } as never,
      {} as never, {} as never,
      { open } as never,
    )
    await expect(service.imageFor("u1", "n1")).resolves.toMatchObject({ mimeType: "image/png" })
    expect(findFirst).toHaveBeenCalledWith({ where: { id: "n1", userId: "u1", deletedAt: null }, select: { imageId: true } })
    expect(open).toHaveBeenCalledWith("img-1")
  })

  it("answers null when the notification carries no image", async () => {
    const open = vi.fn()
    const service = new NotificationService(
      { userNotification: { findFirst: async () => ({ imageId: null }) } } as never,
      { broadcastToUser: vi.fn() } as never,
      { sendToMobileClients: vi.fn() } as never,
      {} as never, {} as never,
      { open } as never,
    )
    await expect(service.imageFor("u1", "n1")).resolves.toBeNull()
    expect(open).not.toHaveBeenCalled()
  })

  it("deletes the stored object when a notification is deleted", async () => {
    const deleteByIds = vi.fn(async () => undefined)
    const service = new NotificationService(
      {
        userNotification: {
          findFirst: async () => ({ imageId: "img-1" }),
          updateMany: async () => ({ count: 1 }),
        },
      } as never,
      { broadcastToUser: vi.fn() } as never,
      { sendToMobileClients: vi.fn() } as never,
      {} as never, {} as never,
      { deleteByIds } as never,
    )
    await service.delete("u1", "n1")
    expect(deleteByIds).toHaveBeenCalledWith(["img-1"])
  })

  it("removes stored objects before pruning expired notification rows", async () => {
    const order: string[] = []
    const deleteByIds = vi.fn(async () => { order.push("objects") })
    const findMany = vi.fn(async (_input: unknown) => [{ imageId: "img-1" }])
    const service = new NotificationService(
      {
        userNotification: {
          findMany,
          deleteMany: async () => { order.push("rows"); return { count: 1 } },
        },
      } as never,
      { broadcastToUser: vi.fn() } as never,
      { sendToMobileClients: vi.fn() } as never,
      {} as never, {} as never,
      { deleteByIds } as never,
    )
    await service.pruneExpired()
    expect(order).toEqual(["objects", "rows"])
    // 只把带图的行读回来；删除条件本身仍要不带图的记录一起删。
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ imageId: { not: null } }) }))
  })

  it("checks image ownership inside createInTransaction instead of trusting the id", async () => {
    const { service, prisma } = harness()
    await expect(service.createInTransaction(prisma as never, {
      userId: "user-1", source: "external", sourceKey: "test:image", title: "图", body: "看图", imageId: "img-1",
    })).resolves.toMatchObject({ id: "message-1" })
    expect(prisma.notificationImage.findFirst).toHaveBeenCalledWith({
      where: { id: "img-1", userId: "user-1" }, select: { id: true },
    })

    prisma.notificationImage.findFirst.mockResolvedValueOnce(null)
    await expect(service.createInTransaction(prisma as never, {
      userId: "user-2", source: "external", sourceKey: "test:other", title: "图", body: "看图", imageId: "img-1",
    })).rejects.toBeInstanceOf(NotificationImageUnavailableError)
    // 只有前一次成功的写入；被拒的那一次不能留下通知行。
    expect(prisma.userNotification.upsert).toHaveBeenCalledTimes(1)
  })
})
