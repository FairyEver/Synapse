import { describe, expect, it, vi } from "vitest"
import { MailService } from "./mail.service"
import { recipientMatch } from "./mail-recipient-match"

function harness() {
  const sender = { id: "sender", nickname: "李杨", handle: "liyang", teamMemberships: [{ teamId: "team-1" }] }
  const teammate = { id: "teammate", nickname: "王明", handle: "wangming", teamMemberships: [{ teamId: "team-1" }] }
  const prisma = {
    teamMembership: { findMany: vi.fn(async () => [{ teamId: "team-1" }]) },
    user: { findMany: vi.fn(async (_query?: { take?: number }) => [sender, teammate]), findFirst: vi.fn(async () => teammate), count: vi.fn(async () => 2) },
    team: { findFirst: vi.fn(async () => ({ id: "team-1", name: "团队一" })) },
    mailAttachment: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0), updateMany: vi.fn(async () => ({ count: 0 })), deleteMany: vi.fn(async () => ({ count: 1 })) },
    mailDraft: { findMany: vi.fn(async () => []), create: vi.fn(async () => ({ id: "draft-1" })) },
    mailStorageDeletion: { create: vi.fn(async () => ({ id: "deletion-1" })), findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 1 })) },
    mailSendPreview: {
      create: vi.fn(async () => ({ id: "preview-1", expiresAt: new Date(Date.now() + 60_000) })),
      findFirst: vi.fn(async () => ({ id: "preview-1", userId: "sender", teamIdSnapshot: "team-1", teamNameSnapshot: "团队一", recipientIds: ["teammate"], attachmentIds: [], subject: "报告", body: "正文", replyToId: null })),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    mailNotificationOutbox: {
      createMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => [{ id: "outbox-1", messageId: "message-1", recipientId: "teammate", message: { sender: { nickname: "李杨", handle: "liyang" } } }]),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    mailMessage: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "message-1", sentAt: new Date() })),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
  }
  const notifications = { create: vi.fn(async () => ({ id: "notice-1" })) }
  const storage = { delete: vi.fn(async () => undefined) }
  const service = new MailService(prisma as never, storage as never, {} as never, notifications as never)
  return { service, prisma, notifications, storage, sender, teammate }
}

