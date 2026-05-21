import { readFile, stat } from "node:fs/promises"
import { nativeImage } from "electron"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import { ContentCapabilityError } from "./content-capability-errors"
import { CONTENT_ICON_IMAGE_MAX_BYTES } from "./content-capability-validator"

const ICON_IMAGE_OUTPUT_SIZE = 256

type ContentIconImageSecurityDeps = {
  actor: ActorIdentity
  auditSink: AuditSink
  permissionGuard: PermissionGuard
}

type ContentIconImageInput = {
  iconImageBase64?: unknown
  iconImagePath?: unknown
}

async function prepareContentIconImageBytes(
  input: ContentIconImageInput,
  security?: ContentIconImageSecurityDeps,
): Promise<Uint8Array | undefined> {
  const iconImagePath = optionalTrimmedString(input.iconImagePath)
  const iconImageBase64 = optionalTrimmedString(input.iconImageBase64)

  if (!iconImagePath && !iconImageBase64) {
    return undefined
  }

  if (iconImagePath && iconImageBase64) {
    throwInvalid("iconImage", "iconImagePath 和 iconImageBase64 只能提供一个。")
  }

  const sourceBytes = iconImagePath
    ? await readIconImagePath(iconImagePath, security)
    : decodeIconImageBase64(iconImageBase64)

  return normalizeIconImageBytes(sourceBytes)
}

async function readIconImagePath(
  iconImagePath: string,
  security?: ContentIconImageSecurityDeps,
): Promise<Uint8Array> {
  const auditMetadata = { operation: "read-content-icon-image" }
  await checkIconImageReadPermission(security, iconImagePath, auditMetadata)

  try {
    const info = await stat(iconImagePath)
    if (!info.isFile()) {
      throwInvalid("iconImagePath", "iconImagePath 必须指向图片文件。")
    }
    if (info.size > CONTENT_ICON_IMAGE_MAX_BYTES) {
      throwInvalid("iconImagePath", "图片超过大小限制。")
    }

    const bytes = await readFile(iconImagePath)
    recordIconImageAudit(security, iconImagePath, "allowed", auditMetadata)
    return new Uint8Array(bytes)
  } catch (error) {
    recordIconImageAudit(security, iconImagePath, "failed", auditMetadata)
    throw error
  }
}

function decodeIconImageBase64(value: string): Uint8Array {
  if (!isValidBase64(value)) {
    throwInvalid("iconImageBase64", "iconImageBase64 不是有效的 base64。")
  }

  const bytes = Buffer.from(value, "base64")
  if (bytes.byteLength > CONTENT_ICON_IMAGE_MAX_BYTES) {
    throwInvalid("iconImageBase64", "图片超过大小限制。")
  }

  return new Uint8Array(bytes)
}

function normalizeIconImageBytes(sourceBytes: Uint8Array): Uint8Array {
  if (sourceBytes.byteLength === 0) {
    throwInvalid("iconImage", "图片不能为空。")
  }

  const image = nativeImage.createFromBuffer(Buffer.from(sourceBytes))
  if (image.isEmpty()) {
    throwInvalid("iconImage", "无法识别图片文件。")
  }

  const size = image.getSize()
  if (size.width <= 0 || size.height <= 0) {
    throwInvalid("iconImage", "无法识别图片尺寸。")
  }

  const side = Math.min(size.width, size.height)
  const cropped = image.crop({
    x: Math.floor((size.width - side) / 2),
    y: Math.floor((size.height - side) / 2),
    width: side,
    height: side,
  })
  const resized = cropped.resize({
    height: ICON_IMAGE_OUTPUT_SIZE,
    quality: "best",
    width: ICON_IMAGE_OUTPUT_SIZE,
  })
  const pngBytes = resized.toPNG()

  if (pngBytes.byteLength === 0) {
    throwInvalid("iconImage", "图片处理失败。")
  }

  return new Uint8Array(pngBytes)
}

async function checkIconImageReadPermission(
  deps: ContentIconImageSecurityDeps | undefined,
  resource: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!deps) return
  const permission = await deps.permissionGuard.check({
    action: "fs.read.outside-userdata",
    actor: deps.actor,
    context: metadata,
    resource,
  })
  if (!permission.allowed) {
    deps.auditSink.record({
      action: "fs.read.outside-userdata",
      actor: deps.actor,
      metadata: {
        ...metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
      outcome: "denied",
      resource,
    })
    throw new ContentCapabilityError("CONTENT_FORBIDDEN", permission.reason)
  }
}

function recordIconImageAudit(
  deps: ContentIconImageSecurityDeps | undefined,
  resource: string,
  outcome: "allowed" | "failed",
  metadata: Record<string, unknown>,
): void {
  deps?.auditSink.record({
    action: "fs.read.outside-userdata",
    actor: deps.actor,
    metadata,
    outcome,
    resource,
  })
}

function optionalTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function isValidBase64(value: string): boolean {
  if (!value || value.length % 4 === 1) return false
  return /^[A-Za-z0-9+/]+={0,2}$/u.test(value)
}

function throwInvalid(field: string, message: string): never {
  throw new ContentCapabilityError("CONTENT_INVALID_INPUT", message, {
    fields: { [field]: message },
  })
}

export {
  ICON_IMAGE_OUTPUT_SIZE,
  prepareContentIconImageBytes,
  type ContentIconImageInput,
  type ContentIconImageSecurityDeps,
}
