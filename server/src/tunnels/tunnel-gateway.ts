import type { IncomingMessage, Server as HttpServer } from "node:http"
import type { Duplex } from "node:stream"
import { Logger } from "@nestjs/common"
import { WebSocket, WebSocketServer, createWebSocketStream, type RawData } from "ws"
import { TUNNEL_CONTROL_PATH, TUNNEL_DATA_PATH, TUNNEL_LIMITS, parseTunnelControlMessage, type TunnelControlMessage } from "@synapse/shared/tunnel-contracts"
import { boundedTunnelStream, TunnelByteBudget } from "@synapse/shared/tunnel-stream-node"
import type { TunnelBroker } from "./tunnel-broker"
import type { TunnelDeviceService } from "./tunnel-device.service"
import type { TunnelService } from "./tunnel.service"

export interface TunnelGatewayDeps {
  service: TunnelService; devices: TunnelDeviceService; broker: TunnelBroker
  bufferedBytes?: number
  verifyToken(token: string): Promise<{ userId: string }>
}
function decode(data: RawData, binary: boolean): TunnelControlMessage | null {
  if (binary) return null
  const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
  if (bytes.length > TUNNEL_LIMITS.controlFrameBytes) return null
  try { return parseTunnelControlMessage(JSON.parse(bytes.toString("utf8"))) } catch { return null }
}
function send(ws: WebSocket, message: TunnelControlMessage): void {
  if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > TUNNEL_LIMITS.controlFrameBytes * 4) throw new Error("TUNNEL_CONTROL_CLOSED")
  ws.send(JSON.stringify(message))
}
export class TunnelGateway {
  private readonly logger = new Logger(TunnelGateway.name)
  private readonly control = new WebSocketServer({ noServer: true, maxPayload: TUNNEL_LIMITS.controlFrameBytes, perMessageDeflate: false })
  private readonly data = new WebSocketServer({ noServer: true, maxPayload: TUNNEL_LIMITS.dataMessageBytes, perMessageDeflate: false })
  private readonly sockets = new Set<WebSocket>()
  private readonly byteBudget: TunnelByteBudget
  private readonly pendingSockets = new Set<Duplex>()
  private server?: HttpServer
  private closing = false
  constructor(private readonly deps: TunnelGatewayDeps) { this.byteBudget = new TunnelByteBudget(deps.bufferedBytes) }
  private readonly upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url !== TUNNEL_CONTROL_PATH && req.url !== TUNNEL_DATA_PATH) return
    socket.on("error", () => socket.destroy())
    if (this.closing || !this.deps.service.options.enabled || this.pendingSockets.size >= 128 || this.sockets.size >= 1024) { this.reject(socket, 503); return }
    const match = /^Bearer ([^\s]+)$/iu.exec(req.headers.authorization ?? "")
    if (!match) { this.reject(socket, 401); return }
    this.pendingSockets.add(socket)
    const timeout = setTimeout(() => this.reject(socket, 408), TUNNEL_LIMITS.connectTimeoutMs); timeout.unref()
    void this.deps.verifyToken(match[1]!).then(auth => {
      if (socket.destroyed || this.closing) return
      const server = req.url === TUNNEL_CONTROL_PATH ? this.control : this.data
      server.handleUpgrade(req, socket, head, ws => {
        this.sockets.add(ws)
        ws.once("close", () => this.sockets.delete(ws))
        ws.on("error", () => ws.terminate())
        if (server === this.control) this.bindControl(ws, auth.userId, match[1]!)
        else this.bindData(ws, auth.userId)
      })
    }).catch(() => { if (!socket.destroyed) this.reject(socket, 401) })
      .finally(() => { clearTimeout(timeout); this.pendingSockets.delete(socket) })
  }
  private reject(socket: Duplex, status: number): void { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`) }
  attach(server: HttpServer): void { if (this.server) throw new Error("Tunnel gateway already attached"); this.server = server; server.on("upgrade", this.upgrade) }
  private bindControl(ws: WebSocket, userId: string, initialToken: string): void {
    let connectionId: string | undefined, token = initialToken, lastPong = Date.now(), queued = 0
    let chain = Promise.resolve(), verifying = false
    const helloTimeout = setTimeout(() => ws.terminate(), TUNNEL_LIMITS.connectTimeoutMs); helloTimeout.unref()
    const heartbeat = setInterval(() => {
      if (Date.now() - lastPong > TUNNEL_LIMITS.heartbeatTimeoutMs) { ws.terminate(); return }
      if (ws.readyState === WebSocket.OPEN) ws.ping()
      if (!verifying) {
        verifying = true; const checkedToken = token
        void this.deps.verifyToken(checkedToken).then(auth => { if (auth.userId !== userId) ws.terminate() })
          .catch(() => { if (checkedToken === token) ws.terminate() }).finally(() => { verifying = false })
      }
    }, TUNNEL_LIMITS.heartbeatMs); heartbeat.unref()
    ws.on("pong", () => { lastPong = Date.now() })
    ws.once("close", () => { clearTimeout(helloTimeout); clearInterval(heartbeat); if (connectionId) this.deps.broker.disconnect(connectionId) })
    ws.on("message", (raw, binary) => {
      if (++queued > 16) { ws.terminate(); return }
      const message = decode(raw, binary)
      if (!message) { ws.terminate(); return }
      chain = chain.then(async () => {
        if (ws.readyState !== WebSocket.OPEN) return
        if (!connectionId) {
          if (message.type !== "hello") throw new Error("TUNNEL_HELLO_REQUIRED")
          const actor = await this.deps.devices.verify(userId, message.clientInstanceId, message.deviceKey)
          if (ws.readyState !== WebSocket.OPEN) return
          connectionId = this.deps.broker.register(actor, value => send(ws, value), () => ws.terminate())
          clearTimeout(helloTimeout)
          send(ws, { version: 1, type: "ready", connectionId })
        } else if (message.type === "bindings") {
          const mappings = await this.deps.broker.setBindings(connectionId, message.mappings)
          send(ws, { version: 1, type: "bindings-ready", mappings })
        } else if (message.type === "mapping-state") this.deps.broker.setState(connectionId, message.mappingId, message.revision, message.status)
        else if (message.type === "auth-refresh") {
          const verified = await this.deps.verifyToken(message.token)
          if (verified.userId !== userId) throw new Error("TUNNEL_ACCOUNT_CHANGED")
          token = message.token
        } else throw new Error("TUNNEL_CONTROL_MESSAGE_INVALID")
      }).catch(error => { this.logger.warn({ code: "TUNNEL_CONTROL_REJECTED", errorName: error instanceof Error ? error.name : "Error" }); ws.terminate() })
        .finally(() => { queued-- })
    })
  }
  private bindData(ws: WebSocket, userId: string): void {
    let claim: ReturnType<TunnelBroker["claim"]> | undefined
    const timeout = setTimeout(() => { claim?.fail("TUNNEL_CONNECT_TIMEOUT"); ws.terminate() }, TUNNEL_LIMITS.ticketTtlMs); timeout.unref()
    const closed = () => { clearTimeout(timeout); claim?.fail("TUNNEL_DATA_FAILED") }
    ws.once("close", closed)
    const message = (raw: RawData, binary: boolean) => {
      const value = decode(raw, binary)
      try {
        if (!claim && value?.type === "data-hello") claim = this.deps.broker.claim(userId, value.requestId, value.ticket, () => ws.terminate())
        else if (claim && value?.type === "data-ready") {
          clearTimeout(timeout); ws.removeListener("message", message); ws.removeListener("close", closed)
          const stream = boundedTunnelStream(createWebSocketStream(ws, { highWaterMark: TUNNEL_LIMITS.dataMessageBytes }), this.byteBudget)
          send(ws, { version: 1, type: "data-accepted" })
          claim.accept(stream)
        } else { claim?.fail(value?.type === "data-error" ? value.code : "TUNNEL_DATA_FAILED"); ws.terminate() }
      } catch { claim?.fail("TUNNEL_DATA_FAILED"); ws.terminate() }
    }
    ws.on("message", message)
  }
  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true; this.server?.removeListener("upgrade", this.upgrade)
    for (const socket of this.pendingSockets) socket.destroy()
    for (const socket of this.sockets) socket.terminate()
    await this.deps.broker.close()
    await Promise.all([this.control, this.data].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  }
  onModuleDestroy(): Promise<void> { return this.close() }
}
