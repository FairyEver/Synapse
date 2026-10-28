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

export async function readNotificationImageFile(input: {
  filePath: string
  actor: ActorIdentity
  permissionGuard?: PermissionGuard
  auditSink?: AuditSink
  metadata: Record<string, unknown>
}): Promise<{ ok: true; bytes: Buffer; mimeType: string } | { ok: false; reason: NotificationImageReadFailure }> {
  if (!path.isAbsolute(input.filePath)) return { ok: false, reason: "not_absolute" }

  if (input.permissionGuard) {
    const permission = await input.permissionGuard.check({
      action: "fs.read.outside-userdata",
      actor: input.actor,
      resource: input.filePath,
      context: input.metadata,
    })
    input.auditSink?.record({
      action: "fs.read.outside-userdata",
      actor: input.actor,
      resource: path.basename(input.filePath),
      outcome: permission.allowed ? "allowed" : "denied",
      metadata: permission.allowed ? input.metadata : { ...input.metadata, reason: "permission_denied" },
    })
    if (!permission.allowed) return { ok: false, reason: "permission_denied" }
  }

  let info
  try {
    info = await lstat(input.filePath)
  } catch (error) {
    return { ok: false, reason: (error as NodeJS.ErrnoException).code === "ENOENT" ? "not_found" : "unreadable" }
  }
  if (!info.isFile()) return { ok: false, reason: "not_regular_file" }
  if (info.size > NOTIFICATION_IMAGE_MAX_BYTES) return { ok: false, reason: "too_large" }

  let bytes: Buffer
  try {
    bytes = await readFile(input.filePath)
  } catch {
    return { ok: false, reason: "unreadable" }
  }
  const mimeType = detectNotificationImageMime(bytes)
  if (!mimeType) return { ok: false, reason: "unsupported_type" }
  return { ok: true, bytes, mimeType }
}
