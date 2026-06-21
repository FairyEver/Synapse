import {
  DRAGONSCALE_TILING_DEFAULT_OLLAMA_URL,
  DRAGONSCALE_TILING_MAX_RESPONSE_BYTES,
  type DragonScaleEmbeddingProvider,
} from "./tiling-types"
import { sanitizeUrl } from "../../../../src/lib/url-sanitize"
import { createMainLogger } from "../../log-store"
import { errorLogMeta as baseErrorLogMeta } from "../../error-sanitize"

const OLLAMA_TIMEOUT_MS = 3000
const EMBED_TIMEOUT_MS = 30000
const logger = createMainLogger("knowledge-base.dragonscale.ollama")

export class DragonScaleOllamaEmbeddingProvider implements DragonScaleEmbeddingProvider {
  async isReachable(url: string): Promise<boolean> {
    try {
      await getJson(joinUrl(url, "/api/version"), OLLAMA_TIMEOUT_MS)
      return true
    } catch (error) {
      logger.warn("DragonScale Ollama reachability check failed", {
        url: sanitizeDragonScaleOllamaUrl(url),
        ...errorLogMeta(error),
      })
      return false
    }
  }

  async hasModel(url: string, model: string): Promise<boolean> {
    try {
      const data = await getJson(joinUrl(url, "/api/tags"), OLLAMA_TIMEOUT_MS)
      const models = isRecord(data) && Array.isArray(data.models) ? data.models : []
      return models.some((entry) => {
        if (!isRecord(entry) || typeof entry.name !== "string") return false
        return entry.name === model || entry.name.startsWith(`${model}:`)
      })
    } catch (error) {
      logger.warn("DragonScale Ollama model query failed", {
        url: sanitizeDragonScaleOllamaUrl(url),
        model,
        ...errorLogMeta(error),
      })
      return false
    }
  }

  async embed(input: { readonly url: string; readonly model: string; readonly text: string }): Promise<readonly number[]> {
    const data = await postJson(joinUrl(input.url, "/api/embeddings"), {
      model: input.model,
      prompt: input.text,
    }, EMBED_TIMEOUT_MS)
    const embedding = isRecord(data) ? data.embedding : undefined
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("Ollama returned no embedding.")
    }
    if (!embedding.every((value) => typeof value === "number" && Number.isFinite(value))) {
      throw new Error("Ollama embedding contains non-numeric values.")
    }
    return embedding
  }
}

export function resolveDragonScaleOllamaUrl(options: {
  readonly ollamaUrl?: string
  readonly allowRemoteOllama?: boolean
  readonly env?: NodeJS.ProcessEnv
} = {}): string {
  const raw = options.ollamaUrl ?? options.env?.OLLAMA_URL ?? process.env.OLLAMA_URL ?? DRAGONSCALE_TILING_DEFAULT_OLLAMA_URL
  if (!isLocalOllamaUrl(raw) && options.allowRemoteOllama !== true) {
    throw new Error(`OLLAMA_URL=${sanitizeDragonScaleOllamaUrl(raw)} is not localhost. Pass allowRemoteOllama to override.`)
  }
  return raw
}

export function sanitizeDragonScaleOllamaUrl(raw: string): string {
  return sanitizeUrl(raw)
}

export function isLocalOllamaUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw)
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "")
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
  } catch {
    return false
  }
}

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  return requestJson(url, { method: "GET", timeoutMs })
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  return requestJson(url, {
    method: "POST",
    timeoutMs,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

async function requestJson(
  url: string,
  options: {
    readonly method: "GET" | "POST"
    readonly timeoutMs: number
    readonly body?: string
    readonly headers?: Record<string, string>
  },
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await fetch(url, {
      method: options.method,
      body: options.body,
      headers: options.headers,
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const bytes = await readLimitedResponseBody(response, controller)
    return JSON.parse(bytes.toString("utf8")) as unknown
  } finally {
    clearTimeout(timeout)
  }
}

async function readLimitedResponseBody(response: Response, controller: AbortController): Promise<Buffer> {
  const contentLength = response.headers.get("content-length")
  if (contentLength) {
    const parsedLength = Number(contentLength)
    if (Number.isFinite(parsedLength) && parsedLength > DRAGONSCALE_TILING_MAX_RESPONSE_BYTES) {
      controller.abort()
      throw new Error("Ollama response exceeded size limit.")
    }
  }

  if (!response.body) return Buffer.alloc(0)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      totalBytes += value.byteLength
      if (totalBytes > DRAGONSCALE_TILING_MAX_RESPONSE_BYTES) {
        controller.abort()
        throw new Error("Ollama response exceeded size limit.")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  return Buffer.concat(chunks, totalBytes)
}

function joinUrl(base: string, suffix: string): string {
  return new URL(suffix, base.endsWith("/") ? base : `${base}/`).toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function errorLogMeta(error: unknown): Record<string, unknown> {
  return baseErrorLogMeta(error, { includeMessage: true })
}
