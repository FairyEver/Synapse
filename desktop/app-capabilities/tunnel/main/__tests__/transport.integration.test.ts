import { createServer as createHttpServer } from "node:http"
import { createServer as createTcpServer } from "node:net"
import { once } from "node:events"
import { WebSocketServer, WebSocket } from "ws"
import { describe, expect, it, vi } from "vitest"
import { TunnelTransport } from "../transport"
import type { TunnelMappingDto } from "@synapse/shared/tunnel-contracts"
it("discards a late authentication response after stopping without opening a cloud socket", async () => {
  const server = createHttpServer(), wss = new WebSocketServer({ server }); let connections = 0
  wss.on("connection", ws => { connections++; ws.close() }); server.listen(0, "127.0.0.1"); await once(server, "listening")
  let resolveAuth!: (value: { token: string; apiBaseUrl: string }) => void
  const getAuth = vi.fn(() => new Promise<{ token: string; apiBaseUrl: string }>(done => { resolveAuth = done }))
  const transport = new TunnelTransport({ getAuth, authorizeCloud: async () => true, authorize: async () => true, onStatus: () => {}, onFailure: () => {} })
  try {
    await transport.start({ clientInstanceId: "d", deviceKey: "a".repeat(43) }); await vi.waitFor(() => expect(getAuth).toHaveBeenCalledOnce())
    await transport.stop(); resolveAuth({ token: "late", apiBaseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` })
    await new Promise<void>(done => setImmediate(done)); expect(connections).toBe(0)
  } finally { await transport.stop(); await new Promise<void>(done => wss.close(() => done())); await new Promise<void>(done => server.close(() => done())) }
})
it("rejects an open carrying a different port before connecting to loopback", async () => {
  let localConnections = 0
  const local = createTcpServer(socket => { localConnections++; socket.destroy() }); local.listen(0, "127.0.0.1"); await once(local, "listening")
  const server = createHttpServer(), wss = new WebSocketServer({ server }); server.listen(0, "127.0.0.1"); await once(server, "listening")
  const failures: string[] = [], port = (local.address() as { port: number }).port, now = new Date().toISOString()
  const row: TunnelMappingDto = { id: "m1", clientInstanceId: "d", port: port === 65535 ? port - 1 : port + 1, deviceName: "Mac", url: `https://${"a".repeat(32)}.tunnel.test`, enabled: true, revision: 1, runtimeStatus: "offline", lastErrorCode: null, createdAt: now, updatedAt: now }
  wss.on("connection", ws => ws.on("message", raw => {
    const message = JSON.parse(String(raw))
    if (message.type === "hello") ws.send(JSON.stringify({ version: 1, type: "ready", connectionId: "connection" }))
    if (message.type === "bindings") ws.send(JSON.stringify({ version: 1, type: "open", requestId: "request", ticket: "b".repeat(43), mapping: { id: row.id, revision: 1, port } }))
  }))
  const transport = new TunnelTransport({ getAuth: async () => ({ token: "valid", apiBaseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` }), authorizeCloud: async () => true, authorize: async () => true, onStatus: () => {}, onFailure: code => failures.push(code) })
  try {
    await transport.start({ clientInstanceId: "d", deviceKey: "a".repeat(43) }); await transport.reconcile([row])
    await vi.waitFor(() => expect(failures).toContain("TUNNEL_PROTOCOL_ERROR"), { timeout: 1000 })
    expect(localConnections).toBe(0)
  } finally { await transport.stop(); for (const ws of wss.clients) ws.terminate(); await new Promise<void>(done => wss.close(() => done())); await new Promise<void>(done => server.close(() => done())); await new Promise<void>(done => local.close(() => done())) }
})
