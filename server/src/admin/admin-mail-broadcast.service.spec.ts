import { describe, expect, it, vi } from "vitest"
import { AdminMailBroadcastService } from "./admin-mail-broadcast.service"

function fixture() {
  const users = [{ id: "team-a-user" }, { id: "team-b-user" }]
  const stored = { id: "mail-1", subject: "Synapse v1.0.42 更新内容", body: "更新内容", sentAt: new Date("2026-09-29T00:00:00Z"), _count: { recipients: 2 } }
  const prisma = {
    user: {
      count: vi.fn(async () => users.length),
      findMany: vi.fn(async () => users),
    },
    mailMessage: {
      findUnique: vi.fn(async () => null as typeof stored | null),
      create: vi.fn(async () => ({ id: stored.id, sentAt: stored.sentAt })),
    },
    mailRecipient: { createMany: vi.fn(async () => ({ count: users.length })) },
    mailNotificationOutbox: { createMany: vi.fn(async () => ({ count: users.length })) },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
  }
  const mail = { queueNotificationDelivery: vi.fn() }
  const audit = { recordWithClient: vi.fn(async () => undefined) }
  const service = new AdminMailBroadcastService(prisma as never, mail as never, audit as never)
  const input = { requestId: "release:v1.0.0", subject: stored.subject, body: stored.body }
  return { service, prisma, mail, audit, users, stored, input }
}

describe("AdminMailBroadcastService", () => {
  it("selects all active users across teams and writes mail, copies, reminders, and admin audit atomically", async () => {
    const { service, prisma, mail, audit, input } = fixture()
    expect(await service.audience()).toEqual({ activeUsers: 2 })
    expect(prisma.user.count).toHaveBeenCalledWith({ where: { status: "active" } })

    await expect(service.send(input, "admin-session", "203.0.113.10")).resolves.toMatchObject({ messageId: "mail-1", recipientCount: 2 })
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { status: "active" }, select: { id: true }, orderBy: { id: "asc" } })
    expect(prisma.mailMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      kind: "platform_broadcast", broadcastRequestId: input.requestId, subject: input.subject, body: input.body,
      addressSnapshot: { to: [{ kind: "audience", name: "所有用户" }], cc: [] },
    }) })
    expect(prisma.mailRecipient.createMany).toHaveBeenCalledWith({ data: [
      { messageId: "mail-1", userId: "team-a-user" },
      { messageId: "mail-1", userId: "team-b-user" },
    ] })
    expect(prisma.mailNotificationOutbox.createMany).toHaveBeenCalledWith({ data: [
      { messageId: "mail-1", recipientId: "team-a-user" },
      { messageId: "mail-1", recipientId: "team-b-user" },
    ] })
    expect(audit.recordWithClient).toHaveBeenCalledWith(prisma, expect.objectContaining({
      actor: expect.objectContaining({ actorType: "platform_admin", adminSessionId: "admin-session" }),
      action: "admin.mail.broadcast.send", targetId: "mail-1", detail: { requestId: input.requestId, recipientCount: 2 },
    }))
    expect(mail.queueNotificationDelivery).toHaveBeenCalledWith("mail-1")
  })

  it("returns the existing mail for the same request and rejects changed content", async () => {
    const { service, prisma, mail, stored, input } = fixture()
    prisma.mailMessage.findUnique.mockResolvedValue(stored)
    await expect(service.send(input, "admin-session", "203.0.113.10")).resolves.toMatchObject({ messageId: "mail-1", recipientCount: 2 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(mail.queueNotificationDelivery).toHaveBeenCalledWith("mail-1")
    await expect(service.send({ ...input, body: "另一封信" }, "admin-session", "203.0.113.10")).rejects.toThrow("请求标识已用于其他公告")
  })

  it("does not create an empty broadcast or queue reminders when the audit fails", async () => {
    const { service, prisma, mail, audit, input } = fixture()
    prisma.user.findMany.mockResolvedValueOnce([])
    await expect(service.send(input, "admin-session", "203.0.113.10")).rejects.toThrow("没有可投递的用户")
    expect(prisma.mailMessage.create).not.toHaveBeenCalled()
    audit.recordWithClient.mockRejectedValueOnce(new Error("audit unavailable"))
    await expect(service.send(input, "admin-session", "203.0.113.10")).rejects.toThrow("audit unavailable")
    expect(mail.queueNotificationDelivery).not.toHaveBeenCalled()
  })
})
