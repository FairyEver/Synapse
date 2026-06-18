import { Inject, Injectable, Optional } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { createReadStream, createWriteStream, statSync } from "node:fs"
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Transform } from "node:stream"
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
  createUploadInstruction(input: { readonly key: string; readonly contentType?: string; readonly expectedSize: bigint }): Promise<DriveUploadInstruction>
  createDownloadUrl(input: { readonly key: string; readonly filename: string }): Promise<{ readonly url: string; readonly expiresAt: Date }>
  headObject(key: string): Promise<DriveStorageObjectInfo | null>
  putObject(input: { readonly key: string; readonly body: Buffer; readonly contentType?: string | null }): Promise<void>
  copyObject(input: { readonly fromKey: string; readonly toKey: string; readonly contentType?: string | null }): Promise<void>
  getObjectStream(input: { readonly key: string }): Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint; readonly contentType?: string | null }>
  deleteObject(key: string): Promise<void>
}

type LocalStorageToken = {
  readonly key: string
  readonly contentType?: string | null
  readonly expectedSize?: bigint
  readonly filename?: string
  readonly expiresAt: Date
}

export class DriveUploadTooLargeError extends Error {
  readonly code = "DRIVE_UPLOAD_TOO_LARGE"

  constructor() {
    super("Drive upload exceeds expected size.")
    this.name = "DriveUploadTooLargeError"
  }
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
  private readonly contentTypes = new Map<string, string | null>()
  private readonly publicAppUrl: string
  private readonly root: string

  constructor(@Optional() @Inject(LOCAL_DRIVE_STORAGE_OPTIONS) options?: LocalDriveStorageOptions) {
    const env = options?.publicAppUrl ? undefined : loadEnv(process.env)
    this.publicAppUrl = options?.publicAppUrl ?? env?.appPublicUrl ?? `http://localhost:${env?.port ?? 3000}`
    this.root = options?.root ?? process.env.SYNAPSE_DRIVE_LOCAL_ROOT ?? path.join(os.tmpdir(), "synapse-drive-storage")
  }

  async createUploadInstruction(input: { readonly key: string; readonly contentType?: string; readonly expectedSize: bigint }): Promise<DriveUploadInstruction> {
    this.cleanupExpiredTokens()
    const expiresAt = new Date(Date.now() + driveUploadUrlTtlSeconds * 1000)
    const token = randomUUID()
    this.uploadTokens.set(token, { key: input.key, contentType: input.contentType ?? null, expectedSize: input.expectedSize, expiresAt })
    return {
      method: "PUT",
      url: `${this.publicAppUrl.replace(/\/+$/u, "")}/api/drive/local-upload/${encodeURIComponent(token)}`,
      expiresAt,
      headers: input.contentType ? { "Content-Type": input.contentType } : {},
    }
  }

  async createDownloadUrl(input: { readonly key: string; readonly filename: string }): Promise<{ readonly url: string; readonly expiresAt: Date }> {
    this.cleanupExpiredTokens()
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
    this.contentTypes.delete(key)
  }

  async putObject(input: { readonly key: string; readonly body: Buffer; readonly contentType?: string | null }): Promise<void> {
    const objectPath = this.pathForKey(input.key)
    await mkdir(path.dirname(objectPath), { recursive: true })
    await writeFile(objectPath, input.body)
    this.contentTypes.set(input.key, input.contentType ?? null)
  }

