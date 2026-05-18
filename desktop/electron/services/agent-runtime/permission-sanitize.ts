const MAX_PERMISSION_TEXT_RUNES = 240

export function sanitizePermissionText(value: string | undefined): string | undefined {
  if (!value) return value
  return truncateRunes(
    value
      .replace(
        /\b(api[-_]?key|authorization|cookie|password|credential|secret|token)\b(\s*[:=]\s*)(?:(Bearer)\s+)?[^\s,;'"`]+/gi,
        (_match, key: string, separator: string, bearer: string | undefined) =>
          `${key}${separator}${bearer ? `${bearer} ` : ""}[redacted]`,
      )
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
      .replace(/\b[A-Za-z]:\\(?:[^\\\s"')]+\\)+[^\\\s"'),;]+/g, "[path redacted]")
      .replace(/(^|[\s("'])\/(?:[^/\s"')]+\/)+[^/\s"'),;]+/g, "$1[path redacted]"),
    MAX_PERMISSION_TEXT_RUNES,
  )
}

export function sanitizePermissionRawInput(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value) return undefined
  return sanitizePermissionValue(value) as Record<string, unknown>
}

export function formatPermissionBody(
  toolName: string,
  toolInput: string | undefined,
  toolInputRaw: Record<string, unknown> | undefined,
  maxRunes = 500,
): string {
  const sanitizedText = sanitizePermissionText(toolInput)
  if (sanitizedText) return truncateRunes(`${toolName}\n\n${sanitizedText}`, maxRunes)

  const sanitizedRaw = sanitizePermissionRawInput(toolInputRaw)
  if (sanitizedRaw) {
    const formatted = JSON.stringify(sanitizedRaw, null, 2)
    return truncateRunes(`${toolName}\n\n${formatted}`, maxRunes)
  }

  return toolName
}

function sanitizePermissionValue(value: unknown, key = ""): unknown {
  if (isSensitiveKey(key)) return "[redacted]"
  if (typeof value === "string") return sanitizePermissionText(value)
  if (Array.isArray(value)) return value.map((item) => sanitizePermissionValue(item, key))
  if (!value || typeof value !== "object") return value

  const output: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    output[childKey] = sanitizePermissionValue(childValue, childKey)
  }
  return output
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "")
  return normalized.includes("secret")
    || normalized.includes("apikey")
    || normalized.includes("authorization")
    || normalized.includes("cookie")
    || normalized.includes("password")
    || normalized.includes("credential")
    || (normalized.includes("token") && !normalized.endsWith("tokens"))
}

function truncateRunes(value: string, maxRunes: number): string {
  const runes = [...value]
  if (runes.length <= maxRunes) return value
  return `${runes.slice(0, maxRunes).join("")}...`
}
