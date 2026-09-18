import { Inject, Injectable, Logger, Optional } from "@nestjs/common"
import COS from "cos-nodejs-sdk-v5"
import { createReadStream } from "node:fs"
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import type { Dirent } from "node:fs"
import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"

import { MEETING_RECORDING_PATH_PREFIX } from "@synapse/shared"

import { isPlatformMediaCosConfigured, loadEnv } from "../config/env"

/**
 * 会议音频的对象存储。
 *
 * 全仓没有分块上传的先例，所以这一层是从零建的。两件事决定了它的形状：
 *
 * 1. **客户端不能直传。** 现在用的 SDK 只能在整文件级别签出读写地址，
 *    `getObjectUrl` 的签名动作不覆盖 UploadPart。与其在这上面绕，不如让分片过一次
 *    服务端——音频本来就只有 28 MB/小时，代价可以忽略，换来的是客户端不持有任何存储
 *    凭证。
 * 2. **取消必须真正「中止」，不是「删除」。** `deleteObject` 删不掉一次未完成的分块
 *    上传留在桶里的分片，那些碎片会一直按量计费。两件事是分开的两个接口，不能互相
 *    顶替。
 *
 * 未配 COS 时回退本地盘。本地实现把分片落成独立文件、完成时才拼成一个对象，所以
 * 「中止」就是把整个分片目录删掉——语义与 COS 一致，而且不需要一张重启即丢的内存表。
 */

export const MEETING_STORAGE_PORT = Symbol("meetingStorage")

/**
 * 存储配置走注入而不是每次现读环境变量。
 *
 * 这样两个实现都能在测试里被完整构造：本地实现给一个临时根目录，对象存储实现给一组
 * 假凭据加一个被 mock 掉的 SDK，都不需要为了让 `loadEnv` 通过而伪造一堆无关变量。
 */
export const MEETING_COS_OPTIONS = Symbol("meetingCosOptions")
export const LOCAL_MEETING_STORAGE_OPTIONS = Symbol("localMeetingStorageOptions")

export type MeetingCosOptions = {
  readonly secretId: string
  readonly secretKey: string
  readonly bucket: string
  readonly region: string
}

export type LocalMeetingStorageOptions = {
  readonly root: string
  readonly publicAppUrl: string
}

export type MeetingStoragePart = {
  readonly partNumber: number
  readonly etag: string
}

export type MeetingStorageObjectInfo = {
  readonly size: bigint
  readonly etag: string | null
}

export interface MeetingStoragePort {
  /** 开启一次分块上传，返回上传 ID。 */
  initMultipartUpload(key: string, contentType: string): Promise<string>
  /** 写入一个分片，返回它的 etag。 */
  uploadPart(input: {
    readonly key: string
    readonly uploadId: string
    readonly partNumber: number
    readonly body: Buffer
  }): Promise<string>
  /** 合并成单文件，返回合并后的对象信息。 */
  completeMultipartUpload(input: {
    readonly key: string
    readonly uploadId: string
    readonly parts: readonly MeetingStoragePart[]
  }): Promise<MeetingStorageObjectInfo>
  /** 中止这次分块上传并丢弃已传分片。删对象顶替不了这一步。 */
  abortMultipartUpload(input: { readonly key: string; readonly uploadId: string }): Promise<void>
  headObject(key: string): Promise<MeetingStorageObjectInfo | null>
  createDownloadUrl(key: string, ttlSeconds: number): Promise<string>
  getObjectStream(key: string): Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint }>
  deleteObject(key: string): Promise<void>
  /**
   * 清掉超过 `olderThanMs` 还没完成的分块上传。
   *
   * 进程中途被杀、用户直接关掉电脑，都会留下一次没人收尾的分块上传。没有这一步，
   * 那些分片会一直躺在桶里按量计费——两个清理入口都不覆盖它们。
   */
  listStaleMultipartUploads(olderThanMs: number): Promise<readonly string[]>
}

