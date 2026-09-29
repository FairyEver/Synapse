import { describe, expect, it, vi } from "vitest"
import { MailService } from "./mail.service"
import { recipientMatch } from "./mail-recipient-match"

function harness() {
  const sender = { id: "sender", nickname: "李杨", handle: "liyang", teamMemberships: [{ teamId: "team-1" }] }
  const teammate = { id: "teammate", nickname: "王明", handle: "wangming", teamMemberships: [{ teamId: "team-1" }] }
  const prisma = {
    teamMembership: { findMany: vi.fn(async () => [{ teamId: "team-1" }]) },
    user: { findMany: vi.fn(async (_query?: { take?: number }) => [sender, teammate]), findFirst: vi.fn(async () => teammate), count: vi.fn(async () => 2) },
    team: { findFirst: vi.fn(async () => ({ id: "team-1", name: "团队一" })), findUnique: vi.fn(async () => ({ id: "team-1", name: "团队一" })) },
    organization: { findMany: vi.fn(async () => [] as { id: string; teamId: string; name: string; parentId: string | null }[]) },
    organizationMembership: { findMany: vi.fn(async () => [] as { organizationId: string; userId: string }[]) },
    mailAttachment: { create: vi.fn(async (input: { data: { fileName: string; size: bigint; storageKey: string } }) => ({ id: "attachment-1", fileName: input.data.fileName, mimeType: "application/octet-stream", size: input.data.size, storageKey: input.data.storageKey })), findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []), count: vi.fn(async () => 0), updateMany: vi.fn(async () => ({ count: 0 })), deleteMany: vi.fn(async () => ({ count: 1 })), delete: vi.fn(async () => ({ id: "attachment-1" })) },
    mailStorageDeletion: { create: vi.fn(async () => ({ id: "deletion-1" })), findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 1 })) },
    mailSendPreview: {
      create: vi.fn(async () => ({ id: "preview-1", expiresAt: new Date(Date.now() + 60_000) })),
      findFirst: vi.fn(async () => ({ id: "preview-1", userId: "sender", formatVersion: 2, teamIdSnapshot: "team-1", teamNameSnapshot: "团队一", recipientIds: ["teammate"], ccIds: [], attachmentIds: [], subject: "报告", body: "正文", conversationId: "conversation-1", quoteSnapshot: null, replyToId: null, forwardOfId: null })),
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
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async () => ({ id: "message-1", sentAt: new Date() })),
    },
    mailRecipient: {
      createMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => [] as { messageId: string }[]),
      count: vi.fn(async () => 0),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
  }
  const notifications = { create: vi.fn(async () => ({ id: "notice-1" })) }
  const storage = { put: vi.fn(async () => undefined), copy: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) }
  const service = new MailService(prisma as never, storage as never, notifications as never)
  return { service, prisma, notifications, storage, sender, teammate }
}

