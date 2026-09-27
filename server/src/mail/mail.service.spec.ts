import { describe, expect, it, vi } from "vitest"
import { MailService } from "./mail.service"
import { recipientMatch } from "./mail-recipient-match"

function harness() {
  const sender = { id: "sender", nickname: "李杨", handle: "liyang", teamMemberships: [{ teamId: "team-1" }] }
  const teammate = { id: "teammate", nickname: "王明", handle: "wangming", teamMemberships: [{ teamId: "team-1" }] }
  const prisma = {
    user: { findMany: vi.fn(async () => [sender, teammate]), count: vi.fn(async () => 2) },
    team: { findFirst: vi.fn(async () => ({ id: "team-1", name: "团队一" })) },
    mailAttachment: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0), updateMany: vi.fn(async () => ({ count: 0 })) },
    mailSendPreview: {
      create: vi.fn(async () => ({ id: "preview-1", expiresAt: new Date(Date.now() + 60_000) })),
      findFirst: vi.fn(async () => ({ id: "preview-1", userId: "sender", teamIdSnapshot: "team-1", teamNameSnapshot: "团队一", recipientIds: ["teammate"], attachmentIds: [], subject: "报告", body: "正文", replyToId: null })),
    },
    mailMessage: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "message-1", sentAt: new Date() })),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
  }
  const notifications = { create: vi.fn(async () => ({ id: "notice-1" })) }
  const service = new MailService(prisma as never, {} as never, {} as never, notifications as never)
  return { service, prisma, notifications, sender, teammate }
}

describe("MailService", () => {
  it("ranks exact recipients above fuzzy matches", () => {
    expect(recipientMatch("王明", ["王明", "wangming"])).toMatchObject({ matchKind: "exact", similarity: 1 })
    expect(recipientMatch("wangmong", ["王明", "wangming"])?.matchKind).toBe("fuzzy")
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
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "teammate", sourceKey: "mail:message-1" }))
    prisma.mailMessage.findUnique.mockResolvedValueOnce({ id: "message-1", previewId: "preview-1", recipients: [{ userId: "teammate" }], sentAt: new Date() } as never)
    await service.send("sender", "preview-1", "request-1")
    expect(prisma.mailMessage.create).toHaveBeenCalledOnce()
  })
})
