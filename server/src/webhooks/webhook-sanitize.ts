import { BadRequestException, UnsupportedMediaTypeException } from "@nestjs/common"

const sensitiveKeyPattern = /authorization|cookie|token|secret|password|credential|api[-_]?key/i
const sensitiveTextLinePattern = /^([^=\s:]+)\s*[:=]\s*(.+)$/u
const bearerPattern = /\bbearer\s+[^,\s;]+/giu
const cookieFragmentPattern = /\bcookie\s*[:=]\s*[^,\n;]+/giu
const sensitiveAssignmentPattern = /\b(authorization|token|secret|password|credential|api[-_]?key)\s*[:=]\s*[^,\s;]+/giu
const maxPreviewChars = 2_000

export interface WebhookBodySummary {
  readonly bodyKind: string
  readonly bodySize: number
  readonly body: unknown
  readonly bodyText?: string
  readonly bodyPreview?: string
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
