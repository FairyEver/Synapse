import { createHash, randomUUID } from "node:crypto"
import { HttpException, Inject, Injectable, Logger } from "@nestjs/common"
import { Prisma, type SkillHubUpload } from "@prisma/client"
import { sha256 } from "@synapse/shared/archive-package-node"
import {
  SKILL_HUB_LIMITS as limits, skillHubPackageInfoSchema,
  type SkillHubUploadInput, type SkillHubUploadResult,
} from "@synapse/shared/skill-hub-contracts"
import type { IncomingHttpHeaders } from "node:http"
import type { Readable } from "node:stream"
import { hubError } from "./skill-hub-error"
import { SkillHubRepository } from "./skill-hub.repository"
import { SKILL_HUB_STORAGE, type SkillHubStoragePort } from "./skill-hub-storage"
import { SkillHubTeamService } from "./skill-hub-team.service"
import { runHubUploadCodec } from "./skill-hub-upload-codec"

const uploadTooLarge = () => hubError(413, "HUB_UPLOAD_TOO_LARGE", "Skill 文件超过上传大小限制。")
const uploadLength = () => hubError(400, "HUB_INVALID_UPLOAD_LENGTH", "Skill 文件长度无效或传输未完成。")
const uploadInterrupted = () => hubError(408, "HUB_UPLOAD_INTERRUPTED", "Skill 上传已中断，请重新尝试。")
const busy = () => hubError(503, "HUB_UPLOAD_BUSY", "当前正在处理 Skill 上传，请稍后重试。")

export function validateHubUploadHeaders(headers: IncomingHttpHeaders, limit: number): number | undefined {
  if (headers["content-type"]?.toLowerCase() !== "application/octet-stream"
    || (headers["content-encoding"] && headers["content-encoding"].toLowerCase() !== "identity")) {
    throw hubError(415, "HUB_UNSUPPORTED_UPLOAD", "请直接上传未编码的文件字节。")
  }
  const raw = headers["content-length"]
  if (raw === undefined) return undefined
  if (!/^\d+$/.test(raw) || Number(raw) === 0) throw uploadLength()
  if (Number(raw) > limit) throw uploadTooLarge()
  return Number(raw)
}

export function collectHubUpload(source: Readable, limit: number, declared: number | undefined, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (signal.aborted || source.destroyed || source.readableEnded) {
      reject(uploadInterrupted())
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    const release = () => {
      source.pause()
      source.off("data", data).off("end", end).off("error", abort).off("close", abort)
      signal.removeEventListener("abort", abort)
    }
    const fail = (error: unknown) => {
      release()
      reject(error)
    }
    const abort = () => fail(uploadInterrupted())
    const end = () => {
      release()
      if (!size || (declared !== undefined && declared !== size)) reject(uploadLength())
      else resolve(Buffer.concat(chunks, size))
    }
    const data = (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) fail(uploadTooLarge())
      else if (declared !== undefined && size > declared) fail(uploadLength())
      else chunks.push(chunk)
    }
    source.on("error", abort).on("close", abort).on("end", end).on("data", data)
    signal.addEventListener("abort", abort, { once: true })
  })
}

export function hubUploadByteLimit(input: SkillHubUploadInput): number {
  return input.purpose === "icon" ? limits.iconBytes : input.format === "markdown" ? limits.mainBytes : limits.uploadBytes
}

@Injectable()
export class SkillHubUploadService {
  private readonly logger = new Logger(SkillHubUploadService.name)
  private active = 0
  private readonly waiting = new Set<() => void>()

  constructor(
    private readonly repository: SkillHubRepository,
    private readonly teams: SkillHubTeamService,
    @Inject(SKILL_HUB_STORAGE) private readonly storage: SkillHubStoragePort,
  ) {}

