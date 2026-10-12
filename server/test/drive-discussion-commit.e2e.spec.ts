import "reflect-metadata"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { discussionFixture, discussionLatch } from "./drive-discussion-fixture"

describe("drive discussion PostgreSQL commit boundaries", () => {
  let f: Awaited<ReturnType<typeof discussionFixture>>
  beforeAll(async () => { f = await discussionFixture() })
  afterAll(async () => { if (f) await f.cleanup() })
  it("notification failure rolls back content, target, notification, and delivery", async () => {
    const failure = vi.spyOn(f.notifications, "createInTransaction").mockRejectedValueOnce(new Error("injected failure"))
    await expect(f.messages.create(f.access, f.reader, "不能提交")).rejects.toThrow("injected failure")
    failure.mockRestore()
    expect(await f.prisma.driveMessage.count({ where: { itemId: f.item.id } })).toBe(0)
    expect(await f.prisma.userNotification.count({ where: { userId: { in: f.users } } })).toBe(0)
    expect(await f.prisma.driveDiscussionNotificationTarget.count({ where: { itemId: f.item.id } })).toBe(0)
    expect(await f.prisma.driveDiscussionNotificationDelivery.count({ where: { userId: { in: f.users } } })).toBe(0)
  })
  it("same event keeps one record per recipient, with projected metadata and exact source filtering", async () => {
    const first = await f.messages.create(f.access, f.reader, "新留言", undefined, { keyHash: "test-" + f.item.id, requestHash: "same" })
    const replay = await f.messages.create(f.access, f.reader, "新留言", undefined, { keyHash: "test-" + f.item.id, requestHash: "same" })
    expect(replay.id).toBe(first.id)
    const reply = await f.messages.createComment(f.access, f.third, first.id, null, "新回复")
    expect(await f.prisma.userNotification.count({ where: { sourceKey: "message-comment:" + reply.id } })).toBe(2)
    await f.notifications.createInTransaction(f.prisma as never, { userId: f.owner, source: "external", sourceKey: "test:external", title: "已有通知", body: "摘要" })
    const page = await f.notifications.list(f.owner, { source: "drive-discussion" })
    expect(page.items).toHaveLength(2)
    expect(page.items.every((item) => item.source === "drive-discussion" && "driveDiscussion" in item && item.driveDiscussion)).toBe(true)
    expect(page.items.some((item) => "driveDiscussionTarget" in item)).toBe(false)
    expect(await f.notifications.unreadCount(f.owner)).toBe(3)
  })
  it.each(["delete-first", "reply-first"] as const)("reply/delete commit ordering: %s", async (order) => {
    const root = await f.messages.create(f.access, f.reader, "竞争根留言")
    const held = discussionLatch(), release = discussionLatch(), secondStarted = discussionLatch()
    const lock = f.discussion.withItemLock.bind(f.discussion)
    let calls = 0
    const spy = vi.spyOn(f.discussion, "withItemLock").mockImplementation(async (id, work) => {
      const index = ++calls
      if (index === 2) secondStarted.release()
      return lock(id, async (tx) => { if (index === 1) { held.release(); await release.promise } return work(tx) })
    })
    try {
      const first = order === "delete-first" ? f.messages.delete(f.access, f.owner, root.id) : f.messages.createComment(f.access, f.third, root.id, null, "竞争回复")
      await held.promise
      const second = order === "delete-first" ? f.messages.createComment(f.access, f.third, root.id, null, "竞争回复") : f.messages.delete(f.access, f.owner, root.id)
      const outcomes = Promise.allSettled([first, second])
      await secondStarted.promise; release.release()
      const results = await outcomes
      expect(results[0]?.status).toBe("fulfilled")
      expect(results[1]?.status).toBe(order === "delete-first" ? "rejected" : "fulfilled")
      const comments = await f.prisma.driveMessageComment.findMany({ where: { messageId: root.id } })
      expect(comments).toHaveLength(order === "delete-first" ? 0 : 1)
      if (order === "reply-first") {
        expect(comments[0]?.deletedAt).not.toBeNull()
        expect(await f.prisma.userNotification.count({ where: { sourceKey: "message-comment:" + comments[0]!.id } })).toBe(2)
      }
    } finally { release.release(); spy.mockRestore() }
  })
})
