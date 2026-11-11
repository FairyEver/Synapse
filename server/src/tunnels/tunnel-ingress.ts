import { createServer, type IncomingMessage, type Server } from "node:http"
import { isIP, type AddressInfo, type Socket } from "node:net"
import { parseTunnelHost } from "@synapse/shared/tunnel-contracts"
import type { TunnelBroker } from "./tunnel-broker"
import type { TunnelService } from "./tunnel.service"
import { proxyTunnelHttp, proxyTunnelUpgrade, tunnelErrorResponse } from "./tunnel-http-proxy"

export class TunnelIngress {
  private server?: Server
  private readonly sockets = new Set<Socket>()
  constructor(private readonly service: TunnelService, private readonly broker: Pick<TunnelBroker, "open">) {}
  get port(): number { return (this.server?.address() as AddressInfo | null)?.port ?? 0 }
  async start(options: { host: "127.0.0.1" | "::1"; port: number; publicDomain: string; requestBodyBytes?: number }): Promise<void> {
    if (this.server) throw new Error("Tunnel ingress already started")
    const resolve = async (req: IncomingMessage) => {
      if (req.rawHeaders.filter((value, i) => i % 2 === 0 && value.toLowerCase() === "host").length !== 1) return null
      const label = parseTunnelHost(req.headers.host ?? "", options.publicDomain)
      return label ? this.service.findPublic(label) : null
    }
    const context = (req: IncomingMessage, port: number) => {
      const forwarded = req.headers["x-synapse-tunnel-client-ip"]
      return { port, publicOrigin: `https://${parseTunnelHost(req.headers.host ?? "", options.publicDomain)}.${options.publicDomain}`,
        clientIp: typeof forwarded === "string" && isIP(forwarded) ? forwarded : req.socket.remoteAddress ?? "127.0.0.1", requestBodyBytes: options.requestBodyBytes }
    }
    const server = createServer({ maxHeaderSize: 32768 }, (req, res) => {
      void resolve(req).then(async mapping => {
        if (!mapping) { tunnelErrorResponse(res, 404); return }
        if (mapping.deletedAt) { tunnelErrorResponse(res, 410); return }
        if (!mapping.enabled) { tunnelErrorResponse(res, 503); return }
        await proxyTunnelHttp(req, res, mapping, { broker: this.broker, context: context(req, mapping.port) })
      }).catch(() => tunnelErrorResponse(res, 503))
    })
    server.on("connection", socket => { this.sockets.add(socket); socket.once("close", () => this.sockets.delete(socket)) })
    server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"))
    server.on("connect", (_req, socket) => socket.end("HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"))
    server.on("upgrade", (req, socket, head) => {
      void resolve(req).then(async mapping => {
        if (!mapping || mapping.deletedAt || !mapping.enabled || req.headers.upgrade?.toLowerCase() !== "websocket" || req.method !== "GET") {
          socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); return
        }
        await proxyTunnelUpgrade(req, socket, head, mapping, { broker: this.broker, context: context(req, mapping.port) })
      }).catch(() => socket.destroy())
    })
    this.server = server
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port, options.host, () => { server.removeListener("error", reject); resolve() }) })
  }
  async close(deadlineMs = 1000): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = undefined
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { for (const socket of this.sockets) socket.destroy() }, deadlineMs); timer.unref()
      server.close(() => { clearTimeout(timer); resolve() }); server.closeIdleConnections()
    })
  }
  onModuleDestroy(): Promise<void> { return this.close() }
}
