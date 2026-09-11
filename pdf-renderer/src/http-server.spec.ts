import type { AddressInfo } from "node:net"
import { request as httpRequest } from "node:http"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createPdfRendererServer,
  PDF_RENDERER_MAX_ACTIVE,
  PDF_RENDERER_MAX_OUTPUT_BYTES,
  PDF_RENDERER_MAX_QUEUED,
  type PdfRendererHttpTestRenderer,
} from "./http-server"

const secret = "test-pdf-renderer-secret-with-more-than-32-characters"
const servers: Array<ReturnType<typeof createPdfRendererServer>> = []

describe("PDF renderer HTTP server", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
      server.closeAllConnections()
    })))
  })

  it("uses the documented two-active and eight-queued defaults", () => {
    expect(PDF_RENDERER_MAX_ACTIVE).toBe(2)
    expect(PDF_RENDERER_MAX_QUEUED).toBe(8)
    expect(PDF_RENDERER_MAX_OUTPUT_BYTES).toBe(64 * 1024 * 1024)
  })

  it("rejects unauthenticated render requests", async () => {
    const { url, renderer } = await startServer()

    const response = await fetch(`${url}/render`, { method: "POST", body: renderBody() })

    expect(response.status).toBe(401)
    expect(renderer.render).not.toHaveBeenCalled()
  })

  it("rejects request bodies above the configured limit", async () => {
    const { url, renderer } = await startServer({ maxRequestBytes: 16 })

    const response = await renderRequest(url)

    expect(response.status).toBe(413)
    expect(renderer.render).not.toHaveBeenCalled()
  })

  it("returns 503 when Chromium or renderer assets cannot warm up", async () => {
    const renderer = fakeRenderer()
    renderer.warmup.mockRejectedValueOnce(new Error("chromium unavailable"))
    const { url } = await startServer({ renderer })

    const response = await fetch(`${url}/healthz`)

    expect(response.status).toBe(503)
  })

  it("returns PDF warning headers on success", async () => {
    const { url } = await startServer()

    const response = await renderRequest(url)

    expect(response.status).toBe(200)
    expect(response.headers.get("x-synapse-pdf-image-warnings")).toBe("1")
    expect(response.headers.get("x-synapse-pdf-diagram-warnings")).toBe("2")
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString("ascii")).toBe("%PDF-")
  })

  it("rejects renderer output above the configured limit", async () => {
    const renderer = fakeRenderer()
    renderer.render.mockResolvedValueOnce({
      bytes: Buffer.from("%PDF-oversized"),
      imageWarnings: 0,
      diagramWarnings: 0,
    })
    const { url } = await startServer({ renderer, maxOutputBytes: 8 })

    const response = await renderRequest(url)

    expect(response.status).toBe(413)
  })

  it("rejects a full queue and removes a queued request when its client disconnects", async () => {
    let finishFirst: ((result: { bytes: Buffer; imageWarnings: number; diagramWarnings: number }) => void) | undefined
    const renderer = fakeRenderer()
    renderer.render.mockImplementationOnce(() => new Promise((resolve) => {
      finishFirst = resolve
    }))
    const { url, server } = await startServer({ renderer, maxActive: 1, maxQueued: 1 })
    const first = renderRequest(url)
    await waitFor(() => renderer.render.mock.calls.length === 1)

    const queuedAccepted = new Promise<import("node:http").ServerResponse>((resolve) => {
      server.once("request", (_request, response) => resolve(response))
    })
    const queued = startAbortableRenderRequest(url)
    const queuedResponse = await queuedAccepted
    const rejected = await renderRequest(url)
    expect(rejected.status).toBe(429)

    const queuedClosed = new Promise<void>((resolve) => queuedResponse.once("close", resolve))
    queued.abort()
    await Promise.all([queued.closed, queuedClosed])
    finishFirst?.({ bytes: Buffer.from("%PDF-test"), imageWarnings: 0, diagramWarnings: 0 })
    expect((await first).status).toBe(200)
    expect(renderer.render).toHaveBeenCalledTimes(1)
  })
})

function fakeRenderer(): PdfRendererHttpTestRenderer & {
  warmup: ReturnType<typeof vi.fn>
  render: ReturnType<typeof vi.fn>
} {
  return {
    warmup: vi.fn(async () => undefined),
    render: vi.fn(async () => ({
      bytes: Buffer.from("%PDF-test"),
      imageWarnings: 1,
      diagramWarnings: 2,
    })),
  }
}

async function startServer(options: {
  renderer?: ReturnType<typeof fakeRenderer>
  maxRequestBytes?: number
  maxOutputBytes?: number
  maxActive?: number
  maxQueued?: number
} = {}) {
  const renderer = options.renderer ?? fakeRenderer()
  const server = createPdfRendererServer({
    renderer,
    internalSecret: secret,
    maxRequestBytes: options.maxRequestBytes,
    maxOutputBytes: options.maxOutputBytes,
    maxActive: options.maxActive,
    maxQueued: options.maxQueued,
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${address.port}`, renderer, server }
}

function renderRequest(url: string, signal?: AbortSignal): Promise<Response> {
  return fetch(`${url}/render`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: renderBody(),
    signal,
  })
}

function startAbortableRenderRequest(url: string): { readonly abort: () => void; readonly closed: Promise<void> } {
  const target = new URL(`${url}/render`)
  let settle: (() => void) | undefined
  const closed = new Promise<void>((resolve) => { settle = resolve })
  const request = httpRequest({
    hostname: target.hostname,
    port: target.port,
    path: target.pathname,
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
  })
  request.once("error", () => settle?.())
  request.once("close", () => settle?.())
  request.end(renderBody())
  return { abort: () => request.destroy(), closed }
}

function renderBody(): string {
  return JSON.stringify({ schemaVersion: 1, title: "文档", html: '<main class="markdown-body">正文</main>' })
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for renderer call")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