describe("MailService", () => {
  it("ranks exact recipients above fuzzy matches", () => {
    expect(recipientMatch("王明", ["王明", "wangming"])).toMatchObject({ matchKind: "exact", similarity: 1 })
    expect(recipientMatch("wangmong", ["王明", "wangming"])?.matchKind).toBe("fuzzy")
  })

  it("finds an exact recipient beyond the first thousand team members", async () => {
    const { service, prisma, teammate } = harness()
    const users = Array.from({ length: 1000 }, (_, index) => ({ id: `person-${index}`, nickname: `成员${index}`, handle: `member${index}`, teamMemberships: [{ teamId: "team-1" }] }))
    prisma.user.findMany.mockImplementationOnce(async (query?: { take?: number }) => [...users, teammate].slice(0, query?.take ?? Infinity) as never)
    const result = await service.searchRecipients("sender", "王明")
    expect(result.items[0]).toMatchObject({ userId: "teammate", matchKind: "exact" })
  })

  it("browses only active teammates in stable pages without a search term", async () => {
    const { service, prisma } = harness()
    const users = Array.from({ length: 51 }, (_, index) => ({ id: `person-${index}`, nickname: `成员${index}`, handle: `member${index}`, teamMemberships: [{ teamId: "team-1" }] }))
    prisma.user.findMany.mockResolvedValueOnce(users as never).mockResolvedValueOnce(users.slice(50) as never)
    const first = await service.searchRecipients("sender", "")
    expect(first.items).toHaveLength(50)
    expect(first.nextCursor).toBe("person-49")
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { not: "sender" }, status: "active", teamMemberships: { some: { teamId: { in: ["team-1"] } } } }), take: 51 }))
    const second = await service.searchRecipients("sender", "", first.nextCursor!)
    expect(second.items.map((item) => item.userId)).toEqual(["person-50"])
    expect(second.nextCursor).toBeNull()
    expect(prisma.user.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: { id: "person-49" }, skip: 1 }))
  })

  it("rejects a browse cursor outside the sender's visible teammates", async () => {
    const { service, prisma } = harness()
    prisma.user.findFirst.mockResolvedValueOnce(null as never)
    await expect(service.searchRecipients("sender", "", "outsider")).rejects.toThrow("无效的收件人分页位置")
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it("previews a shared-team recipient and exposes the complete fixed content", async () => {
    const { service } = harness()
    const preview = await service.createPreview("sender", { recipientIds: ["teammate"], subject: "报告", body: "完整正文", attachmentIds: [] })
    expect(preview).toMatchObject({ previewId: "preview-1", recipients: [{ userId: "teammate" }], subject: "报告", body: "完整正文", attachments: [] })
  })

  it("rejects a recipient with no team in common", async () => {
    const { service, prisma, teammate } = harness()
    prisma.user.findMany.mockResolvedValueOnce([{ id: "sender", nickname: "李杨", handle: "liyang", teamMemberships: [{ teamId: "team-1" }] }, { ...teammate, teamMemberships: [{ teamId: "team-2" }] }])
    await expect(service.createPreview("sender", { recipientIds: ["teammate"], subject: "报告", body: "正文", attachmentIds: [] })).rejects.toThrow("同一团队")
    expect(prisma.mailSendPreview.create).not.toHaveBeenCalled()
  })

  it("rechecks membership when sending and never creates a message after removal", async () => {
    const { service, prisma } = harness()
    prisma.user.count.mockResolvedValueOnce(1)
    await expect(service.send("sender", "preview-1", "request-1")).rejects.toThrow("团队成员已变化")
    expect(prisma.mailMessage.create).not.toHaveBeenCalled()
  })

  it("sends only once for the same preview and request key", async () => {
    const { service, prisma, notifications } = harness()
    await expect(service.send("sender", "preview-1", "request-1")).resolves.toMatchObject({ messageId: "message-1", recipientIds: ["teammate"] })
    expect(prisma.mailMessage.create).toHaveBeenCalledOnce()
    expect(prisma.mailNotificationOutbox.createMany).toHaveBeenCalledWith({ data: [{ messageId: "message-1", recipientId: "teammate" }] })
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "teammate", sourceKey: "mail:message-1", body: "来自 李杨。" }))
    prisma.mailMessage.findUnique.mockResolvedValueOnce({ id: "message-1", previewId: "preview-1", recipients: [{ userId: "teammate" }], sentAt: new Date() } as never)
    await service.send("sender", "preview-1", "request-1")
    expect(prisma.mailMessage.create).toHaveBeenCalledOnce()
  })

  it("retains failed notification delivery for scheduled retry", async () => {
    const { service, prisma, notifications } = harness()
    notifications.create.mockRejectedValueOnce(new Error("notification store unavailable"))
    await service.send("sender", "preview-1", "request-1")
    expect(prisma.mailNotificationOutbox.deleteMany).not.toHaveBeenCalled()
    await service.retryPendingNotifications()
    expect(notifications.create).toHaveBeenCalledTimes(2)
    expect(prisma.mailNotificationOutbox.deleteMany).toHaveBeenCalledWith({ where: { id: "outbox-1" } })
  })

  it("reclaims an old unattached object through a durable deletion queue", async () => {
    const { service, prisma, storage } = harness()
    const old = new Date("2026-09-01T00:00:00.000Z")
    prisma.mailAttachment.findMany.mockResolvedValueOnce([{ id: "attachment-1", ownerId: "sender", storageKey: "mail/attachments/object-1", lastReferencedAt: old }] as never)
    prisma.mailStorageDeletion.findMany.mockResolvedValueOnce([{ id: "deletion-1", storageKey: "mail/attachments/object-1" }] as never)
    await service.cleanupExpiredMail(new Date("2026-09-27T00:00:00.000Z"))
    expect(prisma.mailAttachment.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "attachment-1", messageId: null }) }))
    expect(prisma.mailStorageDeletion.create).toHaveBeenCalledWith({ data: { storageKey: "mail/attachments/object-1" } })
    expect(storage.delete).toHaveBeenCalledWith("mail/attachments/object-1")
    expect(prisma.mailStorageDeletion.deleteMany).toHaveBeenCalledWith({ where: { id: "deletion-1" } })
  })

  it("keeps an old attachment referenced by a draft", async () => {
    const { service, prisma, storage } = harness()
    prisma.mailAttachment.findMany.mockResolvedValueOnce([{ id: "attachment-1", ownerId: "sender", storageKey: "mail/attachments/object-1", lastReferencedAt: new Date("2026-09-01") }] as never)
    prisma.mailDraft.findMany.mockResolvedValueOnce([{ attachmentIds: ["attachment-1"] }] as never)
    await service.cleanupExpiredMail(new Date("2026-09-27T00:00:00.000Z"))
    expect(prisma.mailAttachment.deleteMany).not.toHaveBeenCalled()
    expect(storage.delete).not.toHaveBeenCalled()
  })

  it("keeps a storage deletion queued when object removal fails", async () => {
    const { service, prisma, storage } = harness()
    prisma.mailStorageDeletion.findMany.mockResolvedValueOnce([{ id: "deletion-1", storageKey: "mail/attachments/object-1" }] as never)
    storage.delete.mockRejectedValueOnce(new Error("storage unavailable"))
    await service.cleanupExpiredMail()
    expect(prisma.mailStorageDeletion.deleteMany).not.toHaveBeenCalled()
  })

  it("rejects a draft whose attachment was already reclaimed", async () => {
    const { service, prisma } = harness()
    await expect(service.createDraft("sender", { recipientIds: [], subject: "草稿", body: "正文", attachmentIds: ["missing"] })).rejects.toThrow("附件已失效")
    expect(prisma.mailDraft.create).not.toHaveBeenCalled()
  })
})
