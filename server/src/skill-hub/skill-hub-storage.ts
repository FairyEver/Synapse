import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, mkdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { Readable } from "node:stream"
import COS from "cos-nodejs-sdk-v5"
import { loadEnv } from "../config/env"
import { hubError } from "./skill-hub-error"

export const SKILL_HUB_STORAGE = Symbol("SKILL_HUB_STORAGE")
export interface SkillHubStoragePort {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>
  open(key: string): Promise<{ stream: Readable; size: number }>
  head(key: string): Promise<{ size: number; sha256: string } | null>
  remove(key: string): Promise<void>
}

export function assertSkillHubObjectKey(key: string): void {
  if (!/^skill-hub\/[A-Za-z0-9_-]{1,128}\/(archive|main|icon)$/.test(key)) throw new Error("Invalid Skill Hub object key")
}

function missing(error: unknown, name: "code" | "statusCode", value: string | number): boolean {
  return typeof error === "object" && error !== null && (error as Record<string, unknown>)[name] === value
}

export class LocalSkillHubStorage implements SkillHubStoragePort {
  constructor(private readonly root: string) {}

  private path(key: string) {
    assertSkillHubObjectKey(key)
    return resolve(this.root, key)
  }

  async put(key: string, bytes: Buffer, _contentType: string) {
    const target = this.path(key)
    await mkdir(join(target, ".."), { mode: 0o700, recursive: true })
    await writeFile(target, bytes, { mode: 0o600, flag: "wx" })
  }

  async open(key: string) {
    const target = this.path(key)
    const info = await lstat(target)
    if (!info.isFile()) throw new Error("Invalid local Skill Hub object")
    return { stream: createReadStream(target), size: info.size }
  }

  async head(key: string) {
    try {
      const { stream, size } = await this.open(key)
      const hash = createHash("sha256")
      for await (const chunk of stream) hash.update(chunk)
      return { size, sha256: hash.digest("hex") }
    } catch (error) {
      if (missing(error, "code", "ENOENT")) return null
      throw error
    }
  }

  async remove(key: string) {
    await rm(this.path(key), { force: true })
  }
}

class CosSkillHubStorage implements SkillHubStoragePort {
  constructor(private readonly cos: COS, private readonly bucket: string, private readonly region: string) {}

  private args(key: string) {
    assertSkillHubObjectKey(key)
    return { Bucket: this.bucket, Region: this.region, Key: key }
  }

  async put(key: string, bytes: Buffer, contentType: string) {
    const checksum = createHash("sha256").update(bytes).digest("hex")
    await this.cos.putObject({
      ...this.args(key), Body: bytes, ContentType: contentType, ContentLength: bytes.length,
      ACL: "private", "x-cos-meta-sha256": checksum, Headers: { "x-cos-forbid-overwrite": "true" },
    })
  }

  async head(key: string) {
    try {
      const { headers } = await this.cos.headObject(this.args(key))
      const size = Number(headers?.["content-length"])
      const sha256 = headers?.["x-cos-meta-sha256"]
      if (!Number.isSafeInteger(size) || size < 0 || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Missing Skill Hub object metadata")
      return { size, sha256 }
    } catch (error) {
      if (missing(error, "statusCode", 404)) return null
      throw error
    }
  }

  async open(key: string) {
    const info = await this.head(key)
    if (!info) throw hubError(503, "HUB_STORAGE_UNAVAILABLE", "Skill 文件暂不可用。")
    const stream = this.cos.getObjectStream(this.args(key)) as unknown as Readable
    return { stream, size: info.size }
  }

  async remove(key: string) {
    try {
      await this.cos.deleteObject(this.args(key))
    } catch (error) {
      if (!missing(error, "statusCode", 404)) throw error
    }
  }
}

export function createSkillHubStorage(): SkillHubStoragePort {
  const env = loadEnv(process.env)
  if (env.skillHubCosBucket && env.skillHubCosRegion && env.skillHubCosSecretId && env.skillHubCosSecretKey) {
    return new CosSkillHubStorage(new COS({
      SecretId: env.skillHubCosSecretId, SecretKey: env.skillHubCosSecretKey, Timeout: 15_000, UploadCheckContentMd5: true,
    }), env.skillHubCosBucket, env.skillHubCosRegion)
  }
  return new LocalSkillHubStorage(env.skillHubLocalRoot ?? resolve("data", "skill-hub"))
}
