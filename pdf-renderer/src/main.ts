import { timingSafeEqual } from "node:crypto"
import { createServer, type ServerResponse } from "node:http"
import { PdfRenderer, PdfRenderTimeoutError, type PdfRenderRequest } from "./pdf-renderer"

// 64 MiB of binary image resources expand to roughly 86 MiB after Base64 encoding;
// leave room for the Markdown HTML, JSON framing, and metadata at the documented limit.
const maxRequestBytes = 128 * 1024 * 1024
const maxActive = 2
const maxQueued = 8
const port = parsePort(process.env.PORT)
const internalSecret = requireSecret(process.env.PDF_RENDERER_INTERNAL_SECRET)
const renderer = new PdfRenderer()
let active = 0
let queued = 0
const waiters: Array<() => void> = []

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end('{"ok":true}')
    return
  }
  if (request.method !== "POST" || request.url !== "/render") {
    response.writeHead(404).end()
    return
  }
  if (!isAuthorized(request.headers.authorization, internalSecret)) {
    response.writeHead(401).end()
    return
  }
  if (active >= maxActive && queued >= maxQueued) {
    response.writeHead(429, { "Retry-After": "5" }).end()
    return
  }
  await acquireSlot()
  try {
    const input = parseRenderRequest(await readRequestBody(request, maxRequestBytes))
    const result = await renderer.render(input)
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": String(result.bytes.length),
      "Cache-Control": "no-store",
      "X-Synapse-Pdf-Diagram-Warnings": String(result.diagramWarnings),
    })
    response.end(result.bytes)
  } catch (error) {
    const status = error instanceof RequestError
      ? error.status
      : error instanceof PdfRenderTimeoutError
        ? 504
        : 500
    writeJsonError(response, status)
    log("pdf_render_failed", error)
  } finally {
    releaseSlot()
  }
})

server.listen(port, "0.0.0.0", () => log("pdf_renderer_started", { port }))

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      void renderer.close().finally(() => process.exit(0))
    })
  })
}

async function acquireSlot(): Promise<void> {
  if (active < maxActive) {
    active += 1
    return
  }
  queued += 1
  await new Promise<void>((resolve) => waiters.push(resolve))
  queued -= 1
}

function releaseSlot(): void {
  const next = waiters.shift()
  if (next) {
    next()
    return
  }
  active -= 1
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

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? 3010)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("PORT is invalid")
  return parsed
}

function requireSecret(value: string | undefined): string {
  if (!value || value.length < 32) throw new Error("PDF_RENDERER_INTERNAL_SECRET must contain at least 32 characters")
  return value
}

function writeJsonError(response: ServerResponse, status: number): void {
  if (response.headersSent) return
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end('{"error":"PDF_RENDER_FAILED"}')
}

function log(event: string, detail: unknown): void {
  process.stdout.write(`${JSON.stringify({ level: "info", event, detail: sanitizeLogDetail(detail), at: new Date().toISOString() })}\n`)
}

function sanitizeLogDetail(detail: unknown): unknown {
  if (detail instanceof Error) return { name: detail.name }
  return detail
}

class RequestError extends Error {
  constructor(readonly status: number) {
    super("Invalid PDF render request")
  }
}
