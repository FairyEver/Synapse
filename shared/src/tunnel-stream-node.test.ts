import { Duplex } from "node:stream"
import { describe, expect, it } from "vitest"
import { TunnelByteBudget, boundedTunnelStream } from "./tunnel-stream-node.js"
describe("bounded tunnel byte stream", () => {
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
