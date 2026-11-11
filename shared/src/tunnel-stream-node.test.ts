import { Duplex } from "node:stream"
import { describe, expect, it } from "vitest"
import { TunnelByteBudget, boundedTunnelStream } from "./tunnel-stream-node.js"
describe("bounded tunnel byte stream", () => {
  it("pauses a second writer at the global budget and resumes after drain", async () => {
    const budget = new TunnelByteBudget(65536), drains: (() => void)[] = []
    const wire = () => new Duplex({ read() {}, write(_chunk, _encoding, done) { drains.push(done) } })
    const first = boundedTunnelStream(wire(), budget), second = boundedTunnelStream(wire(), budget)
    const completed: string[] = [], errors: Error[] = []
    first.on("error", error => errors.push(error)); second.on("error", error => errors.push(error))
    first.write(Buffer.alloc(65536), () => completed.push("first")); second.write(Buffer.alloc(65536), () => completed.push("second"))
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(errors).toEqual([]); expect(completed).toEqual([]); expect(budget.used).toBe(65536); expect(drains).toHaveLength(1)
    drains.shift()!(); await new Promise<void>(resolve => setImmediate(resolve))
    expect(drains).toHaveLength(1); expect(completed).toEqual(["first"])
    drains.shift()!(); await new Promise<void>(resolve => setImmediate(resolve))
    expect(completed).toEqual(["first", "second"]); expect(budget.used).toBe(0)
    first.destroy(); second.destroy()
  })
  it("splits large writes and holds global bytes only until the underlying write drains", async () => {
    const sizes: number[] = []
    const wire = new Duplex({ read() {}, write(chunk, _encoding, done) { sizes.push(chunk.length); setImmediate(done) } })
    const budget = new TunnelByteBudget(65536)
    const stream = boundedTunnelStream(wire, budget)
    await new Promise<void>((resolve, reject) => stream.write(Buffer.alloc(180000), error => error ? reject(error) : resolve()))
    expect(sizes).toEqual([65536, 65536, 48928])
    expect(budget.used).toBe(0)
    stream.destroy()
  })
})