  async copyObject(input: { readonly fromKey: string; readonly toKey: string; readonly contentType?: string | null }): Promise<void> {
    const targetPath = this.pathForKey(input.toKey)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await copyFile(this.pathForKey(input.fromKey), targetPath)
    this.contentTypes.set(input.toKey, input.contentType ?? this.contentTypes.get(input.fromKey) ?? null)
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

  async acceptUpload(token: string, stream: NodeJS.ReadableStream): Promise<void> {
    const entry = this.readToken(this.uploadTokens, token)
    const contentLength = readContentLength(stream)
    if (entry.expectedSize !== undefined && contentLength !== undefined && contentLength > entry.expectedSize) {
      throw new DriveUploadTooLargeError()
    }
    const objectPath = this.pathForKey(entry.key)
    await mkdir(path.dirname(objectPath), { recursive: true })
    try {
      if (entry.expectedSize === undefined) {
        await pipeline(stream, createWriteStream(objectPath))
      } else {
        await pipeline(stream, createUploadSizeLimitStream(entry.expectedSize), createWriteStream(objectPath))
      }
    } catch (error) {
      await rm(objectPath, { force: true })
      throw error
    }
    this.uploadTokens.delete(token)
    this.contentTypes.set(entry.key, entry.contentType ?? null)
  }

  resolveDownload(token: string): { readonly stream: NodeJS.ReadableStream; readonly filename: string; readonly key: string } {
    const entry = this.readToken(this.downloadTokens, token)
    const objectPath = this.pathForKey(entry.key)
    try {
      statSync(objectPath)
    } catch (error) {
      attachLocalDriveStorageKey(error, entry.key)
      throw error
    }
    return { stream: createReadStream(objectPath), filename: entry.filename ?? "download", key: entry.key }
  }

  private readToken(tokens: Map<string, LocalStorageToken>, token: string): LocalStorageToken {
    this.cleanupExpiredTokenMap(tokens)
    const entry = tokens.get(token)
    if (!entry || entry.expiresAt.getTime() <= Date.now()) {
      tokens.delete(token)
      throw new Error("Drive storage token expired.")
    }
    return entry
  }

  private cleanupExpiredTokens(): void {
    this.cleanupExpiredTokenMap(this.uploadTokens)
    this.cleanupExpiredTokenMap(this.downloadTokens)
  }

  private cleanupExpiredTokenMap(tokens: Map<string, LocalStorageToken>): void {
    const now = Date.now()
    for (const [token, entry] of tokens) {
      if (entry.expiresAt.getTime() <= now) tokens.delete(token)
    }
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

function attachLocalDriveStorageKey(error: unknown, key: string): void {
  if (typeof error !== "object" || error === null) return
  Object.defineProperty(error, "storageKey", {
    configurable: true,
    enumerable: false,
    value: key,
  })
}

function readContentLength(stream: NodeJS.ReadableStream): bigint | undefined {
  const headers = (stream as { readonly headers?: Record<string, string | readonly string[] | undefined> }).headers
  const value = headers?.["content-length"] ?? headers?.["Content-Length"]
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw || !/^\d+$/u.test(raw)) return undefined
  return BigInt(raw)
}

function createUploadSizeLimitStream(expectedSize: bigint): Transform {
  let bytes = 0n
  return new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      bytes += BigInt(Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk))
      if (bytes > expectedSize) {
        callback(new DriveUploadTooLargeError())
        return
      }
      callback(null, chunk)
    },
  })
}

@Injectable()
export class CosDriveStorage implements DriveStoragePort {
  private client: {
    readonly cos: COS
    readonly bucket: string
    readonly region: string
  } | null = null

  async createUploadInstruction(input: { readonly key: string; readonly contentType?: string; readonly expectedSize: bigint }): Promise<DriveUploadInstruction> {
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
    const url = await this.getSignedUrl({
      key: input.key,
      method: "get",
      expires: driveDownloadUrlTtlSeconds,
      responseContentDisposition: driveContentDisposition(input.filename),
    })
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

  async putObject(input: { readonly key: string; readonly body: Buffer; readonly contentType?: string | null }): Promise<void> {
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

  async copyObject(input: { readonly fromKey: string; readonly toKey: string; readonly contentType?: string | null }): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const client = this.getClient()
      client.cos.putObjectCopy({
        Bucket: client.bucket,
        Region: client.region,
        Key: input.toKey,
        CopySource: `${client.bucket}.cos.${client.region}.myqcloud.com/${encodeCosCopySourceKey(input.fromKey)}`,
        MetadataDirective: input.contentType ? "Replaced" : "Copy",
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

  private getSignedUrl(input: {
    readonly key: string
    readonly method: "put" | "get"
    readonly expires: number
    readonly responseContentDisposition?: string
  }): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = this.getClient()
      client.cos.getObjectUrl({
        Bucket: client.bucket,
        Region: client.region,
        Key: input.key,
        Sign: true,
        Method: input.method,
        Expires: input.expires,
        Query: input.responseContentDisposition ? {
          "response-content-disposition": input.responseContentDisposition,
        } : undefined,
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

function encodeCosCopySourceKey(key: string): string {
  return key.split("/").map((part) => encodeURIComponent(part)).join("/")
}

function parseContentLength(value: string | undefined): bigint | undefined {
  if (!value) return undefined
  return BigInt(value)
}

export function driveContentDisposition(filename: string): string {
  const asciiFilename = filename.replace(/[^\x20-\x7E]|["\\;,\r\n]/g, "_")
  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeRFC5987ValueChars(filename)}`
}

function encodeRFC5987ValueChars(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}
