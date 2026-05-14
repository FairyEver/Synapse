import { Buffer } from "node:buffer"
import { tmpdir } from "node:os"
import path from "node:path"
import { lstat, readFile, realpath, stat } from "node:fs/promises"

import type { PermissionGuard } from "../../runtime/security"
import { normalizeContentAttachmentSegment } from "../../../src/lib/content-attachments"
import type {
  SideChannelAttachmentInput,
  SideChannelPreparedAttachment,
} from "./types"

const MAX_SINGLE_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024

const IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
])

const FILE_MIME = new Set([
  "application/json",
  "application/pdf",
  "text/markdown",
  "text/plain",
])

export interface PrepareAttachmentOptions {
  readonly images?: readonly SideChannelAttachmentInput[]
  readonly files?: readonly SideChannelAttachmentInput[]
  readonly workspacePath?: string
  readonly permissionGuard?: PermissionGuard
}

export async function prepareSideChannelAttachments(
  options: PrepareAttachmentOptions,
): Promise<SideChannelPreparedAttachment[]> {
  const attachments: SideChannelPreparedAttachment[] = []
  let total = 0

  for (const image of options.images ?? []) {
    const attachment = await prepareAttachment("image", image, options)
    total += attachment.size
    assertTotalSize(total)
    attachments.push(attachment)
  }
  for (const file of options.files ?? []) {
    const attachment = await prepareAttachment("file", file, options)
    total += attachment.size
    assertTotalSize(total)
    attachments.push(attachment)
  }

  return attachments
}

export function sanitizeAttachmentFileName(value: string | undefined): string {
  const cleaned = normalizeContentAttachmentSegment(value?.trim() || "attachment").replace(/^\.+/u, "")
  return cleaned || "attachment"
}

async function prepareAttachment(
  kind: "image" | "file",
  input: SideChannelAttachmentInput,
  options: PrepareAttachmentOptions,
): Promise<SideChannelPreparedAttachment> {
  const source = await readAttachmentInput(input, options)
  const mimeType = normalizeMimeType(
    input.mimeType ?? input.mime_type ?? detectMimeType(source.fileName, source.bytes),
  )
  assertMime(kind, mimeType)
  assertSingleSize(source.bytes.byteLength)
  return {
    kind,
    fileName: sanitizeAttachmentFileName(input.fileName ?? input.file_name ?? source.fileName),
    mimeType,
    bytes: source.bytes,
    size: source.bytes.byteLength,
  }
}

async function readAttachmentInput(
  input: SideChannelAttachmentInput,
  options: PrepareAttachmentOptions,
): Promise<{ readonly bytes: Buffer; readonly fileName: string }> {
  const inline = input.dataBase64 ?? input.data
  if (inline !== undefined) {
    return {
      bytes: decodeInlineAttachment(inline),
      fileName: sanitizeAttachmentFileName(input.fileName ?? input.file_name),
    }
  }
  if (!input.path) {
    throw new AttachmentPolicyError("attachment_source_required", "attachment path or data is required")
  }
  await assertPathAllowed(input.path, options)
  const bytes = await readAttachmentFile(input.path)
  return {
    bytes,
    fileName: sanitizeAttachmentFileName(input.fileName ?? input.file_name ?? input.path),
  }
}

async function assertPathAllowed(
  rawPath: string,
  options: PrepareAttachmentOptions,
): Promise<void> {
  const target = path.resolve(rawPath)
  const linkInfo = await statPath(target, lstat)
  if (linkInfo.isSymbolicLink()) {
    throw new AttachmentPolicyError("path_symlink_rejected", "attachment path must not be a symlink")
  }
  const info = await statPath(target, stat)
  if (!info.isFile()) {
    throw new AttachmentPolicyError("path_not_file", "attachment path must be a file")
  }
  const allowedRoots = [options.workspacePath, path.join(tmpdir(), "synapse-side-channel")].filter((value): value is string =>
    typeof value === "string" && value.trim().length > 0)
  const allowed = await isInsideAnyRoot(target, allowedRoots)
  if (allowed) return

  const decision = await options.permissionGuard?.check({
    action: "fs.read.outside-userdata",
    actor: { kind: "agent", id: "side-channel" },
    resource: target,
    context: { source: "side-channel" },
  })
  if (decision?.allowed) return
  throw new AttachmentPolicyError(
    "path_escape_rejected",
    decision?.reason ?? "attachment path is outside allowed roots",
  )
}

