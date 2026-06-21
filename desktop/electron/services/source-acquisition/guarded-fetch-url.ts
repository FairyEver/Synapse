import { lookup } from "node:dns/promises"
import http from "node:http"
import https from "node:https"
import type { IncomingMessage, RequestOptions } from "node:http"

import { sanitizeUrl } from "../../../src/lib/url-sanitize"
import { isLocalOrPrivateHost, UrlResponseSizeLimitError, type FetchUrl } from "./url-source"
import { createMainLogger } from "../log-store"

const MAX_REDIRECTS = 5
const DEFAULT_TIMEOUT_MS = 30_000
const logger = createMainLogger("source-acquisition.guarded-fetch")

type GuardedFetchResponse = Awaited<ReturnType<FetchUrl>> & {
  readonly discardBody: () => void
}

export interface CreateGuardedFetchUrlOptions {
  readonly timeoutMs?: number
  readonly allowLocalOrPrivateHosts?: boolean
  readonly beforeRequest?: (url: URL) => Promise<void> | void
}

export function createGuardedFetchUrl(options: CreateGuardedFetchUrlOptions = {}): FetchUrl {
  return async (url, init) => fetchWithRedirects(new URL(url), {
    allowLocalOrPrivateHosts: options.allowLocalOrPrivateHosts === true,
    redirectsRemaining: MAX_REDIRECTS,
    signal: init.signal,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    beforeRequest: options.beforeRequest,
  })
}

async function fetchWithRedirects(
  url: URL,
  options: {
    readonly allowLocalOrPrivateHosts: boolean
    readonly redirectsRemaining: number
    readonly signal: AbortSignal
    readonly timeoutMs: number
    readonly beforeRequest?: (url: URL) => Promise<void> | void
  },
): ReturnType<FetchUrl> {
  const response = await requestUrl(url, options)
  if (isRedirect(response.status)) {
    if (options.redirectsRemaining <= 0) {
      response.discardBody()
      logger.warn("Guarded URL fetch redirect limit exceeded.", {
        url: safeUrlForLog(url),
        maxRedirects: MAX_REDIRECTS,
      })
      throw new Error("URL redirect limit exceeded.")
    }
    const location = response.headers.get("location")
    if (!location) {
      response.discardBody()
      logger.warn("Guarded URL fetch redirect missing location.", {
        url: safeUrlForLog(url),
        status: response.status,
      })
      throw new Error("URL redirect response did not include a Location header.")
    }
    response.discardBody()
    return fetchWithRedirects(new URL(location, url), {
      ...options,
      redirectsRemaining: options.redirectsRemaining - 1,
    })
  }
  return response
}

async function requestUrl(
  url: URL,
  options: {
    readonly allowLocalOrPrivateHosts: boolean
    readonly signal: AbortSignal
    readonly timeoutMs: number
    readonly beforeRequest?: (url: URL) => Promise<void> | void
  },
): Promise<GuardedFetchResponse> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    logger.warn("Guarded URL fetch rejected unsupported protocol.", {
      url: safeUrlForLog(url),
      protocol: url.protocol,
    })
    throw new Error(`URL protocol is not supported: ${url.protocol}`)
  }
  await options.beforeRequest?.(url)
  const resolvedAddress = await resolvePublicAddress(url, options.allowLocalOrPrivateHosts)
  const transport = url.protocol === "https:" ? https : http

  const requestOptions: RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port,
    path: `${url.pathname}${url.search}`,
    method: "GET",
    headers: { Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.1" },
    timeout: options.timeoutMs,
    lookup: (_hostname, _lookupOptions, callback) => {
      callback(null, resolvedAddress.address, resolvedAddress.family)
    },
  }

  return new Promise((resolve, reject) => {
    const request = transport.request(requestOptions, (message) => {
      resolve(responseFromMessage(url.toString(), message))
    })

    const abort = () => {
      request.destroy(new Error("URL fetch was aborted."))
    }
    if (options.signal.aborted) {
      abort()
      return
    }
    options.signal.addEventListener("abort", abort, { once: true })
    request.on("timeout", () => {
      logger.warn("Guarded URL fetch timed out.", {
        url: safeUrlForLog(url),
        timeoutMs: options.timeoutMs,
      })
      request.destroy(new Error("URL fetch timed out."))
    })
    request.on("error", (error) => {
      logger.warn("Guarded URL fetch request failed.", {
        url: safeUrlForLog(url),
        errorName: error.name,
        message: error.message,
      })
      reject(error)
    })
    request.on("close", () => {
      options.signal.removeEventListener("abort", abort)
    })
    request.end()
  })
}

async function resolvePublicAddress(
  url: URL,
  allowLocalOrPrivateHosts: boolean,
): Promise<{ readonly address: string; readonly family: 4 | 6 }> {
  const hostname = url.hostname
  const addresses = await lookup(hostname, { all: true, verbatim: false })
  const publicAddress = addresses.find((entry) => (
    allowLocalOrPrivateHosts || !isLocalOrPrivateHost(entry.address)
  ))
  if (!publicAddress) {
    logger.warn("Guarded URL fetch blocked local or private host.", {
      url: safeUrlForLog(url),
      hostname,
      addresses: addresses.map((entry) => entry.address),
    })
    throw new Error("Local and private network URLs are not allowed.")
  }
  return {
    address: publicAddress.address,
    family: publicAddress.family === 6 ? 6 : 4,
  }
}

function safeUrlForLog(url: URL): string {
  return sanitizeUrl(url.toString())
}

function responseFromMessage(url: string, message: IncomingMessage): GuardedFetchResponse {
  const headers = normalizeHeaders(message.headers)
  return {
    url,
    status: message.statusCode ?? 0,
    headers: {
      get(name: string): string | null {
        return headers.get(name.toLowerCase()) ?? null
      },
    },
    discard: () => discardResponseBody(message),
    text: (options) => readResponseText(message, options?.maxBytes),
    discardBody: () => discardResponseBody(message),
  }
}

function normalizeHeaders(headers: IncomingMessage["headers"]): Map<string, string> {
  const normalized = new Map<string, string>()
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      normalized.set(key.toLowerCase(), value.join(", "))
    } else if (typeof value === "string") {
      normalized.set(key.toLowerCase(), value)
    }
  }
  return normalized
}

function readResponseText(message: IncomingMessage, maxBytes?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let rejected = false
    message.on("data", (chunk: Buffer | string) => {
      if (rejected) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.byteLength
      if (maxBytes !== undefined && totalBytes > maxBytes) {
        rejected = true
        const error = new UrlResponseSizeLimitError(maxBytes)
        message.destroy(error)
        reject(error)
        return
      }
      chunks.push(buffer)
    })
    message.on("error", (error) => {
      if (!rejected) reject(error)
    })
    message.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString("utf8"))
    })
  })
}

function discardResponseBody(message: IncomingMessage): void {
  if (message.destroyed || message.readableEnded) return
  message.destroy()
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400
}
