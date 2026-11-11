import { createServer, request } from "node:http"
import { connect, type AddressInfo } from "node:net"
import { once } from "node:events"
import { WebSocket, WebSocketServer } from "ws"
import { describe, expect, it } from "vitest"
import { TunnelIngress } from "./tunnel-ingress"
import { TunnelService } from "./tunnel.service"
import { memoryTunnelRepository } from "./tunnel-test-fixture"

async function startFixture() {
  let releaseSse = () => undefined as void
  const local = createServer((req, res) => {
    if (req.url === "/reject") { res.writeHead(403); res.end("denied"); return }
    if (req.url === "/events") { res.setHeader("Content-Type", "text/event-stream"); res.write("data: first\n\n"); releaseSse = () => res.end("data: second\n\n"); return }
    req.resume(); req.on("end", () => res.end("ok"))
  })
  const wss = new WebSocketServer({ noServer: true })
  local.on("upgrade", (req, socket, head) => {
    if (req.url === "/reject") { socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 6\r\nConnection: close\r\n\r\ndenied"); return }
    wss.handleUpgrade(req, socket, head, ws => { ws.send("hello"); ws.on("message", (data, binary) => ws.send(data, { binary })) })
  })
  local.listen(0, "127.0.0.1"); await once(local, "listening")
  const service = new TunnelService(memoryTunnelRepository(), { enabled: true, publicDomain: "tunnel.test", mappingsPerUser: 100 })
  const mapping = await service.create({ userId: "u", clientInstanceId: "d" }, { port: (local.address() as AddressInfo).port, requestId: "00000000-0000-4000-8000-000000000001" })
  const ingress = new TunnelIngress(service, { open: async () => { const s = connect(mapping.port, "127.0.0.1"); await once(s, "connect"); return s } })
  await ingress.start({ host: "127.0.0.1", port: 0, publicDomain: "tunnel.test", requestBodyBytes: 16 })
  return { port: ingress.port, host: new URL(mapping.url).hostname, release: () => releaseSse(), async close() {
    await ingress.close(100); for (const ws of wss.clients) ws.terminate(); wss.close()
    await new Promise<void>(resolve => local.close(() => resolve()))
  } }
}
describe("tunnel streaming and upgrades", () => {
  it("preserves websocket protocol, early frames and bidirectional binary data", async () => {
    const f = await startFixture()
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${f.port}/api/live/desktop`, ["chat"], { headers: { Host: f.host } })
      const greeting = once(ws, "message"); await once(ws, "open")
      expect(ws.protocol).toBe("chat"); expect(String((await greeting)[0])).toBe("hello")
      const echoed = once(ws, "message"); ws.send(Buffer.from([0, 255, 1]))
      expect((await echoed)[0]).toEqual(Buffer.from([0, 255, 1]))
      ws.close(); await once(ws, "close")
    } finally { await f.close() }
  })
  it("returns the actual rejected upgrade response", async () => {
    const f = await startFixture()
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${f.port}/reject`, { headers: { Host: f.host } }); ws.on("error", () => undefined)
      const [, res] = await once(ws, "unexpected-response")
      expect(res.statusCode).toBe(403); res.resume(); ws.terminate()
    } finally { await f.close() }
  })
  it("delivers the first SSE chunk while the local response is still open", async () => {
    const f = await startFixture()
    try {
      await new Promise<void>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: f.port, path: "/events", headers: { Host: f.host } }, res => {
          let chunks = 0
          res.on("data", (chunk: Buffer) => { chunks++; if (chunks === 1) { expect(chunk.toString()).toBe("data: first\n\n"); f.release() } })
          res.once("end", () => { expect(chunks).toBe(2); resolve() })
        }); req.on("error", reject); req.end()
      })
    } finally { await f.close() }
  })
  it("returns 413 for chunked uploads over the configured budget", async () => {
    const f = await startFixture()
    try {
      const code = await new Promise<number>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: f.port, method: "POST", headers: { Host: f.host, "Transfer-Encoding": "chunked" } }, res => { res.resume(); resolve(res.statusCode!) })
        req.on("error", reject); req.write(Buffer.alloc(8)); req.end(Buffer.alloc(9))
      })
      expect(code).toBe(413)
    } finally { await f.close() }
  })
})