const MEETING_MEDIA_LOCAL_DIRECTORY = "platform-media"
const PARTS_SUFFIX = ".parts"

/** 对象键是服务端生成的，层级不会深；给个上限防止误指到一棵很大的树上。 */
const MAX_PART_SCAN_DEPTH = 6

async function collectPartDirectories(directory: string, depth: number): Promise<string[]> {
  if (depth > MAX_PART_SCAN_DEPTH) return []
  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const found: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = path.join(directory, entry.name)
    if (entry.name.endsWith(PARTS_SUFFIX)) {
      found.push(full)
      continue
    }
    // 隐藏目录是内部记账用的（令牌、元数据），不是对象键的一部分。
    if (entry.name.startsWith(".")) continue
    found.push(...(await collectPartDirectories(full, depth + 1)))
  }
  return found
}
const DOWNLOAD_TOKEN_DIRECTORY = [".tokens", "meeting-downloads"] as const
const DOWNLOAD_TOKEN_TTL_MS = 60 * 60 * 1000

function requireConfig(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for meeting recording storage.`)
  return value
}

function isCosNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { statusCode?: number }).statusCode === 404
}

@Injectable()
export class CosMeetingStorage implements MeetingStoragePort {
  private readonly logger = new Logger(CosMeetingStorage.name)
  private client: { readonly cos: COS; readonly bucket: string; readonly region: string } | null = null

  constructor(@Optional() @Inject(MEETING_COS_OPTIONS) private readonly options?: MeetingCosOptions) {}

  async initMultipartUpload(key: string, contentType: string): Promise<string> {
    const { cos, bucket, region } = this.getClient()
    const result = await cos.multipartInit({ Bucket: bucket, Region: region, Key: key, ContentType: contentType })
    if (!result.UploadId) throw new Error("Object storage did not return an upload id.")
    return result.UploadId
  }

  async uploadPart(input: {
    readonly key: string
    readonly uploadId: string
    readonly partNumber: number
    readonly body: Buffer
  }): Promise<string> {
    const { cos, bucket, region } = this.getClient()
    const result = await cos.multipartUpload({
      Bucket: bucket,
      Region: region,
      Key: input.key,
      UploadId: input.uploadId,
      PartNumber: input.partNumber,
      Body: input.body,
      ContentLength: input.body.byteLength,
    })
    if (!result.ETag) throw new Error("Object storage did not return an etag for the uploaded part.")
    return result.ETag
  }

  async completeMultipartUpload(input: {
    readonly key: string
    readonly uploadId: string
    readonly parts: readonly MeetingStoragePart[]
  }): Promise<MeetingStorageObjectInfo> {
    const { cos, bucket, region } = this.getClient()
    await cos.multipartComplete({
      Bucket: bucket,
      Region: region,
      Key: input.key,
      UploadId: input.uploadId,
      // 顺序即分片在对象里的顺序，必须按 partNumber 升序传，否则音频会拼错位置。
      Parts: [...input.parts]
        .sort((left, right) => left.partNumber - right.partNumber)
        .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
    })
    // 合并完成不等于对象可用：回查一次大小，拿不到就当作失败，让调用方保留重试入口。
    const info = await this.headObject(input.key)
    if (!info) throw new Error("Object storage did not report the completed meeting recording.")
    return info
  }

  async abortMultipartUpload(input: { readonly key: string; readonly uploadId: string }): Promise<void> {
    const { cos, bucket, region } = this.getClient()
    await cos.multipartAbort({ Bucket: bucket, Region: region, Key: input.key, UploadId: input.uploadId })
  }

  async headObject(key: string): Promise<MeetingStorageObjectInfo | null> {
    const { cos, bucket, region } = this.getClient()
    try {
      const result = await cos.headObject({ Bucket: bucket, Region: region, Key: key })
      return {
        size: BigInt(result.headers?.["content-length"] ?? "0"),
        etag: result.headers?.etag ?? null,
      }
    } catch (error) {
      if (isCosNotFound(error)) return null
      throw error
    }
  }

  async createDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    const { cos, bucket, region } = this.getClient()
    return new Promise<string>((resolve, reject) => {
      cos.getObjectUrl(
        { Bucket: bucket, Region: region, Key: key, Sign: true, Method: "get", Expires: ttlSeconds },
        (error, data) => (error ? reject(error) : resolve(data.Url)),
      )
    })
  }

  async getObjectStream(key: string): Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint }> {
    const { cos, bucket, region } = this.getClient()
    const info = await this.headObject(key)
    if (!info) throw Object.assign(new Error("Meeting recording not found."), { statusCode: 404 })
    // `getObjectStream` 是同步返回 Stream 的，不走回调也不返回 Promise。
    const stream = cos.getObjectStream({ Bucket: bucket, Region: region, Key: key }) as unknown as NodeJS.ReadableStream
    return { stream, size: info.size }
  }

  async deleteObject(key: string): Promise<void> {
    const { cos, bucket, region } = this.getClient()
    await new Promise<void>((resolve, reject) => {
      cos.deleteObject({ Bucket: bucket, Region: region, Key: key }, (error) => (error ? reject(error) : resolve()))
    })
  }

  async listStaleMultipartUploads(olderThanMs: number): Promise<readonly string[]> {
    const { cos, bucket, region } = this.getClient()
    const threshold = Date.now() - olderThanMs
    const stale: { key: string; uploadId: string }[] = []
    let keyMarker: string | undefined
    let uploadIdMarker: string | undefined
    // 分页拉完为止：一次大会话可能同时留下几个未完成上传，只看第一页会漏。
    for (let page = 0; page < 20; page += 1) {
      const params: COS.MultipartListParams = {
        Bucket: bucket,
        Region: region,
        Prefix: `${MEETING_RECORDING_PATH_PREFIX}/`,
        // 不分组。SDK 把 Delimiter 声明成必填，空串表示「不按前缀聚合」。
        Delimiter: "",
        MaxUploads: 1000,
        ...(keyMarker ? { KeyMarker: keyMarker } : {}),
        ...(uploadIdMarker ? { UploadIdMarker: uploadIdMarker } : {}),
      }
      const result = await cos.multipartList(params)
      for (const upload of result.Upload ?? []) {
        const initiated = upload.Initiated ? Date.parse(upload.Initiated) : Number.NaN
        if (Number.isFinite(initiated) && initiated > threshold) continue
        stale.push({ key: upload.Key, uploadId: upload.UploadId })
      }
      if (!result.IsTruncated) break
      keyMarker = result.NextKeyMarker
      uploadIdMarker = result.NextUploadIdMarker
    }
    const aborted: string[] = []
    for (const entry of stale) {
      try {
        await this.abortMultipartUpload({ key: entry.key, uploadId: entry.uploadId })
        aborted.push(entry.key)
      } catch (error) {
        this.logger.warn(
          { key: entry.key, errorMessage: error instanceof Error ? error.message : String(error) },
          "Stale meeting multipart upload could not be aborted",
        )
      }
    }
    return aborted
  }

  private getClient(): { readonly cos: COS; readonly bucket: string; readonly region: string } {
    if (this.client) return this.client
    const options = this.options ?? readMeetingCosOptionsFromEnv()
    this.client = {
      cos: new COS({ SecretId: options.secretId, SecretKey: options.secretKey }),
      bucket: options.bucket,
      region: options.region,
    }
    return this.client
  }
}

/** 与文档图片同一套配置：会议录音和它是同一个桶里的两个前缀。 */
export function readMeetingCosOptionsFromEnv(): MeetingCosOptions {
  const env = loadEnv(process.env)
  return {
    secretId: requireConfig(env.platformMediaCosSecretId, "PLATFORM_MEDIA_COS_SECRET_ID"),
    secretKey: requireConfig(env.platformMediaCosSecretKey, "PLATFORM_MEDIA_COS_SECRET_KEY"),
    bucket: requireConfig(env.platformMediaCosBucket, "PLATFORM_MEDIA_COS_BUCKET"),
    region: requireConfig(env.platformMediaCosRegion, "PLATFORM_MEDIA_COS_REGION"),
  }
}

/**
 * 没配对象存储时返回 `undefined`，而不是抛错。
 *
 * 这个值要无条件注册成一个 provider：模块是在导入时求值的，任何在模块文件顶层读环境
 * 变量的写法都会让「只是 import 一下 AppModule」变成一次可能抛错的副作用。用本地盘
 * 的部署根本不需要这组配置，不能因此起不来。
 */
export function readMeetingCosOptionsIfConfigured(): MeetingCosOptions | undefined {
  return isPlatformMediaCosConfigured(loadEnv(process.env)) ? readMeetingCosOptionsFromEnv() : undefined
}

export function readLocalMeetingStorageOptions(): LocalMeetingStorageOptions {
  const env = loadEnv(process.env)
  return {
    root: env.driveLocalRoot ?? path.join(os.tmpdir(), "synapse-drive-storage"),
    publicAppUrl: env.appPublicUrl ?? "",
  }
}

@Injectable()
export class LocalMeetingStorage implements MeetingStoragePort {
  constructor(@Optional() @Inject(LOCAL_MEETING_STORAGE_OPTIONS) private readonly options?: LocalMeetingStorageOptions) {}

  /** 一次上传的分片先各落一个文件，完成后才拼成一个对象。 */
  async initMultipartUpload(_key: string, _contentType: string): Promise<string> {
    // 本地没有「上传 ID」这个概念，但方法签名与端口一致：调用方不该知道用的是哪一种。
    return randomUUID()
  }

  async uploadPart(input: {
    readonly key: string
    readonly uploadId: string
    readonly partNumber: number
    readonly body: Buffer
  }): Promise<string> {
    const target = this.partPath(input.key, input.partNumber)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, input.body)
    // 本地没有服务端算好的 etag，用字节数当 etag：它唯一的用途是完成时对齐分片清单。
    return `local-${input.body.byteLength}`
  }

  async completeMultipartUpload(input: {
    readonly key: string
    readonly uploadId: string
    readonly parts: readonly MeetingStoragePart[]
  }): Promise<MeetingStorageObjectInfo> {
    const ordered = [...input.parts].sort((left, right) => left.partNumber - right.partNumber)
    const target = this.objectPath(input.key)
    await mkdir(path.dirname(target), { recursive: true })
    await rm(target, { force: true })
    for (const part of ordered) {
      // 一片一片读、一片一片追加：内存占用由分片大小决定（1 MB），与会议多长无关。
      let chunk: Buffer
      try {
        chunk = await readFile(this.partPath(input.key, part.partNumber))
      } catch {
        throw new Error(`Meeting recording part ${part.partNumber} is missing from local storage.`)
      }
      await appendFile(target, chunk)
    }
    await rm(this.partsDirectory(input.key), { recursive: true, force: true })
    const info = await this.headObject(input.key)
    if (!info) throw new Error("Local meeting recording was not written.")
    return info
  }

  async abortMultipartUpload(input: { readonly key: string; readonly uploadId: string }): Promise<void> {
    // uploadId 在本地用不上——分片按对象键归拢，一个键下只会有一组；签名仍与端口一致。
    await rm(this.partsDirectory(input.key), { recursive: true, force: true })
  }

  async headObject(key: string): Promise<MeetingStorageObjectInfo | null> {
    // 先解析路径再进 try：越界是安全错误，不能被下面那个「文件不存在」的 catch
    // 吞成 null——那样越界查询会表现成「这个对象没有」，而不是被拒绝。
    const target = this.objectPath(key)
    try {
      const info = await stat(target)
      return { size: BigInt(info.size), etag: `local-${info.size}` }
    } catch {
      return null
    }
  }

  async createDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    const token = randomUUID()
    const tokenPath = this.downloadTokenPath(token)
    await mkdir(path.dirname(tokenPath), { recursive: true })
    // 落盘而不是只放内存：签名地址是交给腾讯云去取的，中间隔着一次服务端重启就可能失效。
    await writeFile(
      tokenPath,
      JSON.stringify({ key, expiresAt: new Date(Date.now() + Math.min(ttlSeconds * 1000, DOWNLOAD_TOKEN_TTL_MS)).toISOString() }),
      { encoding: "utf8", mode: 0o600 },
    )
    return `${this.publicAppUrl()}/api/meetings/local-audio/${token}`
  }

  private publicAppUrl(): string {
    if (this.options) return this.options.publicAppUrl.replace(/\/$/u, "")
    return (loadEnv(process.env).appPublicUrl ?? "").replace(/\/$/u, "")
  }

  /** 读取并消费一个下载令牌，返回它指向的对象键。 */
  async resolveDownloadToken(token: string): Promise<string | null> {
    const tokenPath = this.downloadTokenPath(token)
    let payload: { key?: string; expiresAt?: string }
    try {
      payload = JSON.parse(await readFile(tokenPath, "utf8")) as { key?: string; expiresAt?: string }
    } catch {
      return null
    }
    if (!payload.key || !payload.expiresAt) return null
    if (Date.parse(payload.expiresAt) <= Date.now()) {
      await rm(tokenPath, { force: true })
      return null
    }
    return payload.key
  }

  async getObjectStream(key: string): Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint }> {
    const info = await this.headObject(key)
    if (!info) throw Object.assign(new Error("Meeting recording not found."), { statusCode: 404 })
    return { stream: createReadStream(this.objectPath(key)), size: info.size }
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.objectPath(key), { force: true })
  }

  async listStaleMultipartUploads(olderThanMs: number): Promise<readonly string[]> {
    const root = path.join(this.localRoot(), MEETING_MEDIA_LOCAL_DIRECTORY)
    const threshold = Date.now() - olderThanMs
    const aborted: string[] = []
    // 分片目录嵌在对象键的层级下面（`…/meeting-recordings/<id>.parts`），所以必须往
    // 下走；只扫根目录会一个都找不到。
    for (const directory of await collectPartDirectories(root, 0)) {
      try {
        const info = await stat(directory)
        if (info.mtimeMs > threshold) continue
        await rm(directory, { recursive: true, force: true })
        const key = path.relative(root, directory).split(path.sep).join("/")
        aborted.push(key.slice(0, -PARTS_SUFFIX.length))
      } catch {
        // 目录刚好被别处收走，不是错误。
      }
    }
    return aborted
  }

  private localRoot(): string {
    if (this.options) return this.options.root
    const env = loadEnv(process.env)
    return env.driveLocalRoot ?? path.join(os.tmpdir(), "synapse-drive-storage")
  }

  private objectPath(key: string): string {
    return this.resolveUnderRoot(path.join(this.localRoot(), MEETING_MEDIA_LOCAL_DIRECTORY, ...key.split("/")))
  }

  private partsDirectory(key: string): string {
    return `${this.objectPath(key)}${PARTS_SUFFIX}`
  }

  private partPath(key: string, partNumber: number): string {
    return path.join(this.partsDirectory(key), `${String(partNumber).padStart(6, "0")}.part`)
  }

  private downloadTokenPath(token: string): string {
    const encoded = Buffer.from(token, "utf8").toString("base64url")
    return this.resolveUnderRoot(path.join(this.localRoot(), ...DOWNLOAD_TOKEN_DIRECTORY, `${encoded}.json`))
  }

  /** 对象键来自服务端生成的 cuid，但仍然挡住越界路径，避免将来有人把它接到用户输入上。 */
  private resolveUnderRoot(candidate: string): string {
    const root = path.resolve(this.localRoot())
    const resolved = path.resolve(candidate)
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error("Meeting storage path escapes the configured root.")
    }
    return resolved
  }
}


export function shouldUseCosMeetingStorage(source: NodeJS.ProcessEnv = process.env): boolean {
  return isPlatformMediaCosConfigured(loadEnv(source))
}
