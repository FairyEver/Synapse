import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { Buffer } from "node:buffer"
import { WebSocketServer, type WebSocket } from "ws"

import type { ResolvedNetworkBinding, NetworkServiceLifecycle } from "./registry"

const SERVER_CLOSE_TIMEOUT_MS = 3000

export interface LocalHttpRequest {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: Buffer
  readonly remoteAddress?: string
}

export interface LocalHttpResponse {
  readonly status: number
  readonly headers?: Record<string, string>
  readonly body?: string | Buffer | Record<string, unknown> | readonly unknown[]
}

export interface LocalWebSocketConnection {
  sendJson(value: unknown): void
  onJsonMessage(listener: (value: unknown) => void | Promise<void>): void
  onClose(listener: () => void): void
  close(code?: number, reason?: string): void
}

export interface LocalWebSocketUpgradeDecision {
  readonly ok: boolean
  readonly status?: number
  readonly message?: string
}

export interface LocalNetworkHostHandler {
  readonly maxBodyBytes?: number
  handleHttp(request: LocalHttpRequest): Promise<LocalHttpResponse> | LocalHttpResponse
  acceptWebSocket?(request: Omit<LocalHttpRequest, "body">): LocalWebSocketUpgradeDecision
  handleWebSocket?(
    connection: LocalWebSocketConnection,
    request: Omit<LocalHttpRequest, "body">,
  ): void | Promise<void>
}

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024

export async function createLocalNetworkHostLifecycle(
  binding: ResolvedNetworkBinding,
  handler: LocalNetworkHostHandler,
): Promise<NetworkServiceLifecycle> {
  const wsServer = handler.handleWebSocket
    ? new WebSocketServer({ noServer: true })
    : undefined
  const server = createServer((req, res) => {
    void handleHttpRequest(req, res, handler)
  })

  if (wsServer) {
    server.on("upgrade", (req, socket, head) => {
      const request = requestBase(req)
      const decision = handler.acceptWebSocket?.(request) ?? { ok: true }
      if (!decision.ok) {
        const status = decision.status ?? 401
        const message = decision.message ?? "unauthorized"
        socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`)
        socket.destroy()
        return
      }
      wsServer.handleUpgrade(req, socket, head, (ws) => {
        wsServer.emit("connection", ws, req)
      })
    })
    wsServer.on("connection", (ws, req) => {
      void handler.handleWebSocket?.(new WsConnection(ws), requestBase(req))
    })
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      server.off("error", onError)
      resolve()
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen(binding.port, binding.bindAddress)
  })

  return {
    async stop() {
      await closeWebSocketServer(wsServer)
      await closeServer(server)
    },
  }
}

async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handler: LocalNetworkHostHandler,
): Promise<void> {
  try {
    const body = await readBody(req, handler.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES)
    const response = await Promise.resolve(handler.handleHttp({
      ...requestBase(req),
      body,
    }))
    writeResponse(res, response)
  } catch (error) {
    writeResponse(res, {
      status: error instanceof BodyTooLargeError ? 413 : 500,
      body: {
        ok: false,
        error: {
          code: error instanceof BodyTooLargeError ? "body_too_large" : "internal_error",
          message: error instanceof Error ? error.message : String(error),
        },
      },
    })
  }
}

function requestBase(req: IncomingMessage): Omit<LocalHttpRequest, "body"> {
  return {
    method: req.method ?? "GET",
    url: req.url ?? "/",
    headers: req.headers,
    remoteAddress: req.socket.remoteAddress,
  }
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > maxBytes) {
      throw new BodyTooLargeError(`request body exceeds ${String(maxBytes)} bytes`)
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function writeResponse(res: ServerResponse, response: LocalHttpResponse): void {
  const headers = response.headers ?? {}
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value)
  }
  const body = response.body
  if (body === undefined) {
    res.writeHead(response.status)
    res.end()
    return
  }
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    if (!hasHeader(headers, "content-type")) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8")
    }
    res.writeHead(response.status)
    res.end(body)
    return
  }
  if (!hasHeader(headers, "content-type")) {
    res.setHeader("Content-Type", "application/json")
  }
  res.writeHead(response.status)
  res.end(JSON.stringify(body))
}

function hasHeader(headers: Record<string, string | number | readonly string[]>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name)
}

async function closeWebSocketServer(server: WebSocketServer | undefined): Promise<void> {
  if (!server) return
  for (const client of server.clients) {
    client.terminate()
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, SERVER_CLOSE_TIMEOUT_MS)
    server.close((error) => {
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve()
    })
  })
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.closeAllConnections()
      resolve()
    }, SERVER_CLOSE_TIMEOUT_MS)
    server.close((error) => {
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve()
    })
  })
}

class WsConnection implements LocalWebSocketConnection {
  private readonly ws: WebSocket

  constructor(ws: WebSocket) {
    this.ws = ws
  }

  sendJson(value: unknown): void {
    this.ws.send(JSON.stringify(value))
  }

  onJsonMessage(listener: (value: unknown) => void | Promise<void>): void {
    this.ws.on("message", (data) => {
      const text = data.toString()
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch {
        value = text
      }
      void Promise.resolve(listener(value))
    })
  }

  onClose(listener: () => void): void {
    this.ws.on("close", listener)
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason)
  }
}

class BodyTooLargeError extends Error {}
