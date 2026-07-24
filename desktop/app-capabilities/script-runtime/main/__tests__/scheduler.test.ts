import { describe, expect, it } from "vitest"
import { ScriptRunScheduler } from "../scheduler"

describe("ScriptRunScheduler", () => {
  it("shares one concurrency and queue limit", async () => {
    const scheduler = new ScriptRunScheduler(1, 1)
    let release: (() => void) | undefined
    const first = scheduler.run(new AbortController().signal, () =>
      new Promise<number>((resolve) => {
        release = () => resolve(1)
      }))
    const second = scheduler.run(new AbortController().signal, async () => 2)
    await expect(scheduler.run(new AbortController().signal, async () => 3))
      .rejects.toMatchObject({ code: "RUNNER_BUSY" })
    release?.()
    await expect(first).resolves.toBe(1)
    await expect(second).resolves.toBe(2)
  })

  it("removes a cancelled queued run", async () => {
    const scheduler = new ScriptRunScheduler(1, 1)
    let release: (() => void) | undefined
    const first = scheduler.run(new AbortController().signal, () =>
      new Promise<void>((resolve) => {
        release = resolve
      }))
    const queuedController = new AbortController()
    const queued = scheduler.run(queuedController.signal, async () => undefined)
    queuedController.abort()
    await expect(queued).rejects.toMatchObject({ code: "CANCELLED" })
    release?.()
    await first
  })
})
