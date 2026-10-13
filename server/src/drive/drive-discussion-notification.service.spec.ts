import { afterEach, describe, expect, it, vi } from "vitest"
import type { DriveDiscussionEvent } from "./drive-discussion-notification.types"

afterEach(() => vi.unstubAllEnvs())
describe("Drive discussion notification persistence", () => {
  it("keeps one account record per event, filtering inactive accounts and retaining private origin only in the target", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const records = new Map<string, Record<string, unknown>>()
    const targets = new Map<string, Record<string, unknown>>()
    const deliveries = new Map<string, Record<string, unknown>>()
    const tx = {
      user: { findMany: async () => [{ id: "owner" }, { id: "starter" }] },
      userNotification: { update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign([...records.values()].find((r) => r.id === where.id)!, data) },
      driveDiscussionNotificationTarget: { upsert: async ({ where, create }: { where: { notificationId: string }; create: Record<string, unknown> }) => {
        if (!targets.has(where.notificationId)) targets.set(where.notificationId, { id: "t" + targets.size, ...create })
        return targets.get(where.notificationId)!
      } },
      driveDiscussionNotificationDelivery: { upsert: async ({ where, create }: { where: { notificationId: string }; create: Record<string, unknown> }) => {
        if (!deliveries.has(where.notificationId)) deliveries.set(where.notificationId, create)
        return deliveries.get(where.notificationId)!
      } },
    }
    const notifications = { createInTransaction: async (_tx: unknown, input: Record<string, unknown>) => {
      const key = input.userId + ":" + input.sourceKey
      if (!records.has(key)) records.set(key, { id: "n" + records.size, createdAt: new Date(), ...input })
      return records.get(key)!
    } }
    const { DriveDiscussionNotificationService } = await import("./drive-discussion-notification.service.js")
    const service = new DriveDiscussionNotificationService({} as never, notifications as never)
    const event: DriveDiscussionEvent = {
      kind: "message", action: "replied", item: { id: "doc", userId: "owner", name: "文档" },
      actor: { userId: "actor", handle: "李四" }, body: "建议",
      root: { id: "m1", author: { userId: "starter", sourceShareId: "secret-reference" } },
      replyTo: { authorName: "原作者", content: "原留言" }, targetCommentId: "c1", directlyRepliedTo: { userId: "disabled", sourceShareId: "old" },
    }
    await service.enqueue(tx as never, event)
    await service.enqueue(tx as never, { ...event, body: "随后修改", replyTo: { authorName: "改名", content: "随后编辑" } })
    expect(records.size).toBe(2)
    expect(targets.size).toBe(2)
    expect(deliveries.size).toBe(2)
    expect([...records.values()].map((r) => r.userId).sort()).toEqual(["owner", "starter"])
    expect([...records.values()].every((r) => r.source === "drive-discussion" && String(r.url).startsWith("https://synapse.test/notifications/"))).toBe(true)
    expect([...targets.values()].find((r) => r.sourceShareId === "secret-reference")).toMatchObject({ itemId: "doc", messageId: "m1", commentId: "c1" })
    expect(JSON.stringify([...records.values()])).not.toContain("secret-reference")
    for (const target of targets.values()) expect(target).toMatchObject({ snapshot: { content: "建议", replyTo: { content: "原留言" } } })
  })
})
