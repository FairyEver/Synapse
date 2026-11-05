import { expect, it, vi } from "vitest"
import { MailReceiptFeed } from "./mail-receipt-feed"

function fixture() {
  const order: string[] = []
  const prisma = {
    $executeRaw: vi.fn(async () => { order.push("lock"); return 1 }),
    $queryRaw: vi.fn(async () => [{ serverTime: new Date("2026-11-05T00:00:00Z") }]),
    mailRecipient: {
      aggregate: vi.fn(async () => { order.push("boundary"); return { _max: { deliverySequence: 20n } } }),
      findMany: vi.fn(async () => [{ deliverySequence: 21n, messageId: "new-message", message: { sentAt: new Date("2026-11-04T00:00:00Z") } }]),
    },
    $transaction: vi.fn(async (f: (tx: unknown) => Promise<unknown>) => f(prisma)),
  }
  return { prisma, order, feed: new MailReceiptFeed(prisma as never) }
}
it("confirms the receipt boundary after the commit fence and preserves sequence precision", async () => {
  const { feed, prisma, order } = fixture()
  expect(await feed.checkpoint("user")).toEqual({ receiptSequence: "20", serverTime: "2026-11-05T00:00:00.000Z" })
  expect(order.indexOf("boundary")).toBeGreaterThan(order.indexOf("lock"))
  expect(prisma.mailRecipient.aggregate).toHaveBeenCalledWith({ where: { userId: "user" }, _max: { deliverySequence: true } })
})
it("includes late committed receipts after the confirmed boundary regardless of sentAt", async () => {
  const { feed, prisma } = fixture()
  const page = await feed.changes("user", { after: "20", through: "25", limit: 1 })
  expect(page).toEqual({ items: [{ messageId: "new-message", receiptSequence: "21", sentAt: "2026-11-04T00:00:00.000Z" }], nextAfter: "25", through: "25", complete: true })
  expect(prisma.mailRecipient.findMany).toHaveBeenCalledWith({ where: { userId: "user", deletedAt: null, deliverySequence: { gt: 20n, lte: 25n } }, orderBy: { deliverySequence: "asc" }, take: 2, select: { deliverySequence: true, messageId: true, message: { select: { sentAt: true } } } })
})
it("returns an inclusive fixed scan watermark over multiple bounded pages", async () => {
  const { feed, prisma } = fixture()
  prisma.mailRecipient.findMany.mockResolvedValue([
    { deliverySequence: 21n, messageId: "a", message: { sentAt: new Date() } },
    { deliverySequence: 22n, messageId: "b", message: { sentAt: new Date() } },
  ])
  const page = await feed.changes("user", { after: "20", through: "25", limit: 1 })
  expect(page.items.map(x => x.messageId)).toEqual(["a"])
  expect(page.nextAfter).toBe("21")
  expect(page.complete).toBe(false)
})
it("rejects unbounded and invalid cursor requests before database access", async () => {
  const { feed, prisma } = fixture()
  for (const input of [{ after: "-1" }, { after: "1", through: "0" }, { after: "0", limit: 51 }, { after: "1.5" }]) await expect(feed.changes("user", input)).rejects.toThrow()
  expect(prisma.mailRecipient.findMany).not.toHaveBeenCalled()
})
