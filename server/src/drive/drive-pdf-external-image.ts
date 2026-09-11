import dns from "node:dns/promises"
import http from "node:http"
import https from "node:https"
import { isIP } from "node:net"
import ipaddr from "ipaddr.js"
import { detectPublicAssetImageType } from "./drive-public-asset-policy"

const allowedPorts = new Set(["", "80", "443"])
const redirectStatuses = new Set([301, 302, 303, 307, 308])

export type ExternalImageFetchOptions = {
  readonly maxBytes: number
  readonly timeoutMs: number
  readonly maxRedirects?: number
  readonly signal?: AbortSignal
}

export async function fetchSafeExternalImage(
  source: string,
  options: ExternalImageFetchOptions,
): Promise<{ readonly bytes: Buffer; readonly mimeType: string }> {
  const startedAt = Date.now()
  let url = parseExternalImageUrl(source)
  const maxRedirects = options.maxRedirects ?? 3
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const remainingMs = options.timeoutMs - (Date.now() - startedAt)
    if (remainingMs <= 0) throw new Error("EXTERNAL_IMAGE_TIMEOUT")
    const address = await resolvePublicAddress(normalizeUrlHostname(url.hostname), remainingMs, options.signal)
    const response = await requestPinned(url, address, { ...options, timeoutMs: remainingMs })
    if (redirectStatuses.has(response.statusCode)) {
      response.stream.resume()
      const location = response.location
      if (!location || redirects === maxRedirects) throw new Error("EXTERNAL_IMAGE_REDIRECT_INVALID")
      url = parseExternalImageUrl(new URL(location, url).toString())
      continue
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.stream.resume()
      throw new Error("EXTERNAL_IMAGE_HTTP_ERROR")
    }
    const bytes = await readLimitedResponse(response.stream, options.maxBytes)
    const detectedMime = detectPublicAssetImageType(bytes)
    if (!detectedMime || detectedMime === "image/svg+xml") throw new Error("EXTERNAL_IMAGE_FORMAT_INVALID")
    if (response.contentType && normalizeImageMimeType(response.contentType) !== detectedMime) {
      throw new Error("EXTERNAL_IMAGE_MIME_INVALID")
    }
    return { bytes, mimeType: detectedMime }
  }
  throw new Error("EXTERNAL_IMAGE_REDIRECT_INVALID")
}

function parseExternalImageUrl(source: string): URL {
  const url = new URL(source)
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || !allowedPorts.has(url.port)) {
    throw new Error("EXTERNAL_IMAGE_URL_INVALID")
  }
  return url
}

async function resolvePublicAddress(
  hostname: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ readonly address: string; readonly family: 4 | 6 }> {
  const candidates = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) as 4 | 6 }]
    : await withTimeout(dns.lookup(hostname, { all: true, verbatim: true }), timeoutMs, signal)
  if (candidates.length === 0 || candidates.some((candidate) => !isPublicAddress(candidate.address))) {
    throw new Error("EXTERNAL_IMAGE_ADDRESS_BLOCKED")
  }
  const selected = candidates[0]
  return { address: selected.address, family: selected.family as 4 | 6 }
}

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address)
    return parsed.range() === "unicast"
  } catch {
    return false
  }
}

function requestPinned(
  url: URL,
  resolved: { readonly address: string; readonly family: 4 | 6 },
  options: ExternalImageFetchOptions,
): Promise<{
  readonly statusCode: number
  readonly location?: string
  readonly contentType?: string
  readonly stream: http.IncomingMessage
}> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("EXTERNAL_IMAGE_ABORTED"))
      return
    }
    const client = url.protocol === "https:" ? https : http
    let deadline: NodeJS.Timeout | undefined
    const request = client.get(url, {
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/x-icon",
        "User-Agent": "Synapse-PDF-Exporter/1",
      },
      lookup: (_hostname, _options, callback) => callback(null, resolved.address, resolved.family),
    }, (response) => {
      response.once("close", () => {
        if (deadline) clearTimeout(deadline)
      })
      resolve({
        statusCode: response.statusCode ?? 0,
        location: typeof response.headers.location === "string" ? response.headers.location : undefined,
        contentType: typeof response.headers["content-type"] === "string" ? response.headers["content-type"] : undefined,
        stream: response,
      })
    })
    deadline = setTimeout(() => request.destroy(new Error("EXTERNAL_IMAGE_TIMEOUT")), options.timeoutMs)
    const abort = () => request.destroy(new Error("EXTERNAL_IMAGE_ABORTED"))
    options.signal?.addEventListener("abort", abort, { once: true })
    request.setTimeout(options.timeoutMs, () => request.destroy(new Error("EXTERNAL_IMAGE_TIMEOUT")))
    request.once("error", (error) => {
      if (deadline) clearTimeout(deadline)
      options.signal?.removeEventListener("abort", abort)
      reject(error)
    })
    request.once("close", () => options.signal?.removeEventListener("abort", abort))
  })
}

function normalizeUrlHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname
}

function normalizeImageMimeType(value: string): string {
  const mimeType = value.split(";", 1)[0]?.trim().toLowerCase() ?? ""
  if (mimeType === "image/jpg" || mimeType === "image/pjpeg") return "image/jpeg"
  if (mimeType === "image/vnd.microsoft.icon" || mimeType === "image/ico") return "image/x-icon"
  return mimeType
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  let timeout: NodeJS.Timeout | undefined
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("EXTERNAL_IMAGE_TIMEOUT")), timeoutMs)
      }),
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(new Error("EXTERNAL_IMAGE_ABORTED"))
        if (signal?.aborted) abort()
        else signal?.addEventListener("abort", abort, { once: true })
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    if (abort) signal?.removeEventListener("abort", abort)
  }
}

async function readLimitedResponse(stream: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(stream.headers["content-length"] ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    stream.destroy()
    throw new Error("EXTERNAL_IMAGE_TOO_LARGE")
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.length
    if (total > maxBytes) {
      stream.destroy()
      throw new Error("EXTERNAL_IMAGE_TOO_LARGE")
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, total)
}
