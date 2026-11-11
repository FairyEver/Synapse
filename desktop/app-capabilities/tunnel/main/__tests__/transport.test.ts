import { createServer } from "node:net"
import { once } from "node:events"
import { describe, expect, it } from "vitest"
import { connectTunnelLoopback } from "../transport"
describe("tunnel loopback connection", () => {
  it("opens only the selected loopback port without submitting request bytes during probing", async () => {
    let bytes = 0
    const server = createServer(socket => socket.on("data", chunk => { bytes += chunk.length }))
    server.listen(0, "127.0.0.1"); await once(server, "listening")
    try {
      const socket = await connectTunnelLoopback((server.address() as { port: number }).port, new AbortController().signal)
      expect(socket.remoteAddress).toBe("127.0.0.1"); socket.destroy()
      expect(bytes).toBe(0)
      await expect(connectTunnelLoopback(0, new AbortController().signal)).rejects.toThrow()
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })
})
