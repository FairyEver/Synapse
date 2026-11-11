import { Agent, request, ServerResponse, type IncomingMessage } from "node:http"
import type { Socket } from "node:net"
import type { Duplex } from "node:stream"
import { Transform } from "node:stream"
import { TUNNEL_LIMITS } from "@synapse/shared/tunnel-contracts"
import type { TunnelRow } from "./tunnel.repository"
import type { TunnelBroker } from "./tunnel-broker"
import { buildTunnelUpstreamHeaders, rewriteTunnelResponseHeaders, type TunnelHttpContext } from "./tunnel-http-headers"

type ProxyDeps = { broker: Pick<TunnelBroker, "open">; context: TunnelHttpContext }
function status(error: unknown): number { const code = (error as { status?: number })?.status; return code && [429, 502, 503, 504].includes(code) ? code : 502 }
export function tunnelErrorResponse(res: ServerResponse, code: number): void {
  if (res.destroyed) return
  if (res.headersSent) { res.destroy(); return }
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", Connection: "close" })
  res.end(code === 404 ? "链接不存在" : code === 410 ? "链接已删除" : code === 413 ? "请求内容过大" : "服务暂不可用")
}
function socketAgent(stream: Duplex): Agent {
  const agent = new Agent({ keepAlive: false, maxSockets: 1 })
  agent.createConnection = () => stream as Socket
  return agent
}
export async function proxyTunnelHttp(req: IncomingMessage, res: ServerResponse, mapping: TunnelRow, deps: ProxyDeps): Promise<void> {
  const maximum = deps.context.requestBodyBytes ?? TUNNEL_LIMITS.requestBodyBytes
  if (Number(req.headers["content-length"]) > maximum) { tunnelErrorResponse(res, 413); return }
  const controller = new AbortController()
  const cancel = () => { if (!res.writableFinished) controller.abort() }
  req.once("aborted", cancel); res.once("close", cancel)
  let transport: Duplex | undefined
  try {
    transport = await deps.broker.open(mapping.id, mapping.revision, controller.signal)
    if (controller.signal.aborted) { transport.destroy(); return }
    const agent = socketAgent(transport)
    await new Promise<void>(resolve => {
      let done = false, bytes = 0
      let headerTimer: NodeJS.Timeout | undefined
      const upstream = request({ method: req.method, path: req.url, host: "localhost", port: mapping.port, agent, maxHeaderSize: 65536,
        headers: buildTunnelUpstreamHeaders(req.rawHeaders, deps.context) })
      const body = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        if (bytes > maximum) callback(Object.assign(new Error("TUNNEL_BODY_LIMIT"), { status: 413 }))
        else callback(null, chunk)
      } })
      const finish = () => {
        if (done) return
        done = true; clearTimeout(headerTimer); req.unpipe(body); body.unpipe(upstream)
        upstream.destroy(); agent.destroy(); transport?.destroy(); resolve()
      }
      const fail = (code: number) => { tunnelErrorResponse(res, code); req.pause(); finish() }
      res.once("finish", finish); res.once("close", finish); res.once("error", finish)
      body.on("error", error => fail((error as { status?: number }).status ?? 502))
      upstream.on("error", () => { if (!done) fail(502) })
      upstream.once("finish", () => { if (!done && !res.headersSent) { headerTimer = setTimeout(() => fail(504), TUNNEL_LIMITS.responseHeaderTimeoutMs); headerTimer.unref() } })
      upstream.once("response", response => {
        clearTimeout(headerTimer)
        res.writeHead(response.statusCode ?? 502, rewriteTunnelResponseHeaders(response.rawHeaders, deps.context)); res.flushHeaders()
        response.once("error", () => fail(502)); response.once("aborted", () => fail(502))
        response.pipe(res)
      })
      const timed = transport as Duplex & { setTimeout?: (ms: number, listener: () => void) => void }
      timed.setTimeout?.(TUNNEL_LIMITS.idleTimeoutMs, () => fail(504))
      req.pipe(body).pipe(upstream)
    })
  } catch (error) { tunnelErrorResponse(res, status(error)); transport?.destroy() }
  finally { req.removeListener("aborted", cancel); res.removeListener("close", cancel) }
}
export async function proxyTunnelUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, mapping: TunnelRow, deps: ProxyDeps): Promise<void> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  socket.once("close", cancel)
  let transport: Duplex | undefined
  try {
    transport = await deps.broker.open(mapping.id, mapping.revision, controller.signal)
    if (controller.signal.aborted) { transport.destroy(); return }
    const agent = socketAgent(transport), stream = transport
    await new Promise<void>(resolve => {
      let done = false
      const upstream = request({ method: "GET", path: req.url, host: "localhost", port: mapping.port, agent, maxHeaderSize: 65536,
        headers: buildTunnelUpstreamHeaders(req.rawHeaders, deps.context, true) })
      const finish = () => { if (done) return; done = true; clearTimeout(timer); upstream.destroy(); stream.destroy(); socket.destroy(); agent.destroy(); resolve() }
      const fail = () => { if (!done && socket.writable) socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); finish() }
      const timer = setTimeout(fail, TUNNEL_LIMITS.responseHeaderTimeoutMs); timer.unref()
      socket.once("close", finish); socket.once("error", finish); stream.once("error", finish); stream.once("close", finish)
      upstream.once("error", fail)
      upstream.once("upgrade", (response, upstreamSocket, upstreamHead) => {
        clearTimeout(timer)
        const reply = new ServerResponse(req)
        reply.assignSocket(socket as Socket)
        reply.writeHead(101, rewriteTunnelResponseHeaders(response.rawHeaders, deps.context, true)); reply.flushHeaders(); reply.detachSocket(socket as Socket)
        if (upstreamHead.length) socket.write(upstreamHead)
        if (head.length) upstreamSocket.write(head)
        socket.pipe(upstreamSocket).pipe(socket)
      })
      upstream.once("response", response => {
        clearTimeout(timer)
        const reply = new ServerResponse(req); reply.shouldKeepAlive = false; reply.assignSocket(socket as Socket)
        reply.writeHead(response.statusCode ?? 502, rewriteTunnelResponseHeaders(response.rawHeaders, deps.context))
        reply.once("finish", finish); response.once("error", finish); response.pipe(reply)
      })
      upstream.end()
    })
  } catch { if (socket.writable) socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); transport?.destroy() }
  finally { socket.removeListener("close", cancel) }
}