async function statPath(
  target: string,
  readStat: typeof lstat,
): Promise<Awaited<ReturnType<typeof lstat>>> {
  try {
    return await readStat(target)
  } catch (error) {
    throw attachmentFileSystemError(error)
  }
}

async function readAttachmentFile(target: string): Promise<Buffer> {
  try {
    return await readFile(target)
  } catch (error) {
    throw attachmentFileSystemError(error)
  }
}

function attachmentFileSystemError(error: unknown): AttachmentPolicyError {
  const code = fileSystemErrorCode(error)
  if (code === "ENOENT" || code === "ENOTDIR") {
    return new AttachmentPolicyError("attachment_not_found", "attachment path was not found")
  }
  if (code === "EACCES" || code === "EPERM") {
    return new AttachmentPolicyError("attachment_not_readable", "attachment path is not readable")
  }
  return new AttachmentPolicyError("attachment_read_failed", "attachment path could not be read")
}

function fileSystemErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  const code = (error as { readonly code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

async function isInsideAnyRoot(target: string, roots: readonly string[]): Promise<boolean> {
  const realTarget = await realpath(target)
  for (const root of roots) {
    const realRoot = await realpath(root).catch(() => "")
    if (!realRoot) continue
    const relative = path.relative(realRoot, realTarget)
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      return true
    }
  }
  return false
}

function assertSingleSize(size: number): void {
  if (size > MAX_SINGLE_ATTACHMENT_BYTES) {
    throw new AttachmentPolicyError(
      "attachment_too_large",
      `attachment exceeds ${String(MAX_SINGLE_ATTACHMENT_BYTES)} bytes`,
    )
  }
}

function assertTotalSize(size: number): void {
  if (size > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new AttachmentPolicyError(
      "attachments_too_large",
      `attachments exceed ${String(MAX_TOTAL_ATTACHMENT_BYTES)} bytes`,
    )
  }
}

function assertMime(kind: "image" | "file", mimeType: string): void {
  if (kind === "image" && !IMAGE_MIME.has(mimeType)) {
    throw new AttachmentPolicyError("unsupported_image_mime", `unsupported image MIME ${mimeType}`)
  }
  if (kind === "file" && !FILE_MIME.has(mimeType)) {
    throw new AttachmentPolicyError("unsupported_file_mime", `unsupported file MIME ${mimeType}`)
  }
}

function normalizeMimeType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() || "application/octet-stream"
}

function decodeInlineAttachment(value: string): Buffer {
  const normalized = value.replace(/\s+/g, "")
  if (!isValidBase64(normalized)) {
    throw new AttachmentPolicyError("invalid_attachment_data", "attachment data must be valid base64")
  }
  return Buffer.from(normalized, "base64")
}

function isValidBase64(value: string): boolean {
  if (!value) return false
  if (/[^A-Za-z0-9+/=]/.test(value)) return false
  const padding = value.match(/=+$/)?.[0].length ?? 0
  if (padding > 2) return false
  if (value.slice(0, value.length - padding).includes("=")) return false
  if (value.length % 4 === 1) return false
  return padding === 0 || value.length % 4 === 0
}

function detectMimeType(fileName: string, bytes: Buffer): string {
  const ext = path.extname(fileName).toLowerCase()
  switch (ext) {
    case ".md":
    case ".markdown":
      return "text/markdown"
    case ".json":
      return "application/json"
    case ".pdf":
      return "application/pdf"
    case ".txt":
      return "text/plain"
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".gif":
      return "image/gif"
    case ".webp":
      return "image/webp"
    default:
      break
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png"
  }
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return "image/jpeg"
  }
  if (bytes.subarray(0, 4).toString("ascii") === "%PDF") {
    return "application/pdf"
  }
  return "application/octet-stream"
}

export class AttachmentPolicyError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