  async stage(userId: string, input: SkillHubUploadInput, stream: Readable, signal: AbortSignal, declaredLength?: number): Promise<SkillHubUploadResult> {
    if (input.purpose === "package" && input.fileName
      && !input.fileName.toLowerCase().endsWith(input.format === "markdown" ? ".md" : ".zip")) {
      throw hubError(400, "HUB_PACKAGE_INVALID", "文件扩展名与上传格式不一致。")
    }
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    await this.teams.resolveUploadTeam(userId, input.teamId)
    const release = await this.acquire(deadline)
    try {
      const bytes = await collectHubUpload(stream, hubUploadByteLimit(input), declaredLength, deadline)
      const format = input.purpose === "package" ? input.format : undefined
      // Include the format so the same upload key cannot change interpretation of identical bytes.
      const inputSha256 = createHash("sha256").update(`${format ?? "icon"}:`).update(bytes).digest("hex")
      const key = { actorKey: userId, teamId: input.teamId, purpose: input.purpose, requestId: input.requestId }
      const where = { actorKey_teamId_purpose_requestId: key }
      const db = this.repository.prisma
      const existing = await db.skillHubUpload.findUnique({ where })
      if (existing) return this.replay(existing, inputSha256)
      const decoded = await runHubUploadCodec({ bytes, purpose: input.purpose, format }, deadline)
      await this.teams.resolveUploadTeam(userId, input.teamId)
      if (deadline.aborted) throw uploadInterrupted()
      const prepared = decoded.files.map((file) => ({
        ...file, bytes: Buffer.from(file.bytes), size: file.bytes.length, sha256: sha256(file.bytes),
      }))
      const id = randomUUID()
      const expiresAt = new Date(Date.now() + limits.uploadTtlMs)
      const staged = await db.skillHubUpload.create({
        data: {
          ...key, id, inputSha256, expiresAt,
          packageName: decoded.package?.name,
          packageDescription: decoded.package?.description,
          manifest: decoded.package?.manifest,
          contentFingerprint: decoded.package?.contentFingerprint,
          objects: { create: prepared.map(({ kind, size, sha256: digest }) => ({
            kind, size, sha256: digest, storageKey: `skill-hub/${id}/${kind}`,
          })) },
        },
      }).catch(async (error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const raced = await db.skillHubUpload.findUnique({ where })
          if (raced) return this.replay(raced, inputSha256)
        }
        throw error
      })
      if ("uploadId" in staged) return staged

      try {
        for (const file of prepared) {
          if (deadline.aborted) throw uploadInterrupted()
          await this.storage.put(`skill-hub/${id}/${file.kind}`, file.bytes, file.contentType)
        }
        if (deadline.aborted) throw uploadInterrupted()
        await db.$transaction(async (tx) => {
          await this.repository.lockActiveTeamMember(tx, input.teamId, userId)
          if (deadline.aborted) throw uploadInterrupted()
          await tx.skillHubObject.updateMany({ where: { uploadId: id, state: "staging" }, data: { state: "ready" } })
          await tx.skillHubUpload.update({ where: { id, state: "staging" }, data: { state: "ready" } })
        })
      } catch (error) {
        // Retire only an incomplete attempt: if the transaction committed but
        // the reply was lost, its ready row remains reusable. Keep object keys
        // for the full lease so physical GC cannot race a late remote write.
        await db.skillHubUpload.updateMany({ where: { id, state: "staging" }, data: { state: "cleanup" } })
          .catch(() => this.logger.warn("Skill Hub staging retirement could not be recorded"))
        this.logger.warn("Skill Hub staging did not finish")
        if (error instanceof HttpException) throw error
        throw hubError(503, "HUB_STORAGE_UNAVAILABLE", "Skill 文件暂未保存，请稍后重试。")
      }
      return this.result(staged)
    } catch (error) {
      if (deadline.aborted) throw uploadInterrupted()
      throw error
    } finally {
      release()
    }
  }

  private replay(upload: SkillHubUpload, digest: string): SkillHubUploadResult {
    if (upload.inputSha256 !== digest) throw hubError(409, "HUB_REQUEST_CONFLICT", "此请求标识已用于不同的文件。")
    const now = Date.now()
    const staleStaging = upload.state === "staging" && upload.createdAt.getTime() + 5 * 60_000 <= now
    if (upload.state === "cleanup" || staleStaging || (upload.state !== "bound" && upload.expiresAt.getTime() <= now)) {
      throw hubError(409, "HUB_UPLOAD_EXPIRED", "此上传已过期，请重新上传文件。")
    }
    if (upload.state === "staging") throw busy()
    return this.result(upload)
  }

  private result(upload: SkillHubUpload): SkillHubUploadResult {
    return {
      uploadId: upload.id,
      expiresAt: upload.expiresAt.toISOString(),
      ...(upload.purpose === "package" ? { packageInfo: skillHubPackageInfoSchema.parse({
        name: upload.packageName, description: upload.packageDescription,
      }) } : {}),
    }
  }

  private acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(uploadInterrupted())
    if (this.active < 2) {
      this.active++
      return Promise.resolve(this.release)
    }
    if (this.waiting.size >= 16) return Promise.reject(busy())
    return new Promise((resolve, reject) => {
      const ready = () => {
        signal.removeEventListener("abort", abort)
        resolve(this.release)
      }
      const abort = () => {
        this.waiting.delete(ready)
        reject(uploadInterrupted())
      }
      this.waiting.add(ready)
      signal.addEventListener("abort", abort, { once: true })
    })
  }

  private readonly release = () => {
    const next = this.waiting.values().next().value
    if (next) {
      this.waiting.delete(next)
      next()
    } else this.active--
  }
}
