import { expect, it } from "vitest"
import { InternalMailReceiptSource } from "../internal-source"
import type { MailTriggerContext } from "../types"

const ctx: MailTriggerContext = { identity: { ownerId: "owner", apiOrigin: "https://synapse.test" }, generation: 1, signal: new AbortController().signal }
it("carries a fixed pagination watermark and excludes notification state", async () => {
  const queries: unknown[] = []
  const source = new InternalMailReceiptSource({ assertCurrent: () => undefined,
    checkpoint: async () => ({ receiptSequence: "20", serverTime: "2026-11-05T00:00:00Z" }),
    changes: async (_ctx, input) => { queries.push(input); return { items: [{ messageId: "new", receiptSequence: "21", sentAt: "2026-11-04T00:00:00Z" }], nextAfter: "21", through: "30", complete: false } },
    read: async () => { throw new Error("not requested") },
  })
  const [boundary] = await source.prepare(ctx)
  const page = await source.scan(ctx, boundary!, "20", 50)
  expect(page.receipts[0]?.messageId).toBe("new")
  await source.scan(ctx, boundary!, page.nextCursor, 50)
  expect(queries).toEqual([{ after: "20", limit: 50 }, { after: "21", through: "30", limit: 50 }])
})
it("rejects a stale identity after a late checkpoint response", async () => {
  let current = true
  const source = new InternalMailReceiptSource({ assertCurrent: () => { if (!current) throw new Error("身份已变化") },
    checkpoint: async () => { current = false; return { receiptSequence: "20", serverTime: "2026-11-05T00:00:00Z" } },
    changes: async () => { throw new Error("not requested") }, read: async () => { throw new Error("not requested") } })
  await expect(source.prepare(ctx)).rejects.toThrow("身份已变化")
})