describe("MailService", () => {
  it("shows platform mail without exposing the recipient roster and rejects replies", async () => {
    const { service, prisma } = harness()
    prisma.mailMessage.findFirst.mockResolvedValueOnce({
      id: "broadcast-1", kind: "platform_broadcast", senderId: null, sender: null,
      recipients: [{ userId: "reader", role: "to", readAt: null, user: { id: "reader", nickname: "收件人", handle: "reader" } }],
      addressSnapshot: { to: [{ kind: "audience", name: "所有用户" }], cc: [] },
      subject: "版本更新", body: "更新正文", sentAt: new Date("2026-09-29T00:00:00Z"),
      teamIdSnapshot: null, teamNameSnapshot: null, conversationId: "broadcast-1", replyToId: null, forwardOfId: null,
      quoteSnapshot: null, attachments: [],
    } as never)
    const detail = await service.getMessage("reader", "broadcast-1")
    expect(detail).toMatchObject({ kind: "platform_broadcast", sender: { nickname: "Synapse" }, toAddresses: [{ name: "所有用户" }], recipients: [], team: null })
    vi.spyOn(service, "getMessage").mockResolvedValue(detail)
    await expect(service.createPreview("reader", {
      toIds: ["teammate"], ccIds: [], subject: "回复：版本更新", body: "正文", attachmentIds: [], forwardAttachmentIds: [],
      relation: { kind: "reply", messageId: "broadcast-1" },
    })).rejects.toThrow("平台公告不能回复或转发")
  })

  it("retries a platform mail reminder with the system sender label", async () => {
    const { service, prisma, notifications } = harness()
    prisma.mailNotificationOutbox.findMany.mockResolvedValueOnce([{
      id: "outbox-platform", messageId: "broadcast-1", recipientId: "reader", message: { sender: null },
    }] as never)
    await service.retryPendingNotifications()
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "reader", source: "mail", sourceKey: "mail:broadcast-1", body: "来自 Synapse。" }))
    expect(prisma.mailNotificationOutbox.deleteMany).toHaveBeenCalledWith({ where: { id: "outbox-platform" } })
  })

  it("filters unread inbox mail and counts only the current user's visible copies", async () => {
    const { service, prisma } = harness()
    prisma.mailRecipient.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2)
    prisma.mailMessage.count.mockResolvedValueOnce(3)
    await service.listMessages("reader", "inbox", "", undefined, true)
    expect(prisma.mailMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ recipients: { some: { userId: "reader", deletedAt: null, readAt: null } } }) }))
    expect(await service.countMessages("reader")).toEqual({ inboxTotal: 5, sentTotal: 3, unread: 2 })
    expect(prisma.mailRecipient.count).toHaveBeenCalledWith({ where: { userId: "reader", deletedAt: null, readAt: null } })
  })

  it("marks only visible unread inbox mail read", async () => {
    const { service, prisma } = harness()
    prisma.mailRecipient.updateMany.mockResolvedValueOnce({ count: 2 })
    expect(await service.readAllMessages("reader")).toEqual({ updated: 2 })
    expect(prisma.mailRecipient.updateMany).toHaveBeenCalledWith({ where: { userId: "reader", deletedAt: null, readAt: null }, data: { readAt: expect.any(Date) } })
  })

  it("deletes selected visible copies and reports inaccessible or already-deleted IDs", async () => {
    const { service, prisma } = harness()
    prisma.mailRecipient.findMany.mockResolvedValueOnce([{ messageId: "received" }])
    prisma.mailMessage.findMany.mockResolvedValueOnce([{ id: "sent" }] as never)
    const result = await service.deleteMessages("reader", ["received", "sent", "other"])
    expect(result).toEqual({ deleted: 2, skippedIds: ["other"] })
    expect(prisma.mailRecipient.updateMany).toHaveBeenCalledWith({ where: { userId: "reader", messageId: { in: ["received", "sent", "other"] }, deletedAt: null }, data: { deletedAt: expect.any(Date) } })
    expect(prisma.mailMessage.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["received", "sent", "other"] }, senderId: "reader", senderDeletedAt: null }, data: { senderDeletedAt: expect.any(Date) } })
    expect(await service.deleteMessages("reader", ["received", "sent", "other"])).toEqual({ deleted: 0, skippedIds: ["received", "sent", "other"] })
  })

  it("clears inbox and sent mail separately for the current user", async () => {
    const { service, prisma } = harness()
    prisma.mailRecipient.updateMany.mockResolvedValueOnce({ count: 4 })
    prisma.mailMessage.updateMany.mockResolvedValueOnce({ count: 3 })
    expect(await service.deleteAllMessages("reader", "inbox")).toEqual({ deleted: 4 })
    expect(await service.deleteAllMessages("reader", "sent")).toEqual({ deleted: 3 })
    expect(prisma.mailRecipient.updateMany).toHaveBeenCalledWith({ where: { userId: "reader", deletedAt: null }, data: { deletedAt: expect.any(Date) } })
    expect(prisma.mailMessage.updateMany).toHaveBeenCalledWith({ where: { senderId: "reader", senderDeletedAt: null }, data: { senderDeletedAt: expect.any(Date) } })
  })
  it("stores a directly uploaded file without a Drive source", async () => {
    const { service, prisma, storage } = harness()
    const body = Buffer.from("local file")
    const result = await service.prepareLocalAttachment("sender", "report.txt", "application/octet-stream", body)
    expect(storage.put).toHaveBeenCalledWith(expect.stringMatching(/^mail\/attachments\/[a-f0-9-]+$/u), body, "application/octet-stream")
    expect(prisma.mailAttachment.create).toHaveBeenCalledWith({ data: {
      ownerId: "sender", fileName: "report.txt", mimeType: "application/octet-stream", size: BigInt(body.length), storageKey: expect.stringMatching(/^mail\/attachments\/[a-f0-9-]+$/u),
    } })
    expect(result).toMatchObject({ attachmentId: "attachment-1", state: "ready" })
    expect(result).not.toHaveProperty("versionId")
  })

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
    const preview = await service.createPreview("sender", { toIds: ["teammate"], ccIds: [], subject: "报告", body: "完整正文", attachmentIds: [], forwardAttachmentIds: [] })
    expect(preview).toMatchObject({ previewId: "preview-1", recipients: [{ userId: "teammate" }], subject: "报告", body: "完整正文", attachments: [] })
  })

  it("stores To and Cc separately and gives To priority for overlap", async () => {
    const { service, prisma } = harness()
    prisma.user.findMany.mockResolvedValueOnce([
      { id: "sender", nickname: "李杨", handle: "liyang", teamMemberships: [{ teamId: "team-1" }] },
      { id: "teammate", nickname: "王明", handle: "wangming", teamMemberships: [{ teamId: "team-1" }] },
      { id: "observer", nickname: "小陈", handle: "chen", teamMemberships: [{ teamId: "team-1" }] },
    ] as never)
    const preview = await service.createPreview("sender", { toIds: ["teammate"], ccIds: ["observer"], subject: "报告", body: "正文", attachmentIds: [], forwardAttachmentIds: [] })
    expect(preview.toRecipients).toEqual([expect.objectContaining({ userId: "teammate" })])
    expect(preview.ccRecipients).toEqual([expect.objectContaining({ userId: "observer" })])
    expect(prisma.mailSendPreview.create).toHaveBeenCalledWith({ data: expect.objectContaining({ recipientIds: ["teammate", "observer"], ccIds: ["observer"], formatVersion: 2 }) })
    const overlapped = await service.createPreview("sender", { toIds: ["teammate"], ccIds: ["teammate"], subject: "报告", body: "正文", attachmentIds: [], forwardAttachmentIds: [] })
    expect(overlapped.ccRecipients).toEqual([])
  })

  it("copies selected forward attachments and keeps a fixed source quote", async () => {
    const { service, prisma, storage } = harness()
    vi.spyOn(service, "getMessage").mockResolvedValue({ messageId: "original", conversationId: "old-conversation", sender: { userId: "teammate", nickname: "王明", handle: "wangming" }, toRecipients: [{ userId: "sender", nickname: "李杨", handle: "liyang" }], ccRecipients: [], subject: "原信", body: "原文", sentAt: new Date("2026-09-28T00:00:00Z"), team: { id: "team-1", name: "团队一" }, attachments: [{ attachmentId: "source-file", fileName: "report.txt", size: 20 }] } as never)
    prisma.mailAttachment.findFirst.mockResolvedValueOnce({ id: "source-file", messageId: "original", fileName: "report.txt", mimeType: "text/plain", size: 20n, storageKey: "mail/attachments/source" } as never)
    prisma.mailAttachment.updateMany.mockResolvedValueOnce({ count: 1 })
    const preview = await service.createPreview("sender", { toIds: ["teammate"], ccIds: [], subject: "转发：原信", body: "", attachmentIds: [], forwardAttachmentIds: ["source-file"], relation: { kind: "forward", messageId: "original" } })
    expect(storage.copy).toHaveBeenCalledWith("mail/attachments/source", expect.stringMatching(/^mail\/attachments\//u), "text/plain")
    expect(preview.quote).toMatchObject({ subject: "原信", body: "原文" })
    expect(prisma.mailSendPreview.create).toHaveBeenCalledWith({ data: expect.objectContaining({ forwardOfId: "original", replyToId: null, quoteSnapshot: expect.objectContaining({ body: "原文" }) }) })
  })

  it("filters conversation pages by the current viewer's visible copies", async () => {
    const { service, prisma } = harness()
    vi.spyOn(service, "getMessage").mockResolvedValue({ conversationId: "conversation-1" } as never)
    const page = await service.listContext("reader", "message-1")
    expect(page).toEqual({ items: [], nextCursor: null })
    expect(prisma.mailMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ conversationId: "conversation-1", OR: [{ senderId: "reader", senderDeletedAt: null }, { recipients: { some: { userId: "reader", deletedAt: null } } }] }) }))
  })

  it("reads the stored quote without loading a deleted source message", async () => {
    const { service, prisma } = harness()
    const quote = { sender: { userId: "teammate", nickname: "王明", handle: "wangming" }, toRecipients: [{ userId: "sender", nickname: "李杨", handle: "liyang" }], ccRecipients: [], subject: "原信", body: "固定原文", sentAt: "2026-09-27T00:00:00.000Z" }
    prisma.mailMessage.findFirst.mockResolvedValueOnce({
      id: "reply-1", senderId: "sender", sender: { id: "sender", nickname: "李杨", handle: "liyang" },
      recipients: [{ userId: "teammate", role: "to", readAt: null, user: { id: "teammate", nickname: "王明", handle: "wangming" } }],
      subject: "回复：原信", body: "回复正文", sentAt: new Date("2026-09-28T00:00:00Z"), attachments: [],
      conversationId: "conversation-1", teamIdSnapshot: "team-1", teamNameSnapshot: "团队一",
      replyToId: "deleted-original", forwardOfId: null, quoteSnapshot: quote,
    } as never)
    const result = await service.getMessage("sender", "reply-1")
    expect(result.quote).toEqual(quote)
    expect(prisma.mailMessage.findFirst).toHaveBeenCalledOnce()
  })

  it("rejects a recipient with no team in common", async () => {
    const { service, prisma, teammate } = harness()
    prisma.user.findMany.mockResolvedValueOnce([{ id: "sender", nickname: "李杨", handle: "liyang", teamMemberships: [{ teamId: "team-1" }] }, { ...teammate, teamMemberships: [{ teamId: "team-2" }] }])
    await expect(service.createPreview("sender", { toIds: ["teammate"], ccIds: [], subject: "报告", body: "正文", attachmentIds: [], forwardAttachmentIds: [] })).rejects.toThrow("同一团队")
    expect(prisma.mailSendPreview.create).not.toHaveBeenCalled()
  })

  it("rechecks membership when sending and never creates a message after removal", async () => {
    const { service, prisma, sender } = harness()
    prisma.user.findMany.mockResolvedValueOnce([sender] as never)
    await expect(service.send("sender", "preview-1", "request-1")).rejects.toThrow("收件人已失效")
    expect(prisma.mailMessage.create).not.toHaveBeenCalled()
  })

  it("refuses to send when the source became invisible after preview", async () => {
    const { service, prisma } = harness()
    prisma.mailSendPreview.findFirst.mockResolvedValueOnce({ id: "preview-1", userId: "sender", formatVersion: 2, teamIdSnapshot: "team-1", teamNameSnapshot: "团队一", recipientIds: ["teammate"], ccIds: [], attachmentIds: [], subject: "回复：报告", body: "收到", conversationId: "conversation-1", quoteSnapshot: { body: "原文" }, replyToId: "original", forwardOfId: null } as never)
    await expect(service.send("sender", "preview-1", "request-1")).rejects.toThrow("原信已不可用")
    expect(prisma.mailMessage.create).not.toHaveBeenCalled()
  })

  it("requires a fresh preview after it expires", async () => {
    const { service, prisma } = harness()
    prisma.mailSendPreview.findFirst.mockResolvedValueOnce(null as never)
    await expect(service.send("sender", "preview-1", "request-1")).rejects.toThrow("发送预览已过期")
    expect(prisma.mailMessage.create).not.toHaveBeenCalled()
  })

  it("persists Cc roles and notifies both recipient groups once", async () => {
    const { service, prisma } = harness()
    prisma.user.findMany.mockResolvedValueOnce([
      { id: "sender", nickname: "李杨", handle: "liyang", teamMemberships: [{ teamId: "team-1" }] },
      { id: "teammate", nickname: "王明", handle: "wangming", teamMemberships: [{ teamId: "team-1" }] },
      { id: "observer", nickname: "小陈", handle: "chen", teamMemberships: [{ teamId: "team-1" }] },
    ] as never)
    prisma.mailSendPreview.findFirst.mockResolvedValueOnce({ id: "preview-1", userId: "sender", formatVersion: 2, teamIdSnapshot: "team-1", teamNameSnapshot: "团队一", recipientIds: ["teammate", "observer"], ccIds: ["observer"], attachmentIds: [], subject: "报告", body: "正文", conversationId: "conversation-1", quoteSnapshot: null, replyToId: null, forwardOfId: null } as never)
    await service.send("sender", "preview-1", "request-1")
    expect(prisma.mailRecipient.createMany).toHaveBeenCalledWith({ data: [{ messageId: "message-1", userId: "teammate", role: "to" }, { messageId: "message-1", userId: "observer", role: "cc" }] })
    expect(prisma.mailNotificationOutbox.createMany).toHaveBeenCalledWith({ data: [{ messageId: "message-1", recipientId: "teammate" }, { messageId: "message-1", recipientId: "observer" }] })
  })

  it("sends only once for the same preview and request key", async () => {
    const { service, prisma, notifications } = harness()
    await expect(service.send("sender", "preview-1", "request-1")).resolves.toMatchObject({ messageId: "message-1", recipientCount: 1 })
    expect(prisma.mailMessage.create).toHaveBeenCalledOnce()
    expect(prisma.mailNotificationOutbox.createMany).toHaveBeenCalledWith({ data: [{ messageId: "message-1", recipientId: "teammate" }] })
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "teammate", sourceKey: "mail:message-1", body: "来自 李杨。" }))
    prisma.mailMessage.findUnique.mockResolvedValueOnce({ id: "message-1", previewId: "preview-1", _count: { recipients: 1 }, sentAt: new Date() } as never)
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

  it("expands nested organizations at send time and deduplicates overlapping members", async () => {
    const { service, prisma, sender } = harness()
    const tree = [
      { id: "parent", teamId: "team-1", name: "开发中心", parentId: null },
      { id: "child", teamId: "team-1", name: "前端", parentId: "parent" },
      { id: "other", teamId: "team-1", name: "设计中心", parentId: null },
    ]
    prisma.organization.findMany.mockImplementation(async (query?: { where?: { id?: { in: string[] } } }) => query?.where?.id ? tree.filter((item) => query.where!.id!.in.includes(item.id)) : tree)
    prisma.organizationMembership.findMany.mockResolvedValueOnce([{ organizationId: "child", userId: "teammate" }]).mockResolvedValueOnce([
      { organizationId: "child", userId: "teammate" }, { organizationId: "other", userId: "teammate" }, { organizationId: "other", userId: "new-member" },
    ])
    prisma.user.findMany.mockResolvedValueOnce([sender] as never).mockResolvedValueOnce([sender] as never)
    const preview = await service.createPreview("sender", { formatVersion: 3, toIds: [], ccIds: [], toOrganizationIds: ["parent"], ccOrganizationIds: ["other"], subject: "通知", body: "正文", attachmentIds: [], forwardAttachmentIds: [] })
    expect(preview.recipientCount).toBe(1)
    expect(preview.toAddresses).toEqual([{ kind: "organization", organizationId: "parent", name: "开发中心" }])
    prisma.mailSendPreview.findFirst.mockResolvedValueOnce({ id: "preview-1", userId: "sender", formatVersion: 3, teamIdSnapshot: "team-1", teamNameSnapshot: "团队一", recipientIds: [], ccIds: [], toOrganizationIds: ["parent"], ccOrganizationIds: ["other"], attachmentIds: [], subject: "通知", body: "正文", conversationId: "conversation-1", quoteSnapshot: null, replyToId: null, forwardOfId: null } as never)
    const result = await service.send("sender", "preview-1", "request-1")
    expect(result.recipientCount).toBe(2)
    expect(prisma.mailRecipient.createMany).toHaveBeenCalledWith({ data: [
      { messageId: "message-1", userId: "teammate", role: "to" },
      { messageId: "message-1", userId: "new-member", role: "cc" },
    ] })
    expect(prisma.mailMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ addressSnapshot: { to: [{ kind: "organization", organizationId: "parent", name: "开发中心" }], cc: [{ kind: "organization", organizationId: "other", name: "设计中心" }] } }) })
  })

  it("allows more than fifty direct recipients", async () => {
    const { service, prisma, sender } = harness()
    const users = Array.from({ length: 60 }, (_, index) => ({ id: `person-${index}`, nickname: `成员${index}`, handle: `member${index}`, teamMemberships: [{ teamId: "team-1" }] }))
    prisma.user.findMany.mockResolvedValueOnce([sender, ...users] as never)
    const preview = await service.createPreview("sender", { formatVersion: 3, toIds: users.map((user) => user.id), ccIds: [], toOrganizationIds: [], ccOrganizationIds: [], subject: "通知", body: "正文", attachmentIds: [], forwardAttachmentIds: [] })
    expect(preview.recipientCount).toBe(60)
  })

  it("gives To priority when the same person is selected in both address fields", async () => {
    const { service, prisma } = harness()
    const preview = await service.createPreview("sender", { formatVersion: 3, toIds: ["teammate"], ccIds: ["teammate"], toOrganizationIds: [], ccOrganizationIds: [], subject: "通知", body: "正文", attachmentIds: [], forwardAttachmentIds: [] })
    expect(preview.recipientCount).toBe(1)
    expect(preview.ccAddresses).toEqual([])
    prisma.mailSendPreview.findFirst.mockResolvedValueOnce({ id: "preview-1", userId: "sender", formatVersion: 3, teamIdSnapshot: "team-1", teamNameSnapshot: "团队一", recipientIds: ["teammate"], ccIds: ["teammate"], toOrganizationIds: [], ccOrganizationIds: [], attachmentIds: [], subject: "通知", body: "正文", conversationId: "conversation-1", quoteSnapshot: null, replyToId: null, forwardOfId: null } as never)
    await service.send("sender", "preview-1", "request-1")
    expect(prisma.mailRecipient.createMany).toHaveBeenCalledWith({ data: [{ messageId: "message-1", userId: "teammate", role: "to" }] })
  })

  it("rejects sending when a previewed organization has been deleted", async () => {
    const { service, prisma } = harness()
    prisma.organization.findMany.mockResolvedValueOnce([])
    prisma.mailSendPreview.findFirst.mockResolvedValueOnce({ id: "preview-1", userId: "sender", formatVersion: 3, teamIdSnapshot: "team-1", teamNameSnapshot: "团队一", recipientIds: [], ccIds: [], toOrganizationIds: ["deleted"], ccOrganizationIds: [], attachmentIds: [], subject: "通知", body: "正文", conversationId: "conversation-1", quoteSnapshot: null, replyToId: null, forwardOfId: null } as never)
    await expect(service.send("sender", "preview-1", "request-1")).rejects.toThrow("组织已失效")
    expect(prisma.mailMessage.create).not.toHaveBeenCalled()
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

  it("keeps an old attachment referenced by an active send preview", async () => {
    const { service, prisma, storage } = harness()
    prisma.mailAttachment.findMany.mockResolvedValueOnce([{ id: "attachment-1", ownerId: "sender", storageKey: "mail/attachments/object-1", lastReferencedAt: new Date("2026-09-01") }] as never)
    prisma.mailSendPreview.findMany.mockResolvedValueOnce([{ attachmentIds: ["attachment-1"] }] as never)
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
})
