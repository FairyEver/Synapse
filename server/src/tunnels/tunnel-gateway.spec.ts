import { createServer } from "node:http"
import { once } from "node:events"
import { WebSocket } from "ws"
import { describe, expect, it } from "vitest"
import { TunnelGateway } from "./tunnel-gateway"
import { TunnelBroker } from "./tunnel-broker"
import { TunnelDeviceService } from "./tunnel-device.service"
import { TunnelService } from "./tunnel.service"
import { memoryTunnelRepository } from "./tunnel-test-fixture"

describe("dedicated tunnel websocket gateway", () => {
  it("rejects unauthenticated upgrades and authenticates a device on its own control channel", async () => {
    const repository = memoryTunnelRepository()
    const service = new TunnelService(repository, { enabled: true, publicDomain: "tunnel.test", mappingsPerUser: 100 })
    const devices = new TunnelDeviceService(repository)
    await devices.register("u", "d", "a".repeat(43))
    const broker = new TunnelBroker(service)
    const gateway = new TunnelGateway({ service, devices, broker, verifyToken: async token => { if (token !== "valid") throw new Error("invalid"); return { userId: "u" } } })
    const server = createServer(); gateway.attach(server); server.listen(0, "127.0.0.1"); await once(server, "listening")
    const address = server.address() as { port: number }
    const url = `ws://127.0.0.1:${address.port}/api/tunnels/control`
    try {
      const bad = new WebSocket(url); bad.on("error", () => undefined)
      const [, response] = await once(bad, "unexpected-response")
      expect(response.statusCode).toBe(401); response.resume(); bad.terminate()
      const ws = new WebSocket(url, { headers: { Authorization: "Bearer valid" } }); await once(ws, "open")
      const ready = once(ws, "message")
      ws.send(JSON.stringify({ version: 1, type: "hello", clientInstanceId: "d", deviceKey: "a".repeat(43) }))
      expect(JSON.parse(String((await ready)[0]))).toMatchObject({ version: 1, type: "ready" })
      ws.close(); await once(ws, "close")
    } finally { await gateway.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })
})
