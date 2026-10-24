import { randomUUID } from "node:crypto"
import { link, lstat, open, realpath, rename, rm } from "node:fs/promises"
import path from "node:path"
import { AGENT_SHARE_COPY_MAX_PIXELS, AGENT_SHARE_MAX_HEIGHT, AGENT_SHARE_MAX_PIXELS, AGENT_SHARE_MAX_PNG_BYTES, type AgentShareImageRequest, type AgentShareImageResult } from "../../src/types/agent-share"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import { hasSameFileSnapshot, isFileNotFoundError } from "./fs-utils"

export class AgentShareImageService {
  constructor(private readonly deps: {
    permissionGuard: Pick<PermissionGuard, "check">
    auditSink: Pick<AuditSink, "record">
    chooseSavePath: (name: string) => Promise<string | null>
    copyPng: (bytes: Buffer) => Promise<void>
    logger?: { warn(message: string, metadata: Record<string, unknown>): void }
  }) {}

  async readRemoteImage(input: string, signal: AbortSignal): Promise<{ dataUrl: string }> {
    signal.throwIfAborted()
    const actor = { kind: "user" as const, id: "renderer" }, action = "network.connect", metadata = { source: "agent.share.image" }
    const validate = (url: URL) => {
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("图片地址不受支持。")
    }
    validate(new URL(input))
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(12_000)])
    const { createGuardedFetchResource } = await import("./source-acquisition/guarded-fetch-url.js")
    const fetchImage = createGuardedFetchResource({ timeoutMs: 12_000, accept: "image/*", redactUrlDetails: true, beforeRequest: async (url) => {
      deadline.throwIfAborted(); validate(url)
      const permission = await this.deps.permissionGuard.check({ action, actor, resource: url.origin, context: metadata })
      this.deps.auditSink.record({ action, actor, resource: url.origin, outcome: permission.allowed ? "allowed" : "denied", metadata })
      if (!permission.allowed) throw new Error("没有权限读取此图片。")
    } })
    const response = await fetchImage(input, { signal: deadline })
    try {
      const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase().replace(/^image\/jpg$/, "image/jpeg")
      if (response.status < 200 || response.status >= 300 || !mime || !/^image\/(?:png|apng|jpeg|gif|webp|svg\+xml|avif|bmp|x-icon|vnd\.microsoft\.icon)$/.test(mime)) throw new Error("远端地址未返回可用图片。")
      const bytes = await response.bytes(AGENT_SHARE_MAX_PNG_BYTES)
      deadline.throwIfAborted()
      if (!bytes.length) throw new Error("远端图片内容为空。")
      return { dataUrl: `data:${mime};base64,${bytes.toString("base64")}` }
    } finally { response.discardBody?.() }
  }

  async exportImage(request: AgentShareImageRequest): Promise<AgentShareImageResult> {
    const { bytes, width, height } = validateSharePng(request.pngBase64)
    if (request.action === "copy" && (width * height > AGENT_SHARE_COPY_MAX_PIXELS || height > 32_767)) {
      throw new Error("图片过长，无法复制，请保存图片后分享。")
    }
    const chosen = request.action === "save" ? await this.deps.chooseSavePath(shareImageFileName(request.fileName)) : null
    if (request.action === "save" && !chosen) return { success: false }
    const action = request.action === "save" ? "fs.write.outside-userdata" : "clipboard.write"
    let resource = chosen ?? "agent.share.image"
    const actor = { kind: "user" as const, id: "renderer" }
    const metadata = { source: "agent.share.image", width, height, byteSize: bytes.length }
    let denied = false
    try {
      if (chosen) {
        if (!path.isAbsolute(chosen) || !chosen.toLowerCase().endsWith(".png")) throw new Error("请选择 PNG 文件路径。")
        resource = path.join(await realpath(path.dirname(chosen)), path.basename(chosen))
      }
      const permission = await this.deps.permissionGuard.check({ action, actor, resource, context: metadata })
      if (!permission.allowed) {
        denied = true
        this.deps.auditSink.record({ action, actor, resource, outcome: "denied", metadata })
        throw new Error("没有权限导出图片。")
      }
      if (request.action === "copy") await this.deps.copyPng(bytes)
      else await this.writeAtomic(resource, bytes)
      this.deps.auditSink.record({ action, actor, resource, outcome: "allowed", metadata })
      return { success: true, ...(chosen ? { filePath: resource } : {}) }
    } catch (cause) {
      if (!denied) this.deps.auditSink.record({ action, actor, resource, outcome: "failed", metadata: { ...metadata, errorName: cause instanceof Error ? cause.name : typeof cause } })
      throw cause
    }
  }

  private async writeAtomic(output: string, bytes: Buffer): Promise<void> {
    const initial = await targetSnapshot(output)
    const temporary = path.join(path.dirname(output), `.synapse-share-${randomUUID()}.tmp`)
    let created = false
    try {
      const handle = await open(temporary, "wx", 0o600)
      created = true
      try { await handle.writeFile(bytes); await handle.sync() }
      finally { await handle.close() }
      const current = await targetSnapshot(output)
      if (initial ? !current || !hasSameFileSnapshot(initial, current) : current !== null) throw new Error("目标文件已变化，请重新保存。")
      if (initial) await rename(temporary, output)
      else await link(temporary, output) // exclusive creation, never overwrite a newly appeared target
    } finally {
      if (created) {
        try { await rm(temporary, { force: true }) }
        catch (cause) { this.deps.logger?.warn("Agent share temporary cleanup failed.", { errorName: cause instanceof Error ? cause.name : typeof cause }) }
      }
    }
  }
}

async function targetSnapshot(filePath: string) {
  try {
    const snapshot = await lstat(filePath, { bigint: true })
    if (!snapshot.isFile() || snapshot.isSymbolicLink()) throw new Error("目标不是普通文件，请选择其他位置。")
    return snapshot
  } catch (cause) {
    if (isFileNotFoundError(cause)) return null
    throw cause
  }
}

export function shareImageFileName(value: string): string {
  const name = value.replace(/[<>:"/\\|?*]/g, "_").replace(/\p{Cc}/gu, "_").replace(/\.png$/i, "").trim().slice(0, 80)
  return `${name || "Synapse 对话"}.png`
}

export function validateSharePng(base64: string): { bytes: Buffer; width: number; height: number } {
  if (!base64 || base64.length % 4 !== 0 || base64.length > Math.ceil(AGENT_SHARE_MAX_PNG_BYTES / 3) * 4 || /[^A-Za-z0-9+/=]/.test(base64)) throw new Error("PNG 图片无效或过大。")
  const bytes = Buffer.from(base64, "base64")
  if (bytes.toString("base64") !== base64) throw new Error("PNG 图片无效。")
  if (bytes.length < 45 || bytes.length > AGENT_SHARE_MAX_PNG_BYTES || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.subarray(-12).toString("hex") !== "0000000049454e44ae426082") {
    throw new Error("PNG 图片无效。")
  }
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  if (!width || !height || width > 2880 || height > AGENT_SHARE_MAX_HEIGHT || width * height > AGENT_SHARE_MAX_PIXELS) throw new Error("图片过长或过大，请缩小分享范围。")
  return { bytes, width, height }
}
