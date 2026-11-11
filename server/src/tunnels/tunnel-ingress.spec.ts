import { createServer, request as httpRequest } from "node:http"
import { connect } from "node:net"
import { once } from "node:events"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TunnelIngress } from "./tunnel-ingress"
import { TunnelService } from "./tunnel.service"
import { memoryTunnelRepository } from "./tunnel-test-fixture"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  let invocations = 0
  const local = createServer((req, res) => {
    invocations++
    if (req.url === "/drop") { req.resume(); req.on("end", () => req.socket.destroy()); return }
    if (req.url === "/sse") { res.setHeader("Content-Type", "text/event-stream"); res.write("data: first\n\n"); setTimeout(() => res.end("data: last\n\n"), 20); return }
    res.setHeader("Content-Type", "application/octet-stream")
    res.setHeader("X-Path", req.url ?? "")
    req.pipe(res)
  })
  local.listen(0, "127.0.0.1"); await once(local, "listening")
  cleanup.push(() => new Promise(resolve => local.close(() => resolve())))
  const service = new TunnelService(memoryTunnelRepository(), { enabled: true, publicDomain: "tunnel.test", mappingsPerUser: 100 })
  const mapping = await service.create({ userId: "u", clientInstanceId: "d" }, { port: (local.address() as AddressInfo).port, requestId: "00000000-0000-4000-8000-000000000001" })
  const open = vi.fn(async () => { const socket = connect({ port: mapping.port, host: "127.0.0.1" }); await once(socket, "connect"); return socket })
  const ingress = new TunnelIngress(service, { open })
  await ingress.start({ host: "127.0.0.1", port: 0, publicDomain: "tunnel.test" })
  cleanup.push(() => ingress.close(100))
  const invoke = (path: string, body = Buffer.from([0, 1, 255]), headers: Record<string, string> = {}) => new Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port: ingress.port, path, method: "POST", headers: { host: new URL(mapping.url).hostname, ...headers } }, res => {
      const chunks: Buffer[] = []; res.on("data", chunk => chunks.push(chunk)); res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }))
    }); req.on("error", reject); req.end(body)
  })
  return { mapping, ingress, service, invoke, open, calls: () => invocations }
}
describe("dedicated raw HTTP tunnel ingress", () => {
  it("streams binary data and keeps reserved paths and encoded queries on the local service", async () => {
    const f = await fixture()
    const response = await f.invoke("/api/tunnels?x=%2F&x=+", Buffer.from([0, 1, 255]))
    expect(response).toMatchObject({ status: 200, headers: { "x-path": "/api/tunnels?x=%2F&x=+" } })
    expect(response.body).toEqual(Buffer.from([0, 1, 255]))
    expect((await f.invoke("/sse")).body.toString()).toBe("data: first\n\ndata: last\n\n")
  })
  it("does not replay POST after a local disconnect and rejects unknown hosts", async () => {
    const f = await fixture()
    expect((await f.invoke("/drop")).status).toBe(502)
    expect(f.calls()).toBe(1); expect(f.open).toHaveBeenCalledTimes(1)
    expect((await f.invoke("/", Buffer.alloc(0), { host: "synapse.test" })).status).toBe(404)
  })
  it("keeps stopped and retired links distinct without redirecting to the platform", async () => {
    const f = await fixture()
    await f.service.setEnabled({ userId: "u", clientInstanceId: "d" }, f.mapping.id, { enabled: false, expectedRevision: 1 })
    expect((await f.invoke("/")).status).toBe(503)
    await f.service.delete("u", f.mapping.id, { expectedRevision: 2 })
    expect((await f.invoke("/")).status).toBe(410)
    expect(f.open).not.toHaveBeenCalled()
  })
})
