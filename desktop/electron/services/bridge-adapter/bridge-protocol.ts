import { z } from "zod"

const metadataSchema = z.record(z.string(), z.unknown()).optional()
const SENSITIVE_METADATA_VALUE_PATTERN =
  /\b(token|secret|authorization|password|credential|apiKey|api_key|cookie)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,;]+?)(?=\s+\b(?:token|secret|authorization|password|credential|apiKey|api_key|cookie)\b\s*[:=]|$|[,;])/gi

export const bridgeRegisterSchema = z.object({
  type: z.literal("register"),
  platform: z.string().trim().min(1),
  capabilities: z.array(z.string().trim().min(1)).optional().default([]),
  project: z.string().trim().min(1).optional(),
  metadata: metadataSchema,
})

const bridgeAttachmentSchema = z.object({
  mime_type: z.string().trim().min(1),
  data: z.string().min(1),
  file_name: z.string().trim().min(1).optional(),
})

const bridgeFileAttachmentSchema = bridgeAttachmentSchema.extend({
  file_name: z.string().trim().min(1),
})

export const bridgeMessageSchema = z.object({
  type: z.literal("message"),
  msg_id: z.string().trim().min(1).optional(),
  session_key: z.string().trim().min(1),
  user_id: z.string().trim().min(1),
  user_name: z.string().trim().min(1).optional(),
  content: z.string(),
  reply_ctx: z.unknown(),
  project: z.string().trim().min(1).optional(),
  images: z.array(bridgeAttachmentSchema).optional().default([]),
  files: z.array(bridgeFileAttachmentSchema).optional().default([]),
})

export const bridgeCardActionSchema = z.object({
  type: z.literal("card_action"),
  session_key: z.string().trim().min(1),
  action: z.string().trim().min(1),
  reply_ctx: z.unknown(),
  project: z.string().trim().min(1).optional(),
})

export const bridgePingSchema = z.object({
  type: z.literal("ping"),
})

export const bridgePreviewAckSchema = z.object({
  type: z.literal("preview_ack"),
  ref_id: z.string().trim().min(1),
  preview_handle: z.string().trim().min(1).optional(),
  session_key: z.string().trim().min(1).optional(),
})

export const bridgeBaseSchema = z.object({
  type: z.string().trim().min(1),
})

export type BridgeRegister = z.infer<typeof bridgeRegisterSchema>
export type BridgeMessage = z.infer<typeof bridgeMessageSchema>
export type BridgeCardAction = z.infer<typeof bridgeCardActionSchema>
export type BridgePreviewAck = z.infer<typeof bridgePreviewAckSchema>

export type BridgeProtocolError = {
  readonly code: string
  readonly message: string
}

export function parseBridgeBase(value: unknown):
  | { readonly ok: true; readonly type: string }
  | { readonly ok: false; readonly error: BridgeProtocolError } {
  const parsed = bridgeBaseSchema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, error: zodError("invalid_message", parsed.error) }
  }
  return { ok: true, type: parsed.data.type }
}

export function parseBridgeRegister(value: unknown):
  | { readonly ok: true; readonly value: BridgeRegister }
  | { readonly ok: false; readonly error: BridgeProtocolError } {
  const parsed = bridgeRegisterSchema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, error: zodError("invalid_register", parsed.error) }
  }
  return { ok: true, value: parsed.data }
}

export function parseBridgeMessage(value: unknown):
  | { readonly ok: true; readonly value: BridgeMessage }
  | { readonly ok: false; readonly error: BridgeProtocolError } {
  const parsed = bridgeMessageSchema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, error: zodError("invalid_message", parsed.error) }
  }
  return { ok: true, value: parsed.data }
}

export function parseBridgeCardAction(value: unknown):
  | { readonly ok: true; readonly value: BridgeCardAction }
  | { readonly ok: false; readonly error: BridgeProtocolError } {
  const parsed = bridgeCardActionSchema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, error: zodError("invalid_card_action", parsed.error) }
  }
  return { ok: true, value: parsed.data }
}

export function parseBridgePreviewAck(value: unknown):
  | { readonly ok: true; readonly value: BridgePreviewAck }
  | { readonly ok: false; readonly error: BridgeProtocolError } {
  const parsed = bridgePreviewAckSchema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, error: zodError("invalid_preview_ack", parsed.error) }
  }
  return { ok: true, value: parsed.data }
}

export function normalizeCapabilities(capabilities: readonly string[]): Set<string> {
  const values = new Set<string>()
  for (const capability of capabilities) {
    const clean = capability.trim()
    if (clean) values.add(clean)
  }
  values.add("text")
  return values
}

export function sanitizeBridgeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (/token|secret|authorization|password|key/i.test(key)) continue
    result[key] = sanitizeMetadataValue(value)
  }
  return result
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeMetadataValue)
  }
  if (typeof value === "string") {
    return value.replace(SENSITIVE_METADATA_VALUE_PATTERN, (_match, key: string, separator: string) =>
      `${key}${separator}[redacted]`)
  }
  if (typeof value === "object" && value !== null) {
    return sanitizeBridgeMetadata(value as Record<string, unknown>)
  }
  return value
}

function zodError(code: string, error: z.ZodError): BridgeProtocolError {
  const issue = error.issues[0]
  return {
    code,
    message: issue ? `${issue.path.join(".") || "message"}: ${issue.message}` : error.message,
  }
}
