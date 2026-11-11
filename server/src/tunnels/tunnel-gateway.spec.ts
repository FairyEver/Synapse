import { createServer } from "node:http"
import { once } from "node:events"
import { WebSocket } from "ws"
import { describe, expect, it, vi } from "vitest"
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

it("heartbeats quiet data sockets and rejects text after the binary handshake", async () => {
  const repository = memoryTunnelRepository(), service = new TunnelService(repository, { enabled: true, publicDomain: "tunnel.test", mappingsPerUser: 100 })
  const devices = new TunnelDeviceService(repository), broker = new TunnelBroker(service)
  const actor = { userId: "u", clientInstanceId: "d" }, row = await service.create(actor, { port: 3000, requestId: "bd2a4f46-ab0a-4028-9862-a7f1384d1835" })
  let open: { requestId: string; ticket: string } | undefined
  const connection = broker.register(actor, message => { if (message.type === "open") open = message }, () => {})
  await broker.setBindings(connection, [{ id: row.id, revision: row.revision }])
  const gateway = new TunnelGateway({ service, devices, broker, verifyToken: async () => ({ userId: "u" }) }), server = createServer()
  gateway.attach(server); server.listen(0, "127.0.0.1"); await once(server, "listening")
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
  const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}/api/tunnels/data`, { headers: { Authorization: "Bearer valid" } })
  ws.on("error", () => {})
  try {
    const pending = broker.open(row.id, row.revision, new AbortController().signal)
    await once(ws, "open")
    ws.send(JSON.stringify({ version: 1, type: "data-hello", requestId: open!.requestId, ticket: open!.ticket })); ws.send(JSON.stringify({ version: 1, type: "data-ready" }))
    const stream = await pending; stream.on("error", () => {})
    let pings = 0; ws.on("ping", () => pings++)
    await vi.advanceTimersByTimeAsync(20001)
    await new Promise<void>(done => setImmediate(done))
    expect(pings).toBe(1)
    vi.useRealTimers()
    ws.send("forbidden text after handshake")
    await vi.waitFor(() => expect(ws.readyState).toBe(WebSocket.CLOSED), { timeout: 500, interval: 10 })
    expect(broker.activeCount).toBe(0)
  } finally { vi.useRealTimers(); ws.terminate(); await gateway.close(); await new Promise<void>(done => server.close(() => done())) }
})
