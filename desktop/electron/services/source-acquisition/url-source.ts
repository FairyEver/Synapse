import { createHash } from "node:crypto"
import { isIP } from "node:net"

import { htmlToSourceMarkdown, sourceUrlFrontmatter } from "./html-to-source-markdown"

/**
 * URL acquisition deliberately injects the fetch boundary so production callers can enforce network policy.
 *
 * Implementations must not blindly follow redirects. They must validate every redirect target before connecting,
 * reject resolved loopback/private/link-local IPs before opening a socket, and expose the final accepted URL here.
 * acquireUrlSource validates the original URL and returned final URL, but DNS resolution and pre-connect checks
 * are the FetchUrl implementation's responsibility.
 */
export type FetchUrl = (url: string, init: { readonly signal: AbortSignal }) => Promise<{
  readonly url: string
  readonly status: number
  readonly headers: { get(name: string): string | null }
  text(): Promise<string>
}>

export interface AcquireUrlSourceInput {
  readonly url: string
  readonly fetchUrl: FetchUrl
  readonly now: () => Date
  readonly signal?: AbortSignal
  readonly maxBytes?: number
  readonly allowLocalOrPrivateHosts?: boolean
}

export interface AcquiredUrlSource {
  readonly originalUrl: string
  readonly finalUrl: string
  readonly contentType: string
  readonly fetchedAt: string
  readonly markdown: string
  readonly hash: string
}

export type UrlSourceErrorCode =
  | "invalid_url"
  | "unsupported_protocol"
  | "url_credentials"
  | "local_or_private_host"
  | "http_error"
  | "unsupported_content_type"
  | "size_limit_exceeded"
  | "network_error"

export type AcquireUrlSourceResult =
  | { readonly ok: true; readonly source: AcquiredUrlSource }
  | { readonly ok: false; readonly code: UrlSourceErrorCode; readonly message: string }

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])

export async function acquireUrlSource(input: AcquireUrlSourceInput): Promise<AcquireUrlSourceResult> {
  const originalUrl = normalizeUrl(input.url)
  if (!originalUrl.ok) return originalUrl

  const allowedOriginal = validateAllowedUrl(originalUrl.url, input.allowLocalOrPrivateHosts === true)
  if (!allowedOriginal.ok) return allowedOriginal

  const controller = input.signal ? null : new AbortController()
  const signal = input.signal ?? controller?.signal
  if (!signal) {
    return { ok: false, code: "network_error", message: "Abort signal could not be created." }
  }

  let response: Awaited<ReturnType<FetchUrl>>
  try {
    response = await input.fetchUrl(originalUrl.url.toString(), { signal })
  } catch (error) {
    return {
      ok: false,
      code: "network_error",
      message: error instanceof Error ? error.message : "URL fetch failed.",
    }
  }

  const finalUrl = normalizeUrl(response.url || originalUrl.url.toString())
  if (!finalUrl.ok) return finalUrl

  const allowedFinal = validateAllowedUrl(finalUrl.url, input.allowLocalOrPrivateHosts === true)
  if (!allowedFinal.ok) return allowedFinal

  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      code: "http_error",
      message: `URL fetch failed with HTTP status ${response.status}.`,
    }
  }

  const contentType = normalizeContentType(response.headers.get("content-type"))
  const contentLength = response.headers.get("content-length")
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES
  if (contentLength && Number.isFinite(Number(contentLength)) && Number(contentLength) > maxBytes) {
    return {
      ok: false,
      code: "size_limit_exceeded",
      message: `URL response exceeds the ${maxBytes} byte limit.`,
    }
  }

  let text: string
  try {
    text = await response.text()
  } catch (error) {
    return {
      ok: false,
      code: "network_error",
      message: error instanceof Error ? error.message : "URL response could not be read.",
    }
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return {
      ok: false,
      code: "size_limit_exceeded",
      message: `URL response exceeds the ${maxBytes} byte limit.`,
    }
  }

  const fetchedAt = input.now().toISOString()
  const markdown = sourceMarkdownForContent({
    text,
    originalUrl: originalUrl.url.toString(),
    finalUrl: finalUrl.url.toString(),
    fetchedAt,
    contentType,
  })
  if (!markdown.ok) return markdown

  return {
    ok: true,
    source: {
      originalUrl: originalUrl.url.toString(),
      finalUrl: finalUrl.url.toString(),
      contentType,
      fetchedAt,
      markdown: markdown.markdown,
      hash: createHash("sha256").update(markdown.markdown).digest("hex"),
    },
  }
}

