import { beforeAll, describe, expect, it, vi } from "vitest"
import { createServer, request, type Server, type IncomingMessage, type ServerResponse } from "node:http"
import { once } from "node:events"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { WebSocket, WebSocketServer } from "ws"
import { TunnelGateway } from "./tunnel-gateway"
import { TunnelBroker } from "./tunnel-broker"
import { TunnelDeviceService } from "./tunnel-device.service"
import { TunnelService } from "./tunnel.service"
import { TunnelIngress } from "./tunnel-ingress"
import { memoryTunnelRepository } from "./tunnel-test-fixture"
import type { TunnelMappingDto } from "@synapse/shared/tunnel-contracts"
const transportUrl = pathToFileURL(resolve("../desktop/app-capabilities/tunnel/main/transport.ts")).href
let NativeTransport: any
beforeAll(async () => { NativeTransport = (await import(transportUrl)).TunnelTransport })
async function listen(server: Server, host = "127.0.0.1") { server.listen(0, host); await once(server, "listening"); return (server.address() as { port: number }).port }
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) }
async function fixture(handler: (req: IncomingMessage, res: ServerResponse) => void, ipv6 = false) {
  const local = createServer(handler), port = await listen(local, ipv6 ? "::1" : "127.0.0.1")
  const local2 = createServer((_req, res) => res.end("second")), port2 = await listen(local2)
  const websocket = new WebSocketServer({ noServer: true })
  local.on("upgrade", (req, socket, head) => websocket.handleUpgrade(req, socket, head, ws => { ws.send(Buffer.from([1, 2, 255])); ws.on("message", (data, binary) => ws.send(data, { binary })) }))
  const repository = memoryTunnelRepository(), service = new TunnelService(repository, { enabled: true, publicDomain: "tunnel.test", mappingsPerUser: 100 }), devices = new TunnelDeviceService(repository), broker = new TunnelBroker(service)
  const key = "a".repeat(43), actor = { userId: "u", clientInstanceId: "d" }; await devices.register("u", "d", key)
  const gateway = new TunnelGateway({ service, devices, broker, verifyToken: async token => { if (token !== "valid") throw new Error("bad"); return { userId: "u" } } })
  const api = createServer(); gateway.attach(api); const apiPort = await listen(api)
  const ingress = new TunnelIngress(service, broker); await ingress.start({ host: "127.0.0.1", port: 0, publicDomain: "tunnel.test" })
  const failures: string[] = []
  const transport = new NativeTransport({ getAuth: async () => ({ token: "valid", apiBaseUrl: `http://127.0.0.1:${apiPort}` }), authorizeCloud: async () => true, authorize: async () => true, onStatus: () => {}, onFailure: (code: string) => failures.push(code) })
  let rows: TunnelMappingDto[] = []
  const allocate = async (target: number) => { const row = await service.create(actor, { port: target, requestId: randomUUID() }); rows.push(row); return row }
  const reconcile = async () => { await transport.reconcile(rows); await vi.waitFor(async () => { for (const row of rows.filter(r => r.enabled)) expect((await service.get("u", row.id)).runtimeStatus).toBe("running") }, { timeout: 3000, interval: 10 }) }
  const start = async () => { await transport.start({ clientInstanceId: "d", deviceKey: key }); await reconcile() }
  const replace = async (row: TunnelMappingDto) => { rows = rows.map(item => item.id === row.id ? row : item); await reconcile() }
  const fetch = (row: TunnelMappingDto, path = "/", body?: Buffer, slow = false) => new Promise<{ status: number; body: Buffer }>((done, reject) => {
    const req = request({ host: "127.0.0.1", port: ingress.port, path, method: body ? "POST" : "GET", agent: false, headers: { Host: new URL(row.url).host, ...(body ? { "Content-Length": body.length } : {}) } }, res => {
      const chunks: Buffer[] = []; res.on("data", chunk => { chunks.push(chunk); if (slow) { res.pause(); setTimeout(() => res.resume(), 1) } }); res.on("end", () => done({ status: res.statusCode!, body: Buffer.concat(chunks) })); res.on("error", reject)
    }); req.on("error", reject); req.end(body)
  })
  const resources = () => ({ flows: (broker as any).flows.size, tickets: (broker as any).tickets.size, leases: broker.activeCount, dataSockets: (gateway as any).sockets.size, pendingSockets: (gateway as any).pendingSockets.size, desktopFlows: transport.flows.size, probes: transport.probes.size })
  const shutdown = async () => { await transport.stop(); await gateway.close(); await ingress.close(500); for (const ws of websocket.clients) ws.terminate(); await new Promise<void>(done => websocket.close(() => done())); await Promise.all([close(api), close(local), close(local2)]) }
  return { port, port2, ingress, service, broker, transport, actor, failures, allocate, start, replace, fetch, shutdown, websocket, resources }
}
describe("native desktop to server tunnel", () => {
  it("routes three new fixed domains across two ports, binary bodies and slow downloads; restarts and retires links", async () => {
    const data = Buffer.alloc(3 * 1024 * 1024); for (let i = 0; i < data.length; i++) data[i] = i % 251
    const f = await fixture((req, res) => { if (req.method === "POST") req.pipe(res); else res.end(data) })
    try {
      const a = await f.allocate(f.port), b = await f.allocate(f.port2), c = await f.allocate(f.port)
      await f.start()
      const [download, second, post] = await Promise.all([f.fetch(a, "/api/tunnels?q=%2F", undefined, true), f.fetch(b), f.fetch(c, "/nested", data)])
      expect(download.body.equals(data)).toBe(true); expect(post.body.equals(data)).toBe(true); expect(second.body.toString()).toBe("second")
      const rowForRestart = a
      await f.transport.stop(); await vi.waitFor(async () => expect((await f.service.get("u", rowForRestart.id)).runtimeStatus).toBe("offline"), { interval: 10 }); await f.start(); expect((await f.fetch(a)).body.equals(data)).toBe(true)
      const updated = await f.service.update(f.actor, a.id, { port: f.port2, expectedRevision: a.revision }); await f.replace(updated)
      expect(updated.url).toBe(a.url); expect((await f.fetch(updated)).body.toString()).toBe("second")
      const stopped = await f.service.setEnabled(f.actor, c.id, { enabled: false, expectedRevision: c.revision }); await f.replace(stopped)
      expect((await f.fetch(c)).status).toBe(503)
      await f.service.delete("u", b.id, { expectedRevision: b.revision }); expect((await f.fetch(b)).status).toBe(410)
      await vi.waitFor(() => expect(f.broker.activeCount).toBe(0))
    } finally { await f.shutdown() }
    await vi.waitFor(() => expect(f.resources()).toEqual({ flows: 0, tickets: 0, leases: 0, dataSockets: 0, pendingSockets: 0, desktopFlows: 0, probes: 0 }))
  })
  it("passes WebSocket subprotocol/binary/early frames and the first SSE event before completion, then cancels", async () => {
    let complete: (() => void) | undefined
    const f = await fixture((_req, res) => { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders(); res.write("data: first\n\n"); complete = () => res.end("data: last\n\n") })
    try {
      const row = await f.allocate(f.port); await f.start()
      const ws = new WebSocket(`ws://127.0.0.1:${f.ingress.port}/ws`, ["fixture"], { headers: { Host: new URL(row.url).host } })
      const early = once(ws, "message"); await once(ws, "open"); expect(ws.protocol).toBe("fixture"); expect(Buffer.from((await early)[0] as Buffer)).toEqual(Buffer.from([1, 2, 255]))
      const echo = once(ws, "message"); ws.send(Buffer.from([3, 4])); expect(Buffer.from((await echo)[0] as Buffer)).toEqual(Buffer.from([3, 4])); ws.terminate()
      await new Promise<void>((done, reject) => {
        const req = request({ host: "127.0.0.1", port: f.ingress.port, path: "/events", headers: { Host: new URL(row.url).host }, agent: false }, res => { res.once("data", chunk => { expect(String(chunk)).toContain("data: first"); res.destroy(); req.destroy(); done() }); res.on("error", () => {}) }); req.on("error", reject); req.end()
      })
      complete?.(); await vi.waitFor(() => expect(f.broker.activeCount).toBe(0))
    } finally { await f.shutdown() }
  })
  it("shuts down an active SSE stream with no tickets, sockets or leases left", async () => {
    const f = await fixture((_req, res) => { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write("data: open\n\n") })
    let closed!: () => void
    const disconnected = new Promise<void>(done => { closed = done })
    try {
      const row = await f.allocate(f.port); await f.start()
      await new Promise<void>((done, reject) => {
        const req = request({ host: "127.0.0.1", port: f.ingress.port, path: "/events", agent: false, headers: { Host: new URL(row.url).host } }, res => { res.once("data", () => done()); res.once("close", closed); res.on("error", () => {}) }); req.on("error", reject); req.end()
      })
      expect(f.broker.activeCount).toBe(1)
      await f.shutdown(); await disconnected
      await vi.waitFor(() => expect(f.resources()).toEqual({ flows: 0, tickets: 0, leases: 0, dataSockets: 0, pendingSockets: 0, desktopFlows: 0, probes: 0 }))
    } finally { await f.shutdown() }
  })
  it("falls back before bytes on IPv6-only loopback and never replays a POST after the server drops it", async () => {
    let posts = 0
    const f = await fixture((req, res) => { if (req.method === "POST") { posts++; req.resume(); req.once("end", () => res.destroy()) } else res.end("ipv6") }, true)
    try {
      const row = await f.allocate(f.port); await f.start(); expect((await f.fetch(row)).body.toString()).toBe("ipv6")
      await f.fetch(row, "/once", Buffer.from("command")).catch(() => undefined)
      await f.transport.stop(); await f.start(); expect(posts).toBe(1); await vi.waitFor(() => expect(f.broker.activeCount).toBe(0))
    } finally { await f.shutdown() }
  })
})
