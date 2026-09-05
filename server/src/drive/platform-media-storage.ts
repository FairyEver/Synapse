import { Injectable } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import COS from "cos-nodejs-sdk-v5"
import { isPlatformMediaCosConfigured, loadEnv } from "../config/env"
import { driveUploadUrlTtlSeconds } from "./drive.constants"
import type { DriveStorageObjectInfo, DriveUploadInstruction } from "./drive-storage"

export interface PlatformMediaStoragePort {
  createUploadInstruction(input: { readonly key: string; readonly contentType: string; readonly expectedSize: bigint }): Promise<DriveUploadInstruction>
  headObject(key: string): Promise<DriveStorageObjectInfo | null>
  getObjectStream(key: string): Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint }>
  deleteObject(key: string): Promise<void>
}

type LocalUploadToken = {
  readonly key: string
  readonly expectedSize: bigint
  readonly expiresAt: Date
}

@Injectable()
export class PlatformMediaStorage implements PlatformMediaStoragePort {
  private readonly localUploads = new Map<string, LocalUploadToken>()
  private cosClient: { readonly cos: COS; readonly bucket: string; readonly region: string } | null = null

  async createUploadInstruction(input: { readonly key: string; readonly contentType: string; readonly expectedSize: bigint }): Promise<DriveUploadInstruction> {
    const env = loadEnv(process.env)
    const expiresAt = new Date(Date.now() + driveUploadUrlTtlSeconds * 1000)
    if (isPlatformMediaCosConfigured(env)) {
      return {
        method: "PUT",
        url: await this.getCosSignedUploadUrl(input.key),
        expiresAt,
        headers: { "Content-Type": input.contentType },
      }
    }
    this.cleanupLocalTokens()
    const token = randomUUID()
    this.localUploads.set(token, { key: input.key, expectedSize: input.expectedSize, expiresAt })
    const publicAppUrl = env.appPublicUrl ?? `http://localhost:${env.port}`
    return {
      method: "PUT",
      url: `${publicAppUrl.replace(/\/+$/u, "")}/api/platform-media/local-upload/${encodeURIComponent(token)}`,
      expiresAt,
      headers: { "Content-Type": input.contentType },
    }
  }

  async acceptLocalUpload(token: string, stream: NodeJS.ReadableStream): Promise<void> {
    this.cleanupLocalTokens()
    const entry = this.localUploads.get(token)
    if (!entry || entry.expiresAt.getTime() <= Date.now()) throw new Error("Platform media upload token expired.")
    const target = this.localPath(entry.key)
    await mkdir(path.dirname(target), { recursive: true })
    try {
      await pipeline(stream, createSizeLimitStream(entry.expectedSize), createWriteStream(target))
    } catch (error) {
      await rm(target, { force: true })
      throw error
    } finally {
      this.localUploads.delete(token)
    }
  }

  async headObject(key: string): Promise<DriveStorageObjectInfo | null> {
    const env = loadEnv(process.env)
    if (!isPlatformMediaCosConfigured(env)) {
      try {
        const info = await stat(this.localPath(key))
        return { key, size: BigInt(info.size) }
      } catch (error) {
        if (isMissingFile(error)) return null
        throw error
      }
    }
    try {
      const client = this.getCosClient()
      const result = await new Promise<{ readonly headers?: Record<string, string> }>((resolve, reject) => {
        client.cos.headObject({ Bucket: client.bucket, Region: client.region, Key: key }, (error, data) => {
          if (error) reject(error)
          else resolve(data)
        })
      })
      return {
        key,
        size: BigInt(result.headers?.["content-length"] ?? "0"),
        etag: result.headers?.etag,
      }
    } catch (error) {
      if (isCosNotFound(error)) return null
      throw error
    }
  }

  async getObjectStream(key: string): Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint }> {
    const env = loadEnv(process.env)
    if (!isPlatformMediaCosConfigured(env)) {
      const info = await stat(this.localPath(key))
      return { stream: createReadStream(this.localPath(key)), size: BigInt(info.size) }
    }
    const client = this.getCosClient()
    return {
      stream: client.cos.getObjectStream({ Bucket: client.bucket, Region: client.region, Key: key }) as unknown as NodeJS.ReadableStream,
    }
  }

  async deleteObject(key: string): Promise<void> {
    const env = loadEnv(process.env)
    if (!isPlatformMediaCosConfigured(env)) {
      await rm(this.localPath(key), { force: true })
      return
    }
    const client = this.getCosClient()
    await new Promise<void>((resolve, reject) => {
      client.cos.deleteObject({ Bucket: client.bucket, Region: client.region, Key: key }, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private localPath(key: string): string {
    const env = loadEnv(process.env)
    const root = path.join(env.driveLocalRoot ?? path.join(os.tmpdir(), "synapse-drive-storage"), "platform-media")
    return path.join(root, ...key.split("/"))
  }

  private cleanupLocalTokens(): void {
    const now = Date.now()
    for (const [token, entry] of this.localUploads) {
      if (entry.expiresAt.getTime() <= now) this.localUploads.delete(token)
    }
  }

  private getCosClient(): { readonly cos: COS; readonly bucket: string; readonly region: string } {
    if (this.cosClient) return this.cosClient
    const env = loadEnv(process.env)
    this.cosClient = {
      cos: new COS({
        SecretId: requireConfig(env.platformMediaCosSecretId, "PLATFORM_MEDIA_COS_SECRET_ID"),
        SecretKey: requireConfig(env.platformMediaCosSecretKey, "PLATFORM_MEDIA_COS_SECRET_KEY"),
      }),
      bucket: requireConfig(env.platformMediaCosBucket, "PLATFORM_MEDIA_COS_BUCKET"),
      region: requireConfig(env.platformMediaCosRegion, "PLATFORM_MEDIA_COS_REGION"),
    }
    return this.cosClient
  }

  private getCosSignedUploadUrl(key: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = this.getCosClient()
      client.cos.getObjectUrl({
        Bucket: client.bucket,
        Region: client.region,
        Key: key,
        Sign: true,
        Method: "put",
        Expires: driveUploadUrlTtlSeconds,
      }, (error, data) => {
        if (error) reject(error)
        else resolve(data.Url)
      })
    })
  }
}

function createSizeLimitStream(expectedSize: bigint): Transform {
  let size = 0n
  return new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      size += BigInt(Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk))
      if (size > expectedSize) {
        callback(new Error("Platform media upload exceeds expected size."))
        return
      }
      callback(null, chunk)
    },
  })
}

function requireConfig(value: string | undefined, key: string): string {
  if (!value) throw new Error(`${key} is required for platform media storage.`)
  return value
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { readonly code?: unknown }).code === "ENOENT"
}

function isCosNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "statusCode" in error
    && (error as { readonly statusCode?: unknown }).statusCode === 404
}
