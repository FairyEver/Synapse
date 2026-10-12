import { NotFoundException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { DriveService } from "./drive.service"

const target = { notificationId: "n-1", itemId: "file", kind: "annotation", action: "replied", threadId: "thread", commentId: "reply", messageId: null, sourceShareId: "original" }
async function resolver(record: unknown) {
  const prisma = { userNotification: { findFirst: vi.fn(async () => record) } }
  const drive = { getDiscussionBrowserUrl: vi.fn(async () => "/share/original/file") }
  const { DriveDiscussionNotificationTargetService } = await import("./drive-discussion-notification-target.service.js")
  return { service: new DriveDiscussionNotificationTargetService(prisma as never, drive as never), prisma, drive }
}
describe("protected discussion notification target", () => {
  it("rejects other accounts and deleted or non-discussion notifications", async () => {
    const { service, prisma, drive } = await resolver(null)
    await expect(service.resolve("other", "n-1")).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.userNotification.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "n-1", userId: "other", deletedAt: null, source: "drive-discussion" } }))
    expect(drive.getDiscussionBrowserUrl).not.toHaveBeenCalled()
  })
  it("uses only stored IDs and origin, then appends the exact reply", async () => {
    const { service, drive } = await resolver({ driveDiscussionTarget: target })
    expect(await service.resolve("reader", "n-1")).toEqual({ status: "ready", browserUrl: "/share/original/file#discussion=annotation&threadId=thread&commentId=reply" })
    expect(drive.getDiscussionBrowserUrl).toHaveBeenCalledWith({ userId: "reader", itemId: "file", sourceShareId: "original" })
  })
  it("returns the same unavailable state for inaccessible content", async () => {
    const { service, drive } = await resolver({ driveDiscussionTarget: target })
    drive.getDiscussionBrowserUrl.mockResolvedValue(null as never)
    expect(await service.resolve("reader", "n-1")).toEqual({ status: "unavailable", message: "文档已删除或无法访问" })
  })
})

function browserAccess(item: unknown, share: unknown, contained = true) {
  const prisma = { driveItem: { findFirst: vi.fn(async () => item) }, driveShare: { findFirst: vi.fn(async () => share) } }
  const service = Object.create(DriveService.prototype) as DriveService
  Object.assign(service, { prisma, resolveShareBrowserCurrent: vi.fn(async () => {
    if (!contained) throw new NotFoundException()
    return { root: { id: "folder" }, current: item }
  }) })
  return { service, prisma }
}
const file = { id: "file", userId: "owner", name: "a.md", type: "file", size: 1n, storageKey: "file", mimeType: "text/markdown", deletedAt: null, storageStatus: "active", lifecycleStatus: "active", createdAt: new Date(), updatedAt: new Date(), shares: [] }
describe("discussion browser access", () => {
  it("owners use their private entry without a share", async () => {
    const { service, prisma } = browserAccess(file, null)
    expect(await service.getDiscussionBrowserUrl({ userId: "owner", itemId: "file", sourceShareId: null })).toBe("/drive/items/file")
    expect(prisma.driveShare.findFirst).not.toHaveBeenCalled()
  })
  it("legacy missing origins never look for a replacement", async () => {
    const { service, prisma } = browserAccess(null, null)
    expect(await service.getDiscussionBrowserUrl({ userId: "reader", itemId: "file", sourceShareId: null })).toBeNull()
    expect(prisma.driveShare.findFirst).not.toHaveBeenCalled()
  })
  it("only queries the original enabled, unexpired share", async () => {
    const share = { id: "original", shareId: "public-id", accessMode: "link_read", item: { ...file, id: "folder", type: "folder" }, passwordEnabled: true }
    const { service, prisma } = browserAccess(null, share)
    // Owners lookup returns null; shared containment independently returns the selected file.
    Object.assign(service, { resolveShareBrowserCurrent: vi.fn(async () => ({ root: { id: "folder" }, current: file })) })
    expect(await service.getDiscussionBrowserUrl({ userId: "reader", itemId: "file", sourceShareId: "original" })).toBe("/share/public-id/items/file")
    expect(prisma.driveShare.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "original", enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] }) }))
  })
  it.each(["disabled", "expired", "missing-root"])("%s share cannot open", async () => {
    const { service } = browserAccess(null, null)
    expect(await service.getDiscussionBrowserUrl({ userId: "reader", itemId: "file", sourceShareId: "original" })).toBeNull()
  })
  it("a child moved out of the original share cannot open", async () => {
    const { service } = browserAccess(null, { id: "original", shareId: "public-id", accessMode: "link_read", item: { ...file, id: "folder", type: "folder" } }, false)
    expect(await service.getDiscussionBrowserUrl({ userId: "reader", itemId: "file", sourceShareId: "original" })).toBeNull()
  })
})
