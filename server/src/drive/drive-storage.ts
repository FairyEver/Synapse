import { Inject, Injectable, Optional } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import COS from "cos-nodejs-sdk-v5"
import { isDriveCosConfigured, loadEnv } from "../config/env"
import { driveDownloadUrlTtlSeconds, driveUploadUrlTtlSeconds } from "./drive.constants"

export interface DriveStorageObjectInfo {
  readonly key: string
  readonly size: bigint
  readonly etag?: string
}

export interface DriveUploadInstruction {
  readonly method: "PUT"
  readonly url: string
  readonly expiresAt: Date
  readonly headers: Record<string, string>
}

export interface DriveStoragePort {
  createUploadInstruction(input: { readonly key: string; readonly contentType?: string }): Promise<DriveUploadInstruction>
  createDownloadUrl(input: { readonly key: string; readonly filename: string }): Promise<{ readonly url: string; readonly expiresAt: Date }>
  headObject(key: string): Promise<DriveStorageObjectInfo | null>
  deleteObject(key: string): Promise<void>
}

type LocalStorageToken = {
  readonly key: string
  readonly filename?: string
  readonly expiresAt: Date
}

export const LOCAL_DRIVE_STORAGE_OPTIONS = Symbol("LOCAL_DRIVE_STORAGE_OPTIONS")

export type LocalDriveStorageOptions = {
  readonly publicAppUrl?: string
  readonly root?: string
}

@Injectable()
export class LocalDriveStorage implements DriveStoragePort {
  private readonly uploadTokens = new Map<string, LocalStorageToken>()
  private readonly downloadTokens = new Map<string, LocalStorageToken>()
  private readonly publicAppUrl: string
  private readonly root: string

  constructor(@Optional() @Inject(LOCAL_DRIVE_STORAGE_OPTIONS) options?: LocalDriveStorageOptions) {
    const env = options?.publicAppUrl ? undefined : loadEnv(process.env)
    this.publicAppUrl = options?.publicAppUrl ?? env?.appPublicUrl ?? `http://localhost:${env?.port ?? 3000}`
    this.root = options?.root ?? process.env.SYNAPSE_DRIVE_LOCAL_ROOT ?? path.join(os.tmpdir(), "synapse-drive-storage")
  }

  async createUploadInstruction(input: { readonly key: string; readonly contentType?: string }): Promise<DriveUploadInstruction> {
    const expiresAt = new Date(Date.now() + driveUploadUrlTtlSeconds * 1000)
    const token = randomUUID()
    this.uploadTokens.set(token, { key: input.key, expiresAt })
    return {
      method: "PUT",
      url: `${this.publicAppUrl.replace(/\/+$/u, "")}/api/drive/local-upload/${encodeURIComponent(token)}`,
      expiresAt,
      headers: input.contentType ? { "Content-Type": input.contentType } : {},
    }
  }

  async createDownloadUrl(input: { readonly key: string; readonly filename: string }): Promise<{ readonly url: string; readonly expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + driveDownloadUrlTtlSeconds * 1000)
    const token = randomUUID()
    this.downloadTokens.set(token, { key: input.key, filename: input.filename, expiresAt })
    return {
      url: `${this.publicAppUrl.replace(/\/+$/u, "")}/api/drive/local-download/${encodeURIComponent(token)}`,
      expiresAt,
    }
  }

  async headObject(key: string): Promise<DriveStorageObjectInfo | null> {
    try {
      const objectPath = this.pathForKey(key)
      const info = await stat(objectPath)
      return { key, size: BigInt(info.size) }
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as { readonly code?: string }).code === "ENOENT") return null
      throw error
    }
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.pathForKey(key), { force: true })
  }

  async acceptUpload(token: string, stream: NodeJS.ReadableStream): Promise<void> {
    const entry = this.consumeToken(this.uploadTokens, token)
    const objectPath = this.pathForKey(entry.key)
    await mkdir(path.dirname(objectPath), { recursive: true })
    await pipeline(stream, createWriteStream(objectPath))
  }

  resolveDownload(token: string): { readonly stream: NodeJS.ReadableStream; readonly filename: string } {
    const entry = this.consumeToken(this.downloadTokens, token)
    return { stream: createReadStream(this.pathForKey(entry.key)), filename: entry.filename ?? "download" }
  }

  private consumeToken(tokens: Map<string, LocalStorageToken>, token: string): LocalStorageToken {
    const entry = tokens.get(token)
    tokens.delete(token)
    if (!entry || entry.expiresAt.getTime() <= Date.now()) throw new Error("Drive storage token expired.")
    return entry
  }

  private pathForKey(key: string): string {
    const objectPath = path.resolve(this.root, key)
    const rootPath = path.resolve(this.root)
    if (objectPath !== rootPath && !objectPath.startsWith(`${rootPath}${path.sep}`)) {
      throw new Error("Invalid drive storage key.")
    }
    return objectPath
  }
}

@Injectable()
export class CosDriveStorage implements DriveStoragePort {
  private client: {
    readonly cos: COS
    readonly bucket: string
    readonly region: string
  } | null = null

  async createUploadInstruction(input: { readonly key: string; readonly contentType?: string }): Promise<DriveUploadInstruction> {
    const expiresAt = new Date(Date.now() + driveUploadUrlTtlSeconds * 1000)
    const url = await this.getSignedUrl({ key: input.key, method: "put", expires: driveUploadUrlTtlSeconds })
    return {
      method: "PUT",
      url,
      expiresAt,
      headers: input.contentType ? { "Content-Type": input.contentType } : {},
    }
  }

  async createDownloadUrl(input: { readonly key: string; readonly filename: string }): Promise<{ readonly url: string; readonly expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + driveDownloadUrlTtlSeconds * 1000)
    const url = await this.getSignedUrl({ key: input.key, method: "get", expires: driveDownloadUrlTtlSeconds })
    return { url, expiresAt }
  }

  async headObject(key: string): Promise<DriveStorageObjectInfo | null> {
    try {
      const result = await this.headObjectRaw(key)
      const sizeValue = result.headers?.["content-length"]
      return {
        key,
        size: BigInt(typeof sizeValue === "string" ? sizeValue : "0"),
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

  private getSignedUrl(input: { readonly key: string; readonly method: "put" | "get"; readonly expires: number }): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = this.getClient()
      client.cos.getObjectUrl({
        Bucket: client.bucket,
        Region: client.region,
        Key: input.key,
        Sign: true,
        Method: input.method,
        Expires: input.expires,
      }, (error, data) => {
        if (error) reject(error)
        else resolve(data.Url)
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
    if (!value) throw new Error(`${key} is required for Synapse Drive storage.`)
    return value
  }

  private getClient(): { readonly cos: COS; readonly bucket: string; readonly region: string } {
    if (this.client) return this.client
    const env = loadEnv(process.env)
    this.client = {
      cos: new COS({
        SecretId: this.requireConfig(env.driveCosSecretId, "DRIVE_COS_SECRET_ID"),
        SecretKey: this.requireConfig(env.driveCosSecretKey, "DRIVE_COS_SECRET_KEY"),
      }),
      bucket: this.requireConfig(env.driveCosBucket, "DRIVE_COS_BUCKET"),
      region: this.requireConfig(env.driveCosRegion, "DRIVE_COS_REGION"),
    }
    return this.client
  }
}

export function shouldUseCosDriveStorage(source: NodeJS.ProcessEnv = process.env): boolean {
  return isDriveCosConfigured(loadEnv(source))
}

function isCosNotFound(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && ("statusCode" in error)
    && (error as { readonly statusCode?: unknown }).statusCode === 404
}
