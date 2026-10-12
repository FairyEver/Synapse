import type { DriveDiscussionNotificationDelivery } from "@prisma/client"
import { afterEach, describe, expect, it, vi } from "vitest"

const now = new Date("2099-06-02T09:00:00Z")

async function harness(createdAt: Date, onDelivery: (id: string, signal?: AbortSignal) => void | Promise<void>, onRead?: () => void, read = false) {
  const rows: DriveDiscussionNotificationDelivery[] = ["first", "second"].map((id) => ({
    id, userId: "owner", notificationId: id,
    status: "pending", attempts: 0, nextAttemptAt: now, leaseUntil: null, leaseToken: null,
    failureReason: null, createdAt, updatedAt: now,
  }))
  type Update = { where: { id: string; leaseToken?: string | null; status?: string; leaseUntil?: { gt: Date } }; data: Partial<DriveDiscussionNotificationDelivery> }
  const updateMany = async ({ where, data }: Update) => {
    const row = rows.find((item) => item.id === where.id && item.leaseToken === where.leaseToken
      && (!where.status || item.status === where.status)
      && (!where.leaseUntil || (item.leaseUntil && item.leaseUntil > where.leaseUntil.gt)))
    if (!row) return { count: 0 }
    Object.assign(row, data)
    return { count: 1 }
  }
  const tx = {
    $queryRaw: async (query: { values: unknown[] }) => {
      const at = query.values[0] as Date
      const ids = query.values.filter((v): v is string => typeof v === "string")
      return rows.filter((row) => row.status === "pending" && row.nextAttemptAt <= at && (!row.leaseUntil || row.leaseUntil <= at) && (!ids.length || ids.includes(row.notificationId))).map((row) => ({ ...row }))
    },
    driveDiscussionNotificationDelivery: { update: async ({ where, data }: { where: { id: string }; data: { leaseUntil: Date; leaseToken: string } }) => {
      const row = rows.find((item) => item.id === where.id)!
      Object.assign(row, { leaseUntil: data.leaseUntil, leaseToken: data.leaseToken, attempts: row.attempts + 1 })
      return { ...row }
    } },
  }
  const prisma = {
    $transaction: async (work: (transaction: typeof tx) => unknown) => work(tx),
    driveDiscussionNotificationDelivery: { updateMany },
    userNotification: { findFirst: async () => { onRead?.(); return { readAt: read ? now : null, deletedAt: null } } },
  }
  const sent: string[] = []
  const notifications = { deliverCommitted: async (_userId: string, id: string, signal?: AbortSignal) => { sent.push(id); await onDelivery(id, signal) } }
  const { DriveDiscussionNotificationOutbox } = await import("./drive-discussion-notification-outbox.js")
  return { rows, sent, outbox: new DriveDiscussionNotificationOutbox(prisma as never, notifications as never, { setDeliverySink: () => undefined } as never) }
}

afterEach(() => { vi.useRealTimers() })

describe("Drive discussion delivery", () => {
  it("skips read notifications without sending a delayed banner", async () => {
    const { outbox, rows, sent } = await harness(now, () => undefined, undefined, true)
    await outbox.deliverPending(now)
    expect(sent).toEqual([])
    expect(rows.map((row) => row.status)).toEqual(["skipped", "skipped"])
  })
  it("targets only the new IDs through the same leased path", async () => {
    const { outbox, rows, sent } = await harness(now, () => undefined)
    await outbox.deliverIds(["second"], now)
    expect(sent).toEqual(["second"])
    expect(rows[0]?.status).toBe("pending")
    expect(rows[1]?.status).toBe("delivered")
  })

  it("starts at a minute and caps at fifteen minutes", async () => {
    const { driveDiscussionRetryDelay } = await import("./drive-discussion-notification-outbox.js")
    expect([1, 2, 3, 10, 30].map(driveDiscussionRetryDelay)).toEqual([60000, 120000, 240000, 900000, 900000])
  })
  it("stops sending when an earlier delivery crosses the 24-hour window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(now)
    const { outbox, rows, sent } = await harness(new Date(now.getTime() - 86400000 + 1000), () => {
      vi.setSystemTime(new Date(now.getTime() + 2000))
    })
    await outbox.deliverPending(now)
    expect(sent).toEqual(["first"])
    expect(rows[1]).toMatchObject({ status: "expired", failureReason: "DELIVERY_WINDOW_EXPIRED" })
  })
  it("does not send a later record whose lease another worker reclaimed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(now)
    const { outbox, rows, sent } = await harness(now, () => {
      vi.setSystemTime(new Date(now.getTime() + 70000))
      rows[1]!.leaseToken = "another-worker"
      rows[1]!.leaseUntil = new Date(now.getTime() + 130000)
    })
    await outbox.deliverPending(now)
    expect(sent).toEqual(["first"])
    expect(rows[1]).toMatchObject({ status: "pending", leaseToken: "another-worker" })
  })
  it("checks the delivery window after a slow notification query", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now)
    const { outbox, rows, sent } = await harness(new Date(now.getTime() - 86400000 + 1000), () => undefined, () => {
      vi.setSystemTime(new Date(now.getTime() + 2000))
    })
    await outbox.deliverPending(now)
    expect(sent).toEqual([])
    expect(rows.map((row) => row.status)).toEqual(["expired", "expired"])
  })
  it("keeps a current delivery leased while more than a minute elapses", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { outbox, rows, sent } = await harness(now, () => new Promise<void>((resolve) => setTimeout(resolve, 70000)))
    rows.pop()
    const first = outbox.deliverPending(now)
    await vi.advanceTimersByTimeAsync(65000)
    const otherWorker = outbox.deliverPending(new Date())
    await vi.advanceTimersByTimeAsync(10000)
    expect(sent).toEqual(["first"])
    await Promise.all([first, otherWorker])
    expect(rows[0]?.status).toBe("delivered")
  })
  it("aborts an in-flight delivery when it loses ownership of the lease", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { outbox, rows } = await harness(now, (_id, signal) => new Promise<void>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("lease lost")), { once: true })
    }))
    rows.pop()
    let finished = false
    const delivery = outbox.deliverPending(now).then(() => { finished = true })
    await vi.advanceTimersByTimeAsync(0)
    rows[0]!.leaseToken = "another-worker"
    await vi.advanceTimersByTimeAsync(30000)
    expect(finished).toBe(true)
    await delivery
    expect(rows[0]).toMatchObject({ status: "pending", leaseToken: "another-worker" })
  })
  it("cancels downstream delivery when its 24-hour window expires", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { outbox, rows } = await harness(new Date(now.getTime() - 86400000 + 1000), (_id, signal) => new Promise<void>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("delivery window expired")), { once: true })
    }))
    rows.pop()
    let finished = false
    const delivery = outbox.deliverPending(now).then(() => { finished = true })
    await vi.advanceTimersByTimeAsync(1500)
    expect(finished).toBe(true)
    await delivery
    expect(rows[0]).toMatchObject({ status: "expired", failureReason: "DELIVERY_WINDOW_EXPIRED" })
  })
})
