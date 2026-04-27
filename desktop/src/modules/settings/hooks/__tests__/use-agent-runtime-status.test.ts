import { describe, expect, it } from "vitest"

import { createLatestRequestGuard } from "@/modules/settings/hooks/use-agent-runtime-status"

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

describe("createLatestRequestGuard", () => {
  it("ignores stale request completion after a newer request starts", async () => {
    const guard = createLatestRequestGuard()
    const first = createDeferred<string>()
    const second = createDeferred<string>()
    const applied: string[] = []
    const settled: string[] = []

    const firstRequest = guard.begin()
    const firstTask = first.promise
      .then((value) => {
        if (firstRequest.isActive()) {
          applied.push(value)
        }
      })
      .finally(() => {
        if (firstRequest.isActive()) {
          settled.push("first")
        }
      })

    const secondRequest = guard.begin()
    const secondTask = second.promise
      .then((value) => {
        if (secondRequest.isActive()) {
          applied.push(value)
        }
      })
      .finally(() => {
        if (secondRequest.isActive()) {
          settled.push("second")
        }
      })

    first.resolve("stale")
    await firstTask

    expect(applied).toEqual([])
    expect(settled).toEqual([])

    second.resolve("fresh")
    await secondTask

    expect(applied).toEqual(["fresh"])
    expect(settled).toEqual(["second"])
  })

  it("ignores request completion after cancellation", async () => {
    const guard = createLatestRequestGuard()
    const request = guard.begin()
    const deferred = createDeferred<string>()
    const applied: string[] = []
    const settled: string[] = []

    const task = deferred.promise
      .then((value) => {
        if (request.isActive()) {
          applied.push(value)
        }
      })
      .finally(() => {
        if (request.isActive()) {
          settled.push("done")
        }
      })

    guard.cancel()
    deferred.resolve("stale")
    await task

    expect(applied).toEqual([])
    expect(settled).toEqual([])
  })
})
