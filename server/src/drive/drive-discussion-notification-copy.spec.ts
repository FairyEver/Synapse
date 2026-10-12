import { describe, expect, it } from "vitest"
import type { DriveDiscussionEvent } from "./drive-discussion-notification.types"

const event = {
  kind: "annotation", action: "replied", item: { id: "doc", userId: "owner", name: "需求方案" },
  actor: { userId: "fourth", handle: "王五" }, body: "**审核**\n步骤",
  root: { id: "thread", author: { userId: "starter", sourceShareId: "share" } },
  targetCommentId: "c2", directlyRepliedTo: { userId: "parent", sourceShareId: "share" },
} satisfies DriveDiscussionEvent

describe("Drive discussion recipients and copy", () => {
  it("notifies owner, starter and direct parent, without the actor", async () => {
    const { collectDriveDiscussionRecipients } = await import("./drive-discussion-notification-copy.js")
    expect(collectDriveDiscussionRecipients(event)).toEqual([
      { userId: "parent", sourceShareId: "share", role: "direct" },
      { userId: "starter", sourceShareId: "share", role: "starter" },
      { userId: "owner", sourceShareId: null, role: "owner" },
    ])
    expect(collectDriveDiscussionRecipients({ ...event, actor: { userId: "parent", handle: "李四" } }).map((r) => r.userId)).toEqual(["starter", "owner"])
  })
  it("deduplicates overlapping roles and uses the direct reply wording", async () => {
    const copy = await import("./drive-discussion-notification-copy.js")
    const overlap = { ...event, root: { ...event.root, author: { userId: "owner", sourceShareId: "s" } }, directlyRepliedTo: { userId: "owner", sourceShareId: "s" } }
    const recipients = copy.collectDriveDiscussionRecipients(overlap)
    expect(recipients).toHaveLength(1)
    expect(copy.buildDriveDiscussionNotificationCopy(overlap, recipients[0]!)).toMatchObject({
      title: "王五回复了你在《需求方案》中的评论", body: "审核 步骤", sourceKey: "drive:annotation-comment:c2",
    })
  })
  it.each([
    ["annotation", "created", "owner", "王五评论了《需求方案》"],
    ["message", "created", "owner", "王五在《需求方案》中留言"],
    ["annotation", "replied", "direct", "王五回复了你在《需求方案》中的评论"],
    ["message", "replied", "direct", "王五回复了你在《需求方案》中的留言"],
    ["annotation", "replied", "starter", "王五回复了你在《需求方案》中发起的讨论"],
    ["message", "replied", "starter", "王五回复了你在《需求方案》中发起的留言讨论"],
    ["annotation", "replied", "owner", "王五回复了《需求方案》中的评论"],
    ["message", "replied", "owner", "王五回复了《需求方案》中的留言"],
  ] as const)("personalizes %s %s for %s", async (kind, action, role, title) => {
    const copy = await import("./drive-discussion-notification-copy.js")
    expect(copy.buildDriveDiscussionNotificationCopy({ ...event, kind, action }, { userId: "recipient", sourceShareId: null, role }).title).toBe(title)
  })
  it("keeps a Unicode excerpt and title bounded without leaking markup", async () => {
    const copy = await import("./drive-discussion-notification-copy.js")
    const result = copy.buildDriveDiscussionNotificationCopy({ ...event, item: { ...event.item, name: "😀".repeat(150) }, actor: { ...event.actor, handle: "😀".repeat(40) }, body: "😀".repeat(150) }, { userId: "owner", role: "owner", sourceShareId: null })
    expect(Array.from(result.body)).toHaveLength(120)
    expect(result.body.endsWith("…")).toBe(true)
    expect(result.title.length).toBeLessThanOrEqual(64)
    expect(result.title).not.toMatch(/[\uD800-\uDBFF]$/u)
  })
  it("does not notify the owner about their own new root", async () => {
    const copy = await import("./drive-discussion-notification-copy.js")
    expect(copy.collectDriveDiscussionRecipients({ ...event, action: "created", actor: { userId: "owner", handle: "owner" } })).toEqual([])
  })
})
