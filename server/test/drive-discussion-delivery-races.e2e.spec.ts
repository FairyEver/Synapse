import "reflect-metadata"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { DriveDiscussionNotificationOutbox } from "../src/drive/drive-discussion-notification-outbox"
import { discussionFixture, discussionLatch } from "./drive-discussion-fixture"

describe("drive discussion PostgreSQL delivery races", () => {
  let f: Awaited<ReturnType<typeof discussionFixture>>
  let outbox: DriveDiscussionNotificationOutbox
  beforeAll(async () => { f = await discussionFixture(); outbox = new DriveDiscussionNotificationOutbox(f.prisma as never, f.notifications, f.discussion) })
  afterAll(async () => { if (f) await f.cleanup() })
  async function delivery() {
    const root = await f.messages.create(f.access, f.reader, "投递验收")
    return f.prisma.driveDiscussionNotificationDelivery.findFirstOrThrow({ where: { notification: { sourceKey: "message:" + root.id } } })
  }
  it("two workers claim one delivery, without adding notification rows", async () => {
    const row = await delivery()
    const send = vi.spyOn(f.notifications, "deliverCommitted").mockResolvedValue(undefined)
    const second = new DriveDiscussionNotificationOutbox(f.prisma as never, f.notifications, f.discussion)
    const now = new Date()
    await Promise.all([outbox.deliverIds([row.notificationId], now), second.deliverIds([row.notificationId], now)])
    expect(send).toHaveBeenCalledTimes(1)
    expect((await f.prisma.driveDiscussionNotificationDelivery.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("delivered")
    expect(await f.prisma.userNotification.count({ where: { id: row.notificationId } })).toBe(1)
    send.mockRestore()
  })
  it("an old lease cannot complete after another worker owns the token", async () => {
    const row = await delivery(), held = discussionLatch(), release = discussionLatch()
    const send = vi.spyOn(f.notifications, "deliverCommitted").mockImplementation(async () => { held.release(); await release.promise })
    try {
      const sending = outbox.deliverIds([row.notificationId], new Date())
      await held.promise
      await f.prisma.driveDiscussionNotificationDelivery.update({ where: { id: row.id }, data: { leaseToken: "new-worker", leaseUntil: new Date(Date.now() + 60000) } })
      release.release(); await sending
      const latest = await f.prisma.driveDiscussionNotificationDelivery.findUniqueOrThrow({ where: { id: row.id } })
      expect(latest.status).toBe("pending"); expect(latest.leaseToken).toBe("new-worker")
    } finally { release.release(); send.mockRestore() }
  })
  it("reading after a failed attempt prevents later external delivery", async () => {
    const row = await delivery()
    const send = vi.spyOn(f.notifications, "deliverCommitted").mockRejectedValueOnce(new Error("transient"))
    await outbox.deliverIds([row.notificationId], new Date())
    const retry = await f.prisma.driveDiscussionNotificationDelivery.findUniqueOrThrow({ where: { id: row.id } })
    expect(retry.status).toBe("pending")
    await f.notifications.markRead(f.owner, row.notificationId)
    await outbox.deliverIds([row.notificationId], retry.nextAttemptAt)
    expect(send).toHaveBeenCalledTimes(1)
    expect((await f.prisma.driveDiscussionNotificationDelivery.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("skipped")
    send.mockRestore()
  })
})
