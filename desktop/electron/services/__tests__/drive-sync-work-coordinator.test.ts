import { describe, expect, it } from "vitest"
import { createDriveSyncWorkCoordinator } from "../drive-sync-work-coordinator"

describe("DriveSyncWorkCoordinator", () => {
  it("serializes work for one binding", async () => {
    const coordinator = createDriveSyncWorkCoordinator()
    const order: string[] = []
    let releaseFirst: () => void = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = coordinator.run("binding-1", async () => {
      order.push("first:start")
      await firstGate
      order.push("first:end")
    })
    const second = coordinator.run("binding-1", async () => {
      order.push("second")
    })

    await Promise.resolve()
    expect(order).toEqual(["first:start"])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(["first:start", "first:end", "second"])
  })

  it("allows different bindings to run concurrently", async () => {
    const coordinator = createDriveSyncWorkCoordinator()
    const active = new Set<string>()
    let overlapped = false
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const run = (id: string) => coordinator.run(id, async () => {
      active.add(id)
      overlapped ||= active.size === 2
      await gate
      active.delete(id)
    })

    const work = [run("binding-1"), run("binding-2")]
    await Promise.resolve()
    expect(overlapped).toBe(true)
    release()
    await Promise.all(work)
  })

  it("aborts active work and skips queued work before a lifecycle action", async () => {
    const coordinator = createDriveSyncWorkCoordinator()
    const order: string[] = []
    const active = coordinator.run("binding-1", async (signal) => {
      order.push("active")
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    })
    const queued = coordinator.run("binding-1", async () => {
      order.push("queued")
    })

    await Promise.resolve()
    const lifecycle = coordinator.cancelAndRun("binding-1", async () => {
      order.push("lifecycle")
    })

    await expect(active).rejects.toMatchObject({ name: "DriveSyncWorkCancelledError" })
    await expect(queued).rejects.toMatchObject({ name: "DriveSyncWorkCancelledError" })
    await lifecycle
    expect(order).toEqual(["active", "lifecycle"])
  })
})
