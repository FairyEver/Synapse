import { describe, expect, it } from "vitest"
import { CloudTableScheduler } from "./cloud-table-scheduler"
describe("cloud table fair scheduling", () => {
  it("reserves execution for another owner instead of draining a hot owner first", async () => {
    const q = new CloudTableScheduler({ concurrency: 2, ownerConcurrency: 1, ownerQueue: 32, globalQueue: 128, bytes: 1024, waitMs: 1000 })
    let release!: () => void
    const order: string[] = []
    const a = q.run("a", 1, async () => { await new Promise<void>(r => { release = r }) })
    const b = q.run("a", 1, async () => { order.push("a2") })
    await q.run("b", 1, async () => { order.push("b") })
    expect(order).toEqual(["b"])
    release(); await Promise.all([a, b]); expect(order).toEqual(["b", "a2"])
  })
  it("bounds queued bytes and cancels requests that have not started", async () => {
    const q = new CloudTableScheduler({ concurrency: 1, ownerConcurrency: 1, ownerQueue: 2, globalQueue: 2, bytes: 10, waitMs: 1000 })
    let release!: () => void
    const a = q.run("a", 1, () => new Promise<void>(r => { release = r }))
    const abort = new AbortController()
    const queued = q.run("a", 8, async () => { throw new Error("must not run") }, abort.signal)
    await expect(q.run("b", 8, async () => 1)).rejects.toMatchObject({ code: "SERVER_BUSY" })
    abort.abort(); await expect(queued).rejects.toMatchObject({ code: "REQUEST_ABORTED" }); release(); await a
  })
  it("charges large batches more work before scheduling another batch", async () => {
    const q = new CloudTableScheduler({ concurrency: 1, ownerConcurrency: 1, ownerQueue: 32, globalQueue: 128, bytes: 1024, waitMs: 1000 })
    let release!: () => void; const order: string[] = []
    const first = q.run("heavy", 0, () => new Promise<void>(r => { release = r }))
    const heavy = q.run("heavy", 0, async () => { order.push("heavy") }, undefined, 10)
    const light = q.run("light", 0, async () => { order.push("light") })
    release(); await Promise.all([first, heavy, light]); expect(order).toEqual(["light", "heavy"])
  })
})
