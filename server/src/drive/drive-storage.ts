import { Inject, Injectable, Optional } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { createReadStream, createWriteStream, statSync } from "node:fs"
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import COS from "cos-nodejs-sdk-v5"
import { attachmentContentDisposition } from "../common/content-disposition"
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

type PersistedLocalStorageToken = {
  readonly key: string
  readonly contentType?: string | null
  readonly expectedSize?: string
  readonly filename?: string
  readonly expiresAt: string
}

type PersistedLocalContentTypes = {
  readonly version: 1
  readonly entries: Record<string, string | null>
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
  private contentTypesLoadPromise: Promise<void> | null = null
  private readonly publicAppUrl: string
  private readonly root: string

  constructor(@Optional() @Inject(LOCAL_DRIVE_STORAGE_OPTIONS) options?: LocalDriveStorageOptions) {
    const env = options?.publicAppUrl ? undefined : loadEnv(process.env)
    this.publicAppUrl = options?.publicAppUrl ?? env?.appPublicUrl ?? `http://localhost:${env?.port ?? 3000}`
    this.root = options?.root ?? env?.driveLocalRoot ?? path.join(os.tmpdir(), "synapse-drive-storage")
  }

  async createUploadInstruction(input: { readonly key: string; readonly contentType?: string; readonly expectedSize: bigint }): Promise<DriveUploadInstruction> {
    this.cleanupExpiredTokens()
    const expiresAt = new Date(Date.now() + driveUploadUrlTtlSeconds * 1000)
    const token = randomUUID()
    const entry = { key: input.key, contentType: input.contentType ?? null, expectedSize: input.expectedSize, expiresAt }
    this.uploadTokens.set(token, entry)
    await this.persistUploadToken(token, entry)
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
    for (const objectPath of this.candidatePathsForKey(key)) {
      try {
        const info = await stat(objectPath)
        if (info.isDirectory()) continue
        return { key, size: BigInt(info.size) }
      } catch (error) {
        if (isMissingLocalDriveObjectError(error)) continue
        throw error
      }
    }
    return null
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.objectPathForKey(key), { force: true })
    await this.deleteLegacyObjectFile(key)
    await this.deleteContentType(key)
  }

  async putObject(input: { readonly key: string; readonly body: Buffer; readonly contentType?: string | null }): Promise<void> {
    const objectPath = this.objectPathForKey(input.key)
    await mkdir(path.dirname(objectPath), { recursive: true })
    await writeFile(objectPath, input.body)
    await this.setContentType(input.key, input.contentType ?? null)
  }

  async copyObject(input: { readonly fromKey: string; readonly toKey: string; readonly contentType?: string | null }): Promise<void> {
    await this.ensureContentTypesLoaded()
    const targetPath = this.objectPathForKey(input.toKey)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await copyFile(await this.requirePathForKey(input.fromKey), targetPath)
    await this.setContentType(input.toKey, input.contentType ?? this.contentTypes.get(input.fromKey) ?? null)
  }

  async getObjectStream(input: { readonly key: string }): Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint; readonly contentType?: string | null }> {
    await this.ensureContentTypesLoaded()
    const objectPath = await this.requirePathForKey(input.key)
    const info = await stat(objectPath)
    return {
      stream: createReadStream(objectPath),
      size: BigInt(info.size),
      contentType: this.contentTypes.get(input.key) ?? null,
    }
  }

  async acceptUpload(token: string, stream: NodeJS.ReadableStream): Promise<void> {
    const entry = await this.readUploadToken(token)
    const contentLength = readContentLength(stream)
    if (entry.expectedSize !== undefined && contentLength !== undefined && contentLength > entry.expectedSize) {
      throw new DriveUploadTooLargeError()
    }
    const objectPath = this.objectPathForKey(entry.key)
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
    await this.deletePersistedUploadToken(token)
    await this.setContentType(entry.key, entry.contentType ?? null)
  }

  resolveDownload(token: string): { readonly stream: NodeJS.ReadableStream; readonly filename: string; readonly key: string } {
    const entry = this.readToken(this.downloadTokens, token)
    const objectPath = this.firstExistingPathForKeySync(entry.key)
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

  private async readUploadToken(token: string): Promise<LocalStorageToken> {
    this.cleanupExpiredTokenMap(this.uploadTokens)
    const memoryEntry = this.uploadTokens.get(token)
    const entry = memoryEntry ?? await this.readPersistedUploadToken(token)
    if (!entry || entry.expiresAt.getTime() <= Date.now()) {
      this.uploadTokens.delete(token)
      await this.deletePersistedUploadToken(token)
      throw new Error("Drive storage token expired.")
    }
    this.uploadTokens.set(token, entry)
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

  private async persistUploadToken(token: string, entry: LocalStorageToken): Promise<void> {
    const tokenPath = this.uploadTokenPath(token)
    await mkdir(path.dirname(tokenPath), { recursive: true })
    const payload: PersistedLocalStorageToken = {
      key: entry.key,
      contentType: entry.contentType ?? null,
      expectedSize: entry.expectedSize?.toString(),
      filename: entry.filename,
      expiresAt: entry.expiresAt.toISOString(),
    }
    await writeFile(tokenPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 })
  }

  private async readPersistedUploadToken(token: string): Promise<LocalStorageToken | null> {
    const tokenPath = this.uploadTokenPath(token)
    let raw: string
    try {
      raw = await readFile(tokenPath, "utf8")
    } catch (error) {
      if (isMissingLocalDriveObjectError(error)) return null
      throw error
    }
    try {
      const parsed = JSON.parse(raw) as PersistedLocalStorageToken
      if (typeof parsed.key !== "string" || typeof parsed.expiresAt !== "string") return null
      const expiresAt = new Date(parsed.expiresAt)
      if (!Number.isFinite(expiresAt.getTime())) return null
      return {
        key: parsed.key,
        contentType: typeof parsed.contentType === "string" ? parsed.contentType : null,
        expectedSize: typeof parsed.expectedSize === "string" ? BigInt(parsed.expectedSize) : undefined,
        filename: typeof parsed.filename === "string" ? parsed.filename : undefined,
        expiresAt,
      }
    } catch {
      await this.deletePersistedUploadToken(token)
      return null
    }
  }

  private async deletePersistedUploadToken(token: string): Promise<void> {
    await rm(this.uploadTokenPath(token), { force: true })
  }

  private uploadTokenPath(token: string): string {
    const encodedToken = Buffer.from(token, "utf8").toString("base64url")
    return this.resolveUnderRoot(path.join(".tokens", "uploads", `${encodedToken}.json`))
  }

  private async ensureContentTypesLoaded(): Promise<void> {
    if (!this.contentTypesLoadPromise) {
      this.contentTypesLoadPromise = this.loadContentTypes().catch((error: unknown) => {
        this.contentTypesLoadPromise = null
        throw error
      })
    }
    await this.contentTypesLoadPromise
  }

  private async loadContentTypes(): Promise<void> {
    let raw: string
    try {
      raw = await readFile(this.contentTypesPath(), "utf8")
    } catch (error) {
      if (isMissingLocalDriveObjectError(error)) return
      throw error
    }
    try {
      const parsed = JSON.parse(raw) as PersistedLocalContentTypes
      if (parsed.version !== 1 || typeof parsed.entries !== "object" || parsed.entries === null) {
        await rm(this.contentTypesPath(), { force: true })
        return
      }
      this.contentTypes.clear()
      for (const [key, contentType] of Object.entries(parsed.entries)) {
        if (typeof contentType === "string" || contentType === null) this.contentTypes.set(key, contentType)
      }
    } catch {
      this.contentTypes.clear()
      await rm(this.contentTypesPath(), { force: true })
    }
  }

  private async setContentType(key: string, contentType: string | null): Promise<void> {
    await this.ensureContentTypesLoaded()
    this.contentTypes.set(key, contentType)
    await this.persistContentTypes()
  }

  private async deleteContentType(key: string): Promise<void> {
    await this.ensureContentTypesLoaded()
    this.contentTypes.delete(key)
    await this.persistContentTypes()
  }

  private async persistContentTypes(): Promise<void> {
    const metadataPath = this.contentTypesPath()
    await mkdir(path.dirname(metadataPath), { recursive: true })
    const tempPath = `${metadataPath}.${process.pid}.${Date.now()}.tmp`
    const payload: PersistedLocalContentTypes = {
      version: 1,
      entries: Object.fromEntries(this.contentTypes.entries()),
    }
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    await rename(tempPath, metadataPath)
  }

  private contentTypesPath(): string {
    return this.resolveUnderRoot(path.join(".metadata", "content-types.json"))
  }

  private objectPathForKey(key: string): string {
    const encodedKey = Buffer.from(key, "utf8").toString("base64url")
    return this.resolveUnderRoot(path.join(".objects", encodedKey))
  }

  private legacyPathForKey(key: string): string {
    return this.resolveUnderRoot(key)
  }

  private candidatePathsForKey(key: string): readonly string[] {
    return [this.objectPathForKey(key), this.legacyPathForKey(key)]
  }

  private async requirePathForKey(key: string): Promise<string> {
    for (const objectPath of this.candidatePathsForKey(key)) {
      try {
        const info = await stat(objectPath)
        if (info.isDirectory()) continue
        return objectPath
      } catch (error) {
        if (isMissingLocalDriveObjectError(error)) continue
        throw error
      }
    }
    return this.legacyPathForKey(key)
  }

  private firstExistingPathForKeySync(key: string): string {
    for (const objectPath of this.candidatePathsForKey(key)) {
      try {
        const info = statSync(objectPath)
        if (info.isDirectory()) continue
        return objectPath
      } catch (error) {
        if (isMissingLocalDriveObjectError(error)) continue
        throw error
      }
    }
    return this.legacyPathForKey(key)
  }

  private resolveUnderRoot(relativePath: string): string {
    const objectPath = path.resolve(this.root, relativePath)
    const rootPath = path.resolve(this.root)
    if (objectPath !== rootPath && !objectPath.startsWith(`${rootPath}${path.sep}`)) {
      throw new Error("Invalid drive storage key.")
    }
    return objectPath
  }

  private async deleteLegacyObjectFile(key: string): Promise<void> {
    const objectPath = this.legacyPathForKey(key)
    try {
      const info = await stat(objectPath)
      if (info.isDirectory()) return
    } catch (error) {
      if (isMissingLocalDriveObjectError(error)) return
      throw error
    }
    await rm(objectPath, { force: true })
  }
}

function isMissingLocalDriveObjectError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { readonly code?: unknown }).code === "ENOENT"
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
      responseContentDisposition: attachmentContentDisposition(input.filename),
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
