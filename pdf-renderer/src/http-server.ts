import { timingSafeEqual } from "node:crypto"
import { createServer, type Server, type ServerResponse } from "node:http"
import {
  PdfRenderCancelledError,
  PdfRenderTimeoutError,
  type PdfRenderer,
  type PdfRenderRequest,
  type PdfRenderResult,
} from "./pdf-renderer"

// 64 MiB of images expand to roughly 86 MiB after Base64 encoding, while 10 MiB
// of Markdown can expand severalfold during safe HTML escaping. Keep headroom for JSON framing.
export const PDF_RENDERER_MAX_REQUEST_BYTES = 192 * 1024 * 1024
export const PDF_RENDERER_MAX_OUTPUT_BYTES = 64 * 1024 * 1024
export const PDF_RENDERER_MAX_ACTIVE = 2
export const PDF_RENDERER_MAX_QUEUED = 8

type Renderer = Pick<PdfRenderer, "warmup" | "render">
type Log = (event: string, detail: unknown) => void

export function createPdfRendererServer(input: {
  readonly renderer: Renderer
  readonly internalSecret: string
  readonly maxRequestBytes?: number
  readonly maxOutputBytes?: number
  readonly maxActive?: number
  readonly maxQueued?: number
  readonly log?: Log
}): Server {
  const maxRequestBytes = input.maxRequestBytes ?? PDF_RENDERER_MAX_REQUEST_BYTES
  const maxOutputBytes = input.maxOutputBytes ?? PDF_RENDERER_MAX_OUTPUT_BYTES
  const maxActive = input.maxActive ?? PDF_RENDERER_MAX_ACTIVE
  const maxQueued = input.maxQueued ?? PDF_RENDERER_MAX_QUEUED
  const log = input.log ?? (() => undefined)
  let active = 0
  let queued = 0
  const waiters: Array<{ readonly grant: () => void; readonly cancel: () => void }> = []

  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      try {
        await input.renderer.warmup()
        response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end('{"ok":true}')
      } catch (error) {
        writeJsonError(response, 503)
        log("pdf_renderer_health_failed", error)
      }
      return
    }
    if (request.method !== "POST" || request.url !== "/render") {
      response.writeHead(404).end()
      return
    }
    if (!isAuthorized(request.headers.authorization, input.internalSecret)) {
      response.writeHead(401).end()
      return
    }
    if (active >= maxActive && queued >= maxQueued) {
      response.writeHead(429, { "Retry-After": "5" }).end()
      return
    }

    const disconnectController = new AbortController()
    const cancelDisconnectedRequest = () => {
      if (!response.writableEnded) disconnectController.abort()
    }
    request.once("aborted", cancelDisconnectedRequest)
    response.once("close", cancelDisconnectedRequest)
    const cleanupDisconnectListeners = () => {
      request.removeListener("aborted", cancelDisconnectedRequest)
      response.removeListener("close", cancelDisconnectedRequest)
    }
    const acquired = await acquireSlot(disconnectController.signal)
    if (!acquired) {
      cleanupDisconnectListeners()
      return
    }
    try {
      const renderInput = parseRenderRequest(await readRequestBody(request, maxRequestBytes))
      const result = await input.renderer.render(renderInput, disconnectController.signal)
      if (result.bytes.length > maxOutputBytes) throw new RequestError(413)
      response.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": String(result.bytes.length),
        "Cache-Control": "no-store",
        "X-Synapse-Pdf-Image-Warnings": String(result.imageWarnings),
        "X-Synapse-Pdf-Diagram-Warnings": String(result.diagramWarnings),
      })
      response.end(result.bytes)
    } catch (error) {
      if (error instanceof PdfRenderCancelledError) return
      const status = error instanceof RequestError
        ? error.status
        : error instanceof PdfRenderTimeoutError
          ? 504
          : 500
      writeJsonError(response, status)
      log("pdf_render_failed", error)
    } finally {
      cleanupDisconnectListeners()
      releaseSlot()
    }
  })

  async function acquireSlot(signal: AbortSignal): Promise<boolean> {
    if (active < maxActive) {
      active += 1
      return true
    }
    queued += 1
    return new Promise<boolean>((resolve) => {
      let settled = false
      const abort = () => waiter.cancel()
      const waiter = {
        grant: () => {
          if (settled) return
          settled = true
          queued -= 1
          signal.removeEventListener("abort", abort)
          resolve(true)
        },
        cancel: () => {
          if (settled) return
          settled = true
          queued -= 1
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
          signal.removeEventListener("abort", abort)
          resolve(false)
        },
      }
      if (signal.aborted) waiter.cancel()
      else {
        signal.addEventListener("abort", abort, { once: true })
        waiters.push(waiter)
      }
    })
  }

  function releaseSlot(): void {
    const next = waiters.shift()
    if (next) {
      next.grant()
      return
    }
    active -= 1
  }
}

async function readRequestBody(request: NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request as NodeJS.ReadableStream & AsyncIterable<Buffer | string>) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.length
    if (total > maxBytes) throw new RequestError(413)
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, total)
}

function parseRenderRequest(bytes: Buffer): PdfRenderRequest {
  let value: unknown
  try {
    value = JSON.parse(bytes.toString("utf8"))
  } catch {
    throw new RequestError(400)
  }
  if (!value || typeof value !== "object") throw new RequestError(400)
  const candidate = value as Record<string, unknown>
  if (candidate.schemaVersion !== 1 || typeof candidate.title !== "string" || candidate.title.length > 255 || typeof candidate.html !== "string") {
    throw new RequestError(400)
  }
  return { schemaVersion: 1, title: candidate.title, html: candidate.html }
}

function isAuthorized(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false
  const provided = Buffer.from(header.slice(7))
  const expected = Buffer.from(secret)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function writeJsonError(response: ServerResponse, status: number): void {
  if (response.headersSent || response.destroyed) return
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end('{"error":"PDF_RENDER_FAILED"}')
}

class RequestError extends Error {
  constructor(readonly status: number) {
    super("Invalid PDF render request")
  }
}

export type PdfRendererHttpTestRenderer = {
  readonly warmup: () => Promise<void>
  readonly render: (input: PdfRenderRequest, signal?: AbortSignal) => Promise<PdfRenderResult>
}
