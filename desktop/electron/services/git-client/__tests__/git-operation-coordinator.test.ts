import { describe, expect, it, vi } from "vitest"
import { createGitOperationCoordinator, GitOperationCancelledError } from "../git-operation-coordinator"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("GitOperationCoordinator", () => {
  it("runs repository mutations in FIFO order", async () => {
    const firstGate = deferred()
    const order: string[] = []
    const coordinator = createGitOperationCoordinator()

    const first = coordinator.run({
      key: "/repo",
      operationId: "op-1",
      operation: "commit",
      task: async () => {
        order.push("first-start")
        await firstGate.promise
        order.push("first-end")
      },
    })
    const second = coordinator.run({
      key: "/repo",
      operationId: "op-2",
      operation: "push",
      task: async () => {
        order.push("second")
      },
    })

    await Promise.resolve()
    expect(order).toEqual(["first-start"])
    expect(coordinator.getState("op-2")).toMatchObject({ status: "queued", queuePosition: 1 })

    firstGate.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(["first-start", "first-end", "second"])
  })

  it("allows different repository roots to run concurrently", async () => {
    const gate = deferred()
    const started: string[] = []
    const coordinator = createGitOperationCoordinator()

    const first = coordinator.run({
      key: "/repo-a",
      operationId: "op-a",
      operation: "commit",
      task: async () => {
        started.push("a")
        await gate.promise
      },
    })
    const second = coordinator.run({
      key: "/repo-b",
      operationId: "op-b",
      operation: "push",
      task: async () => {
        started.push("b")
        await gate.promise
      },
    })

    await Promise.resolve()
    expect(started).toEqual(["a", "b"])
    gate.resolve()
    await Promise.all([first, second])
  })

  it("cancels queued and running operations", async () => {
    const coordinator = createGitOperationCoordinator()
    const firstGate = deferred()
    const running = coordinator.run({
      key: "/repo",
      operationId: "op-running",
      operation: "fetch",
      task: async (signal) => {
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        firstGate.resolve()
        throw new GitOperationCancelledError()
      },
    })
    const queuedTask = vi.fn(async () => undefined)
    const queued = coordinator.run({
      key: "/repo",
      operationId: "op-queued",
      operation: "push",
      task: queuedTask,
    })

    expect(coordinator.cancel("op-queued")).toBe(true)
    await expect(queued).rejects.toBeInstanceOf(GitOperationCancelledError)
    expect(queuedTask).not.toHaveBeenCalled()

    expect(coordinator.cancel("op-running")).toBe(true)
    await firstGate.promise
    await expect(running).rejects.toBeInstanceOf(GitOperationCancelledError)
  })

  it("uses the shared repository lock for mutations and reads", async () => {
    const release = vi.fn()
    const acquireLock = vi.fn().mockResolvedValue(release)
    const coordinator = createGitOperationCoordinator({ acquireLock })

    await coordinator.run({
      key: "/repo",
      operationId: "op-1",
      operation: "commit",
      task: async () => undefined,
    })
    await coordinator.read("/repo", async () => "snapshot")

    expect(acquireLock).toHaveBeenNthCalledWith(1, "/repo", "commit")
    expect(acquireLock).toHaveBeenNthCalledWith(2, "/repo", "read")
    expect(release).toHaveBeenCalledTimes(2)
  })
})
