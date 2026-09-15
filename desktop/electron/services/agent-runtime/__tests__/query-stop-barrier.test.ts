import { expect, it, vi } from "vitest"
import { stopQueryAtBoundary } from "../query-stop-barrier"

it("acknowledges interrupt before close and waits for settlement", async () => {
  const order: string[] = []
  let acknowledge!: () => void
  let settle!: () => void
  const pending = stopQueryAtBoundary({ query: {
    interrupt: () => new Promise<void>((resolve) => { acknowledge = resolve }),
    close: () => { order.push("close") },
  }, settled: new Promise<void>((resolve) => { settle = resolve }) })
  expect(order).toEqual([])
  acknowledge()
  await vi.waitFor(() => expect(order).toEqual(["close"]))
  let finished = false
  void pending.then(() => { finished = true })
  expect(finished).toBe(false)
  settle()
  await pending
})

it("does not close when interrupt fails or times out", async () => {
  const close = vi.fn()
  await expect(stopQueryAtBoundary({ query: { interrupt: () => new Promise(() => {}), close },
    settled: Promise.resolve(), timeoutMs: 10 })).rejects.toThrow("停止未能")
  expect(close).not.toHaveBeenCalled()
})

it("never treats close returning as native termination", async () => {
  const close = vi.fn()
  await expect(stopQueryAtBoundary({ query: { interrupt: async () => undefined, close },
    settled: new Promise(() => {}), timeoutMs: 10 })).rejects.toThrow("停止未能")
  expect(close).toHaveBeenCalledOnce()
})
