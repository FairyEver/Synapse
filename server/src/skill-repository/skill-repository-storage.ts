import { Inject, Injectable, Optional } from "@nestjs/common"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import COS from "cos-nodejs-sdk-v5"
import { isSkillRepositoryCosConfigured, loadEnv } from "../config/env"

export interface SkillRepositoryStorageObject {
  readonly key: string
  readonly size: bigint
  readonly contentType?: string | null
  readonly etag?: string
}

export interface SkillRepositoryStoragePort {
  putObject(input: {
    readonly key: string
    readonly body: Buffer | NodeJS.ReadableStream
    readonly contentType?: string | null
  }): Promise<void>
  getObjectStream(input: { readonly key: string }): Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint; readonly contentType?: string | null }>
  headObject(key: string): Promise<SkillRepositoryStorageObject | null>
  deleteObject(key: string): Promise<void>
}

export const LOCAL_SKILL_REPOSITORY_STORAGE_OPTIONS = Symbol("LOCAL_SKILL_REPOSITORY_STORAGE_OPTIONS")

export type LocalSkillRepositoryStorageOptions = {
  readonly root?: string
}

@Injectable()
export class LocalSkillRepositoryStorage implements SkillRepositoryStoragePort {
  private readonly contentTypes = new Map<string, string | null>()
  private readonly root: string

  constructor(@Optional() @Inject(LOCAL_SKILL_REPOSITORY_STORAGE_OPTIONS) options?: LocalSkillRepositoryStorageOptions) {
    const env = options?.root ? undefined : loadEnv(process.env)
    this.root = options?.root ?? env?.skillRepositoryLocalRoot ?? path.join(os.tmpdir(), "synapse-skill-repository-storage")
  }

  async putObject(input: {
    readonly key: string
    readonly body: Buffer | NodeJS.ReadableStream
    readonly contentType?: string | null
  }): Promise<void> {
    const objectPath = this.pathForKey(input.key)
    await mkdir(path.dirname(objectPath), { recursive: true })
    if (Buffer.isBuffer(input.body)) {
      await writeFile(objectPath, input.body)
    } else {
      await pipeline(input.body, createWriteStream(objectPath))
    }
    this.contentTypes.set(input.key, input.contentType ?? null)
  }

  async getObjectStream(input: { readonly key: string }): Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint; readonly contentType?: string | null }> {
    const objectPath = this.pathForKey(input.key)
    const info = await stat(objectPath)
    return {
      stream: createReadStream(objectPath),
      size: BigInt(info.size),
      contentType: this.contentTypes.get(input.key) ?? null,
    }
  }

  async headObject(key: string): Promise<SkillRepositoryStorageObject | null> {
    try {
      const info = await stat(this.pathForKey(key))
      return { key, size: BigInt(info.size), contentType: this.contentTypes.get(key) ?? null }
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as { readonly code?: string }).code === "ENOENT") return null
      throw error
    }
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.pathForKey(key), { force: true })
    this.contentTypes.delete(key)
  }

  private pathForKey(key: string): string {
    const objectPath = path.resolve(this.root, key)
    const rootPath = path.resolve(this.root)
    if (objectPath !== rootPath && !objectPath.startsWith(`${rootPath}${path.sep}`)) {
      throw new Error("Invalid skill repository storage key.")
    }
    return objectPath
  }
}

@Injectable()
export class CosSkillRepositoryStorage implements SkillRepositoryStoragePort {
  private client: {
    readonly cos: COS
    readonly bucket: string
    readonly region: string
  } | null = null

  async putObject(input: {
    readonly key: string
    readonly body: Buffer | NodeJS.ReadableStream
    readonly contentType?: string | null
  }): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const client = this.getClient()
      client.cos.putObject({
        Bucket: client.bucket,
        Region: client.region,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType ?? undefined,
      }, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  async getObjectStream(input: { readonly key: string }): Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint; readonly contentType?: string | null }> {
    const client = this.getClient()
    const info = await this.headObjectRaw(input.key)
    const stream = client.cos.getObjectStream({
      Bucket: client.bucket,
      Region: client.region,
      Key: input.key,
    }) as unknown as NodeJS.ReadableStream
    return {
      stream,
      size: parseContentLength(info.headers?.["content-length"]),
      contentType: info.headers?.["content-type"] ?? null,
    }
  }

  async headObject(key: string): Promise<SkillRepositoryStorageObject | null> {
    try {
      const result = await this.headObjectRaw(key)
      return {
        key,
        size: parseContentLength(result.headers?.["content-length"]) ?? 0n,
        contentType: result.headers?.["content-type"] ?? null,
        etag: typeof result.headers?.etag === "string" ? result.headers.etag : undefined,
      }
    } catch (error) {
      if (isCosNotFound(error)) return null
      throw error
    }
  }

  async deleteObject(key: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const client = this.getClient()
      client.cos.deleteObject({ Bucket: client.bucket, Region: client.region, Key: key }, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private headObjectRaw(key: string): Promise<{ readonly headers?: Record<string, string> }> {
    return new Promise((resolve, reject) => {
      const client = this.getClient()
      client.cos.headObject({ Bucket: client.bucket, Region: client.region, Key: key }, (error, data) => {
        if (error) reject(error)
        else resolve(data)
      })
    })
  }

  private requireConfig(value: string | undefined, key: string): string {
    if (!value) throw new Error(`${key} is required for Synapse Skill Repository storage.`)
    return value
  }

  private getClient(): { readonly cos: COS; readonly bucket: string; readonly region: string } {
    if (this.client) return this.client
    const env = loadEnv(process.env)
    this.client = {
      cos: new COS({
        SecretId: this.requireConfig(env.skillRepositoryCosSecretId, "SKILL_REPOSITORY_COS_SECRET_ID"),
        SecretKey: this.requireConfig(env.skillRepositoryCosSecretKey, "SKILL_REPOSITORY_COS_SECRET_KEY"),
      }),
      bucket: this.requireConfig(env.skillRepositoryCosBucket, "SKILL_REPOSITORY_COS_BUCKET"),
      region: this.requireConfig(env.skillRepositoryCosRegion, "SKILL_REPOSITORY_COS_REGION"),
    }
    return this.client
  }
}

export function shouldUseCosSkillRepositoryStorage(source: NodeJS.ProcessEnv = process.env): boolean {
  return isSkillRepositoryCosConfigured(loadEnv(source))
}

function isCosNotFound(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && ("statusCode" in error)
    && (error as { readonly statusCode?: unknown }).statusCode === 404
}

function parseContentLength(value: string | undefined): bigint | undefined {
  return value && /^\d+$/u.test(value) ? BigInt(value) : undefined
}
