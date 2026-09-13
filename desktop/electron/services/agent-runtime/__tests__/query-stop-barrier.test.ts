import { expect, it, vi } from "vitest"
import { stopQueryAtBoundary } from "../query-stop-barrier"

it("acknowledges interrupt before close/release and waits for settlement", async () => {
  const order: string[] = []
  let acknowledge!: () => void
  let settle!: () => void
  const pending = stopQueryAtBoundary({ query: {
    interrupt: () => new Promise<void>((resolve) => { acknowledge = resolve }),
    close: () => { order.push("close") },
  }, release: () => { order.push("release") }, settled: new Promise<void>((resolve) => { settle = resolve }) })
  expect(order).toEqual([])
  acknowledge()
  await vi.waitFor(() => expect(order).toEqual(["close", "release"]))
  let finished = false
  void pending.then(() => { finished = true })
  expect(finished).toBe(false)
  settle()
  await pending
})

it("does not close or release a hook when interrupt fails or times out", async () => {
  const close = vi.fn()
  const release = vi.fn()
  await expect(stopQueryAtBoundary({ query: { interrupt: () => new Promise(() => {}), close },
    release, settled: Promise.resolve(), timeoutMs: 10 })).rejects.toThrow("停止未能")
  expect(close).not.toHaveBeenCalled()
  expect(release).not.toHaveBeenCalled()
})

it("never treats close returning as native termination", async () => {
  const close = vi.fn()
  await expect(stopQueryAtBoundary({ query: { interrupt: async () => undefined, close },
    release: () => undefined, settled: new Promise(() => {}), timeoutMs: 10 })).rejects.toThrow("停止未能")
  expect(close).toHaveBeenCalledOnce()
})
