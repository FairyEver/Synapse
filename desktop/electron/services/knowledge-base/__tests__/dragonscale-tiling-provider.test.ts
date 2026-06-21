import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"

const dragonScaleLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock("../../log-store", () => ({
  createMainLogger: () => dragonScaleLogger,
}))

import {
  DragonScaleOllamaEmbeddingProvider,
  isLocalOllamaUrl,
  resolveDragonScaleOllamaUrl,
  sanitizeDragonScaleOllamaUrl,
} from "../index"
import { DRAGONSCALE_TILING_MAX_RESPONSE_BYTES } from "../dragonscale/tiling-types"

const servers: Array<{ close: () => Promise<void> }> = []

async function withServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  servers.push({
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  vi.unstubAllGlobals()
  dragonScaleLogger.info.mockClear()
  dragonScaleLogger.warn.mockClear()
  dragonScaleLogger.error.mockClear()
})

describe("DragonScaleOllamaEmbeddingProvider", () => {
  it("validates local and remote Ollama URLs", () => {
    expect(isLocalOllamaUrl("http://127.0.0.1:11434")).toBe(true)
    expect(isLocalOllamaUrl("http://localhost:11434")).toBe(true)
    expect(isLocalOllamaUrl("http://[::1]:11434")).toBe(true)
    expect(isLocalOllamaUrl("https://example.com")).toBe(false)

    expect(() => resolveDragonScaleOllamaUrl({ ollamaUrl: "https://example.com" })).toThrow("not localhost")
    expect(() => resolveDragonScaleOllamaUrl({ ollamaUrl: "https://user:secret@example.com?token=sk-secret" }))
      .toThrow("https://example.com/?token=%5Bredacted%5D")
    expect(resolveDragonScaleOllamaUrl({ ollamaUrl: "https://example.com", allowRemoteOllama: true }))
      .toBe("https://example.com")
    expect(sanitizeDragonScaleOllamaUrl("http://user:secret@127.0.0.1:11434?token=sk-secret&ok=1"))
      .toBe("http://127.0.0.1:11434/?token=%5Bredacted%5D&ok=1")
  })

  it("detects reachable Ollama and pulled models", async () => {
    const baseUrl = await withServer((request, response) => {
      response.setHeader("Content-Type", "application/json")
      if (request.url === "/api/version") {
        response.end(JSON.stringify({ version: "0.0.0-test" }))
        return
      }
      if (request.url === "/api/tags") {
        response.end(JSON.stringify({ models: [{ name: "nomic-embed-text:latest" }] }))
        return
      }
      response.statusCode = 404
      response.end("{}")
    })
    const provider = new DragonScaleOllamaEmbeddingProvider()

    await expect(provider.isReachable(baseUrl)).resolves.toBe(true)
    await expect(provider.hasModel(baseUrl, "nomic-embed-text")).resolves.toBe(true)
    await expect(provider.hasModel(baseUrl, "other-model")).resolves.toBe(false)
  })

  it("logs Ollama reachability and model query failures", async () => {
    const baseUrl = await withServer((_request, response) => {
      response.statusCode = 500
      response.end("{}")
    })
    const provider = new DragonScaleOllamaEmbeddingProvider()

    await expect(provider.isReachable(baseUrl)).resolves.toBe(false)
    await expect(provider.hasModel(baseUrl, "nomic-embed-text")).resolves.toBe(false)

    expect(dragonScaleLogger.warn).toHaveBeenCalledWith(
      "DragonScale Ollama reachability check failed",
      expect.objectContaining({
        url: `${baseUrl}/`,
        errorName: "Error",
        errorMessage: "HTTP 500",
      }),
    )
    expect(dragonScaleLogger.warn).toHaveBeenCalledWith(
      "DragonScale Ollama model query failed",
      expect.objectContaining({
        url: `${baseUrl}/`,
        model: "nomic-embed-text",
        errorName: "Error",
        errorMessage: "HTTP 500",
      }),
    )
  })

  it("redacts Ollama URL credentials in failure logs", async () => {
    const provider = new DragonScaleOllamaEmbeddingProvider()
    const rawUrl = "http://user:secret@127.0.0.1:11434?token=sk-secret"

    await expect(provider.isReachable(rawUrl)).resolves.toBe(false)

    const serialized = JSON.stringify(dragonScaleLogger.warn.mock.calls)
    expect(serialized).toContain("http://127.0.0.1:11434/?token=%5Bredacted%5D")
    expect(serialized).not.toContain("user:secret")
    expect(serialized).not.toContain("sk-secret")
  })

  it("returns numeric embeddings and rejects malformed responses", async () => {
    const baseUrl = await withServer((request, response) => {
      response.setHeader("Content-Type", "application/json")
      if (request.url === "/api/embeddings" && request.method === "POST") {
        response.end(JSON.stringify({ embedding: [1, 2, 3] }))
        return
      }
      response.end("{}")
    })

    await expect(new DragonScaleOllamaEmbeddingProvider().embed({
      url: baseUrl,
      model: "nomic-embed-text",
      text: "hello",
    })).resolves.toEqual([1, 2, 3])

    const malformedUrl = await withServer((_request, response) => {
      response.setHeader("Content-Type", "application/json")
      response.end(JSON.stringify({ embedding: ["bad"] }))
    })
    await expect(new DragonScaleOllamaEmbeddingProvider().embed({
      url: malformedUrl,
      model: "nomic-embed-text",
      text: "hello",
    })).rejects.toThrow("non-numeric")
  })

  it("reads Ollama JSON responses through the response stream", async () => {
    const { response, arrayBuffer } = streamResponse([
      new TextEncoder().encode(JSON.stringify({ embedding: [1, 2, 3] })),
    ])
    vi.stubGlobal("fetch", vi.fn(async () => response))

    await expect(new DragonScaleOllamaEmbeddingProvider().embed({
      url: "http://127.0.0.1:11434",
      model: "nomic-embed-text",
      text: "hello",
    })).resolves.toEqual([1, 2, 3])
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it("rejects oversized streamed responses without reading them through arrayBuffer", async () => {
    const { response, arrayBuffer } = streamResponse([
      new Uint8Array(DRAGONSCALE_TILING_MAX_RESPONSE_BYTES),
      new Uint8Array([123]),
    ])
    vi.stubGlobal("fetch", vi.fn(async () => response))

    await expect(new DragonScaleOllamaEmbeddingProvider().embed({
      url: "http://127.0.0.1:11434",
      model: "nomic-embed-text",
      text: "hello",
    })).rejects.toThrow("size limit")
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it("rejects oversized JSON responses", async () => {
    const baseUrl = await withServer((_request, response) => {
      response.setHeader("Content-Type", "application/json")
      response.end(`{"payload":"${"x".repeat(4 * 1024 * 1024 + 1)}"}`)
    })

    await expect(new DragonScaleOllamaEmbeddingProvider().embed({
      url: baseUrl,
      model: "nomic-embed-text",
      text: "hello",
    })).rejects.toThrow("size limit")
  })
})

function streamResponse(chunks: readonly Uint8Array[]) {
  const arrayBuffer = vi.fn(async () => {
    throw new Error("arrayBuffer should not be used")
  })
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
  Object.defineProperty(response, "arrayBuffer", { value: arrayBuffer })
  return { response, arrayBuffer }
}
