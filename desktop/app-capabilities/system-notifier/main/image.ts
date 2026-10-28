import { lstat, readFile } from "node:fs/promises"
import path from "node:path"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../../../electron/runtime/security"

export const NOTIFICATION_IMAGE_MAX_BYTES = 10 * 1024 * 1024

export type NotificationImageReadFailure =
  | "not_absolute" | "not_found" | "not_regular_file" | "unreadable"
  | "permission_denied" | "unsupported_type" | "too_large"

export function detectNotificationImageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif"
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp"
  return null
}

export type NotificationImageReadResult =
  | { ok: true; bytes: Buffer; mimeType: string }
  | { ok: false; reason: NotificationImageReadFailure }

export async function readNotificationImageFile(input: {
  filePath: string
  actor: ActorIdentity
  permissionGuard?: PermissionGuard
  auditSink?: AuditSink
  metadata: Record<string, unknown>
}): Promise<NotificationImageReadResult> {
  const audit = (
    outcome: "allowed" | "denied" | "failed",
    metadata: Record<string, unknown>,
  ): void => {
    input.auditSink?.record({
      action: "fs.read.outside-userdata",
      actor: input.actor,
      resource: path.basename(input.filePath),
      outcome,
      metadata,
    })
  }
  const fail = (reason: NotificationImageReadFailure): NotificationImageReadResult => {
    audit("failed", { ...input.metadata, reason })
    return { ok: false, reason }
  }

  if (!path.isAbsolute(input.filePath)) return { ok: false, reason: "not_absolute" }

  if (input.permissionGuard) {
    const permission = await input.permissionGuard.check({
      action: "fs.read.outside-userdata",
      actor: input.actor,
      resource: input.filePath,
      context: input.metadata,
    })
    if (!permission.allowed) {
      audit("denied", { ...input.metadata, reason: "permission_denied" })
      return { ok: false, reason: "permission_denied" }
    }
  }

  let info
  try {
    info = await lstat(input.filePath)
  } catch (error) {
    return fail((error as NodeJS.ErrnoException).code === "ENOENT" ? "not_found" : "unreadable")
  }
  if (!info.isFile()) return fail("not_regular_file")
  if (info.size > NOTIFICATION_IMAGE_MAX_BYTES) return fail("too_large")

  let bytes: Buffer
  try {
    bytes = await readFile(input.filePath)
  } catch {
    return fail("unreadable")
  }
  const mimeType = detectNotificationImageMime(bytes)
  if (!mimeType) return fail("unsupported_type")
  audit("allowed", { ...input.metadata, mimeType, byteSize: bytes.byteLength })
  return { ok: true, bytes, mimeType }
}
