import { describe, expect, it, vi } from "vitest"
import { AdminMailService } from "./admin-mail.service"

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "mail-1",
    senderId: "user-1",
    sender: { id: "user-1", email: "ada@example.com", handle: "ada", nickname: "Ada" },
    kind: "user",
    teamIdSnapshot: "team-1",
    teamNameSnapshot: "平台团队",
    subject: "主题",
    body: "正文",
    conversationId: "conversation-1",
    replyToId: null,
    forwardOfId: null,
    quoteSnapshot: null,
    addressSnapshot: { to: [{ kind: "user", userId: "user-2", name: "Bob" }], cc: [{ kind: "organization", organizationId: "org-1", name: "研发组" }] },
    senderDeletedAt: null,
    sentAt: new Date("2026-10-01T00:00:00.000Z"),
    recipients: [
      { readAt: new Date("2026-10-01T01:00:00.000Z"), deletedAt: null },
      { readAt: null, deletedAt: new Date("2026-10-01T02:00:00.000Z") },
    ],
    attachments: [{ id: "attachment-1", fileName: "a.txt", mimeType: "text/plain", size: BigInt(12), storageKey: "private-key" }],
    _count: { recipients: 2, attachments: 1 },
    ...overrides,
  }
}

function fixture() {
  const prisma = {
    mailMessage: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (queries: unknown[]) => Promise.all(queries as Promise<unknown>[])),
  }
  return { prisma, service: new AdminMailService(prisma as never) }
}

describe("AdminMailService", () => {
  it("includes soft-deleted and invisible messages without changing mailbox state", async () => {
    const { prisma, service } = fixture()
    prisma.mailMessage.findMany.mockResolvedValue([
      detailRow({ senderDeletedAt: new Date(), recipients: [], _count: { recipients: 0, attachments: 0 } }),
      detailRow({ id: "broadcast-1", kind: "platform_broadcast", sender: null }),
    ])
    prisma.mailMessage.count.mockResolvedValue(2)
    const result = await service.listMessages({ page: 2, pageSize: 10, sortBy: "subject", sortOrder: "asc" }, {})
    expect(result.data.map((message) => message.messageId)).toEqual(["mail-1", "broadcast-1"])
    expect(prisma.mailMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {}, skip: 10, take: 10, orderBy: [{ subject: "asc" }, { id: "asc" }] }))
  })

  it("searches saved organization and recipient names without expanding membership", async () => {
    const { prisma, service } = fixture()
    prisma.$queryRaw.mockResolvedValue([{ id: "mail-1" }])
    prisma.mailMessage.findMany.mockResolvedValue([])
    prisma.mailMessage.count.mockResolvedValue(0)
    await service.listMessages({ page: 1, pageSize: 20, sortBy: "sentAt", sortOrder: "desc" }, { search: "旧组织" })
    expect(prisma.mailMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: expect.arrayContaining([{ id: { in: ["mail-1"] } }]) }) }))
  })

  it("lists all persisted messages with filters and redacted attachment storage data", async () => {
    const { prisma, service } = fixture()
    prisma.mailMessage.findMany.mockResolvedValue([detailRow()])
    prisma.mailMessage.count.mockResolvedValue(1)

    await expect(service.listMessages(
      { page: 1, pageSize: 20, sortBy: "sentAt", sortOrder: "desc" },
      { search: "Ada", kind: "user", teamId: "team-1", from: "2026-10-01", to: "2026-10-02" },
    )).resolves.toMatchObject({
      total: 1,
      data: [{ messageId: "mail-1", subject: "主题", recipientCount: 2, attachmentCount: 1 }],
    })

    expect(prisma.mailMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        kind: "user",
        teamIdSnapshot: "team-1",
        sentAt: { gte: expect.any(Date), lt: expect.any(Date) },
        OR: expect.any(Array),
      }),
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    }))
  })

  it("returns platform messages and delivery statistics without attachment storage keys", async () => {
    const { prisma, service } = fixture()
    prisma.mailMessage.findUnique.mockResolvedValue(detailRow({
      id: "broadcast-1",
      senderId: null,
      sender: null,
      kind: "platform_broadcast",
      teamIdSnapshot: null,
      teamNameSnapshot: null,
      addressSnapshot: { to: [{ kind: "audience", name: "所有用户" }], cc: [] },
    }))

    const result = await service.getMessage("broadcast-1")
    expect(result.sender).toEqual({ userId: "platform", nickname: "Synapse", handle: null, email: null })
    expect(result.toAddresses).toEqual([{ kind: "audience", name: "所有用户" }])
    expect(result.delivery).toEqual({ recipientCount: 2, readCount: 1, deletedCount: 1, pendingCount: 0 })
    expect(result.attachments[0]).not.toHaveProperty("storageKey")
  })

  it("paginates a complete conversation independently of user visibility", async () => {
    const { prisma, service } = fixture()
    prisma.mailMessage.findUnique.mockResolvedValueOnce({ conversationId: "conversation-1" }).mockResolvedValueOnce(detailRow())
    prisma.mailMessage.findFirst.mockResolvedValue({ id: "mail-2", sentAt: new Date("2026-09-30T00:00:00.000Z") })
    prisma.mailMessage.findMany.mockResolvedValue([detailRow({ id: "mail-2", sentAt: new Date("2026-09-30T00:00:00.000Z") }), detailRow()])

    const result = await service.listContext("mail-1", "mail-2")
    expect(result.items.map((item) => item.messageId)).toEqual(["mail-1", "mail-2"])
    expect(prisma.mailMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ conversationId: "conversation-1" }),
    }))
  })

  it("returns a stable cursor for long conversations and rejects foreign cursors", async () => {
    const { prisma, service } = fixture()
    prisma.mailMessage.findUnique.mockResolvedValue({ conversationId: "conversation-1" })
    const rows = Array.from({ length: 51 }, (_, index) => detailRow({ id: `mail-${100 - index}` }))
    prisma.mailMessage.findMany.mockResolvedValue(rows)
    const first = await service.listContext("mail-100")
    expect(first.items).toHaveLength(50)
    expect(first.nextCursor).toBe("mail-51")
    expect(first.items[0]?.messageId).toBe("mail-51")
    prisma.mailMessage.findFirst.mockResolvedValue(null)
    await expect(service.listContext("mail-100", "another-conversation")).rejects.toThrow("无效的分页位置")
  })

  it("rejects invalid dates before querying persisted mail", async () => {
    const { prisma, service } = fixture()
    await expect(service.listMessages({ page: 1, pageSize: 20, sortBy: "sentAt", sortOrder: "desc" }, { from: "2026-02-30" })).rejects.toThrow("日期参数无效")
    expect(prisma.mailMessage.findMany).not.toHaveBeenCalled()
  })
})
