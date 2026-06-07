import { BadRequestException, UnsupportedMediaTypeException } from "@nestjs/common"

const sensitiveKeyPattern = /authorization|cookie|token|secret|password|credential|api[-_]?key/i
const sensitiveTextLinePattern = /^([^=\s:]+)\s*[:=]\s*(.+)$/u
const bearerPattern = /\bbearer\s+[^,\s;]+/giu
const cookieFragmentPattern = /\bcookie\s*[:=]\s*.+?(?=(?:\s+(?:and|plus|with)\s+\b(?:authorization|bearer|token|secret|password|credential|api[-_]?key)\b)|[,\n]|$)/giu
const sensitiveAssignmentPattern = /\b(authorization|token|secret|password|credential|api[-_]?key)\s*[:=]\s*[^,\s;]+/giu
const maxPreviewChars = 2_000

export interface WebhookBodySummary {
  readonly bodyKind: string
  readonly bodySize: number
  readonly body: unknown
  readonly bodyText?: string
  readonly bodyPreview?: string
}

type WebhookLogRequestLike = {
  readonly id?: unknown
  readonly method?: unknown
  readonly originalUrl?: unknown
  readonly path?: unknown
  readonly url?: unknown
  readonly query?: unknown
  readonly params?: unknown
  readonly headers?: unknown
  readonly socket?: unknown
  readonly info?: unknown
}

export function sanitizeWebhookHeaders(headers: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    const key = rawKey.toLowerCase()
    result[key] = isSensitiveKey(key) ? "[redacted]" : stringifyHeader(rawValue)
  }
  return result
}

export function sanitizeWebhookQuery(
  query: Record<string, string | readonly string[]>,
): Record<string, string | readonly string[]> {
  const result: Record<string, string | readonly string[]> = {}
  for (const [key, value] of Object.entries(query)) {
    result[key] = isSensitiveKey(key)
      ? "[redacted]"
      : Array.isArray(value) ? value.map(String) : String(value)
  }
  return result
}

export function sanitizeWebhookLogUrl(url: string | undefined): string | undefined {
  if (!url) return url

  const fragmentIndex = url.indexOf("#")
  const hasFragment = fragmentIndex >= 0
  const urlWithoutFragment = hasFragment ? url.slice(0, fragmentIndex) : url
  const fragment = hasFragment ? url.slice(fragmentIndex) : ""
  const queryIndex = urlWithoutFragment.indexOf("?")
  const path = queryIndex >= 0 ? urlWithoutFragment.slice(0, queryIndex) : urlWithoutFragment
  const query = queryIndex >= 0 ? urlWithoutFragment.slice(queryIndex) : ""

  return `${sanitizeWebhookLogPath(path)}${query}${fragment}`
}

export function sanitizeWebhookLogRequest(request: WebhookLogRequestLike): Record<string, unknown> {
  const connection = recordValue(request.info) ?? recordValue(request.socket)
  return compactUndefined({
    id: typeof request.id === "function" ? request.id() : request.id,
    method: request.method,
    url: sanitizeWebhookLogUrl(resolveRequestLogUrl(request)),
    query: sanitizeWebhookLogParams(request.query),
    params: sanitizeWebhookLogParams(request.params),
    headers: request.headers,
    remoteAddress: connection?.remoteAddress,
    remotePort: connection?.remotePort,
  })
}

export function summarizeWebhookBody(body: Buffer, contentType = ""): WebhookBodySummary {
  const normalizedContentType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? ""
  const bodySize = body.byteLength

  if (bodySize === 0) {
    return {
      bodyKind: "empty",
      bodySize,
      body: null,
      bodyPreview: "",
    }
  }

  if (normalizedContentType === "application/json" || normalizedContentType.endsWith("+json")) {
    const parsed = parseJsonBody(body)
    const redacted = redactValue(parsed)
    return {
      bodyKind: "json",
      bodySize,
      body: redacted,
      bodyPreview: preview(JSON.stringify(redacted)),
    }
  }

  if (normalizedContentType === "application/x-www-form-urlencoded") {
    const params = new URLSearchParams(body.toString("utf8"))
    const parsed: Record<string, string | readonly string[]> = {}
    for (const [key, value] of params.entries()) {
      const existing = parsed[key]
      if (existing === undefined) {
        parsed[key] = value
      } else {
        parsed[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
      }
    }
    const redacted = redactValue(parsed)
    return {
      bodyKind: "form",
      bodySize,
      body: redacted,
      bodyPreview: preview(JSON.stringify(redacted)),
    }
  }

  if (normalizedContentType === "" || normalizedContentType.startsWith("text/")) {
    const bodyText = redactText(body.toString("utf8"))
    return {
      bodyKind: "text",
      bodySize,
      body: { text: bodyText },
      bodyText,
      bodyPreview: preview(bodyText),
    }
  }

  throw new UnsupportedMediaTypeException("Unsupported webhook content type")
}

function sanitizeWebhookLogPath(path: string): string {
  return path.replace(
    /^((?:https?:\/\/[^/?#]+)?\/webhooks\/[^/?#]+)\/[^/?#]+(.*)$/iu,
    "$1/***$2",
  )
}

function sanitizeWebhookLogParams(params: unknown): unknown {
  if (Array.isArray(params)) return params.map(sanitizeWebhookLogParams)
  if (!params || typeof params !== "object") return params

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (isSensitiveKey(key)) {
      result[key] = "[redacted]"
      continue
    }

    if (key === "path" && isWebhookPathParams(value)) {
      result[key] = value.map((part, index) => index === 2 ? "[redacted]" : part)
      continue
    }

    result[key] = sanitizeWebhookLogParams(value)
  }
  return result
}

function isWebhookPathParams(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.length >= 3
    && value[0] === "webhooks"
    && typeof value[1] === "string"
    && typeof value[2] === "string"
}

function resolveRequestLogUrl(request: WebhookLogRequestLike): string | undefined {
  if (typeof request.originalUrl === "string") return request.originalUrl
  if (typeof request.path === "string") return request.path
  if (typeof request.url === "string") return request.url

  const url = recordValue(request.url)
  return typeof url?.path === "string" ? url.path : undefined
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}

function compactUndefined(values: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) result[key] = value
  }
  return result
}

function stringifyHeader(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ")
  return typeof value === "string" ? value : String(value ?? "")
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue)
  if (!value || typeof value !== "object") return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? "[redacted]" : redactValue(child)
  }
  return result
}

function redactText(value: string): string {
  const lineRedacted = value.split(/\r?\n/u).map((line) => {
    const match = sensitiveTextLinePattern.exec(line)
    if (!match) return line
    const [, key] = match
    return key && isSensitiveKey(key) ? `${key}=[redacted]` : line
  }).join("\n")
  return lineRedacted
    .replace(bearerPattern, "Bearer [redacted]")
    .replace(cookieFragmentPattern, "Cookie: [redacted]")
    .replace(sensitiveAssignmentPattern, (_match, key: string) => `${key}=[redacted]`)
}

function preview(value: string): string {
  return value.length > maxPreviewChars
    ? `${value.slice(0, maxPreviewChars)}[truncated]`
    : value
}

function isSensitiveKey(key: string): boolean {
  return sensitiveKeyPattern.test(key)
}

function parseJsonBody(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf8"))
  } catch {
    throw new BadRequestException("Webhook JSON body is invalid")
  }
}