function sourceMarkdownForContent(input: {
  readonly text: string
  readonly originalUrl: string
  readonly finalUrl: string
  readonly fetchedAt: string
  readonly contentType: string
}): { readonly ok: true; readonly markdown: string } | { readonly ok: false; readonly code: "unsupported_content_type"; readonly message: string } {
  const mediaType = input.contentType
  if (mediaType === "text/html" || mediaType === "application/xhtml+xml") {
    return {
      ok: true,
      markdown: htmlToSourceMarkdown({
        html: input.text,
        sourceUrl: input.originalUrl,
        sourceFinalUrl: input.finalUrl,
        fetchedAt: input.fetchedAt,
        contentType: input.contentType,
      }),
    }
  }

  if (mediaType.startsWith("text/") || mediaType === "application/json") {
    return {
      ok: true,
      markdown: [
        sourceUrlFrontmatter({
          sourceUrl: input.originalUrl,
          sourceFinalUrl: input.finalUrl,
          fetchedAt: input.fetchedAt,
          contentType: input.contentType,
        }),
        "```text",
        input.text.trim(),
        "```",
        "",
      ].join("\n"),
    }
  }

  return {
    ok: false,
    code: "unsupported_content_type",
    message: `URL content type is not supported: ${input.contentType}`,
  }
}

function normalizeContentType(value: string | null): string {
  return value?.split(";")[0]?.trim().toLowerCase() || "text/plain"
}

function normalizeUrl(rawUrl: string): { readonly ok: true; readonly url: URL } | { readonly ok: false; readonly code: "invalid_url"; readonly message: string } {
  try {
    return { ok: true, url: new URL(rawUrl) }
  } catch {
    return { ok: false, code: "invalid_url", message: "URL is invalid." }
  }
}

function validateAllowedUrl(
  url: URL,
  allowLocalOrPrivateHosts: boolean,
): { readonly ok: true } | { readonly ok: false; readonly code: Exclude<UrlSourceErrorCode, "network_error" | "http_error" | "size_limit_exceeded" | "unsupported_content_type" | "invalid_url">; readonly message: string } {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return {
      ok: false,
      code: "unsupported_protocol",
      message: `URL protocol is not supported: ${url.protocol}`,
    }
  }

  if (url.username || url.password) {
    return {
      ok: false,
      code: "url_credentials",
      message: "URL credentials are not allowed.",
    }
  }

  if (!allowLocalOrPrivateHosts && isLocalOrPrivateHost(url.hostname)) {
    return {
      ok: false,
      code: "local_or_private_host",
      message: "Local and private network URLs are not allowed.",
    }
  }

  return { ok: true }
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "")
  if (host === "localhost" || host.endsWith(".localhost")) return true

  const ipVersion = isIP(host)
  if (ipVersion === 4) return isPrivateIpv4(host)
  if (ipVersion === 6) return isPrivateIpv6(host)
  return false
}

function isPrivateIpv4(host: string): boolean {
  const octets = host.split(".").map((part) => Number(part))
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [first, second] = octets
  if (first === 0 || first === 10 || first === 127) return true
  if (first === 169 && second === 254) return true
  if (first === 172 && second >= 16 && second <= 31) return true
  if (first === 192 && second === 168) return true
  return false
}

function isPrivateIpv6(host: string): boolean {
  const mappedIpv4 = ipv4FromMappedIpv6(host)
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4)

  if (host === "::1" || host === "::") return true
  const normalized = host.toLowerCase()
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true
  return false
}

function ipv4FromMappedIpv6(host: string): string | null {
  const normalized = host.toLowerCase()
  const prefix = "::ffff:"
  if (!normalized.startsWith(prefix)) return null

  const tail = normalized.slice(prefix.length)
  if (isIP(tail) === 4) return tail

  const groups = tail.split(":")
  if (groups.length > 2 || groups.some((group) => group.length === 0)) return null
  const paddedGroups = groups.length === 1 ? ["0", groups[0]] : groups
  const high = Number.parseInt(paddedGroups[0], 16)
  const low = Number.parseInt(paddedGroups[1], 16)
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || high > 0xffff || low < 0 || low > 0xffff) {
    return null
  }

  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join(".")
}
