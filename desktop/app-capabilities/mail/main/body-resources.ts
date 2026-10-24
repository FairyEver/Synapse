import { randomUUID } from "node:crypto"
import { lookup as dnsLookup } from "node:dns/promises"
import { isIP } from "node:net"
import http from "node:http"
import https from "node:https"
import type { IncomingMessage } from "node:http"
import { Readable } from "node:stream"
import { isLocalOrPrivateHost } from "../../../electron/services/source-acquisition/url-source"
import { MAIL_MAX_IMAGE_BYTES } from "../shared/limits"
import { MailError, type MailContext } from "../shared/types"
import { MailRepository } from "./repository"
import { MailAssets, type MailAccess, type StoredMailAsset } from "./assets"
import { resolveMessage } from "./sync"
import { isImageFakeIp, resolveImageFakeIp } from "./remote-image-dns"

export function rasterMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png"
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg"
  if (/^GIF8[79]a$/u.test(bytes.subarray(0, 6).toString("ascii"))) return "image/gif"
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp"
  return null
}
export interface RemoteImageOptions {
  allowed: boolean; signal: AbortSignal; authorize: (origin: string) => Promise<void>
  lookup?: (hostname: string) => Promise<{ address: string; family: number }[]>
}
async function resolveImageHost(host: string, signal: AbortSignal, lookup: NonNullable<RemoteImageOptions["lookup"]>) {
  let abort: (() => void) | undefined
  try {
    return await Promise.race([lookup(host), new Promise<never>((_resolve, reject) => {
      abort = () => reject(new MailError("NETWORK_TIMEOUT", "图片地址解析超时"))
      signal.addEventListener("abort", abort, { once: true })
      if (signal.aborted) abort()
    })])
  } finally { if (abort) signal.removeEventListener("abort", abort) }
}
function publicIp(address: string): boolean {
  if (isLocalOrPrivateHost(address)) return false
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/iu.test(address)
  if (isIP(address) !== 4) return false
  const [a, b] = address.split(".").map(Number)
  return a > 0 && a < 224 && !(a === 192 && b === 0) && !(a === 198 && [18, 19, 51].includes(b)) && !(a === 203 && b === 0)
}
function requestPinned(url: URL, address: string, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http
    const host = url.hostname.replace(/^\[|\]$/gu, "")
    const request = transport.request({ protocol: url.protocol, hostname: address, port: url.port || undefined, path: `${url.pathname}${url.search}`, method: "GET", headers: { Host: url.host, Accept: "image/png,image/jpeg,image/gif,image/webp" }, agent: false, ...(url.protocol === "https:" && !isIP(host) ? { servername: host } : {}), signal, timeout: 30_000 }, resolve)
    request.once("error", () => reject(new MailError("IMAGE_FAILED", "远程图片获取失败")))
    request.once("timeout", () => request.destroy(new MailError("NETWORK_TIMEOUT", "远程图片获取超时")))
    request.end()
  })
}
export async function fetchRemoteImage(input: string, options: RemoteImageOptions): Promise<{ bytes: Buffer; mime: string }> {
  if (!options.allowed) throw new MailError("IMAGE_BLOCKED", "请先允许加载此邮件的远程图片")
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
  let url: URL
  try { url = new URL(input) } catch { throw new MailError("IMAGE_BLOCKED", "图片地址无效") }
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      signal.throwIfAborted()
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || isLocalOrPrivateHost(url.hostname)) throw new MailError("IMAGE_BLOCKED", "不允许访问此图片地址")
      await options.authorize(url.origin)
      const host = url.hostname.replace(/^\[|\]$/gu, "")
      let addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolveImageHost(host, signal, options.lookup ?? (hostname => dnsLookup(hostname, { all: true })))
      if (!isIP(host) && addresses.some(a => isImageFakeIp(a.address))) {
        if (addresses.some(a => !publicIp(a.address) && !isImageFakeIp(a.address))) throw new MailError("IMAGE_BLOCKED", "不允许访问本机或内网图片")
        addresses = await resolveImageFakeIp(host, signal, options.authorize)
      }
      signal.throwIfAborted()
      if (!addresses.length || addresses.some(a => !publicIp(a.address))) throw new MailError("IMAGE_BLOCKED", "不允许访问本机或内网图片")
      const response = await requestPinned(url, addresses[0].address, signal)
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        const location = response.headers.location; response.destroy()
        if (redirects === 3 || !location) throw new MailError("IMAGE_BLOCKED", "图片重定向次数超限")
        url = new URL(location, url); continue
      }
      if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300 || Number(response.headers["content-length"] ?? 0) > MAIL_MAX_IMAGE_BYTES) { response.destroy(); throw new MailError("IMAGE_FAILED", "图片不可用或超过大小上限") }
      const chunks: Buffer[] = []; let size = 0
      try {
        for await (const chunk of response) {
          signal.throwIfAborted(); size += chunk.length
          if (size > MAIL_MAX_IMAGE_BYTES) throw new MailError("LIMIT_EXCEEDED", "图片超过大小上限")
          chunks.push(chunk)
        }
      } finally { response.destroy() }
      const bytes = Buffer.concat(chunks, size), mime = rasterMime(bytes)
      if (!mime) throw new MailError("IMAGE_BLOCKED", "仅支持常见图片格式")
      return { bytes, mime }
    }
    throw new MailError("IMAGE_BLOCKED", "图片重定向次数超限")
  } catch (error) {
    if (error instanceof MailError) throw error
    throw new MailError("IMAGE_FAILED", "远程图片获取失败")
  }
}
interface ImageGrant { ownerId: string; generation: number; messageId: string; assetId: string; expiresAt: number }
export class MailBodyResources {
  private grants = new Map<string, ImageGrant>()
  constructor(private readonly repo: MailRepository, private readonly assets: MailAssets, private readonly access: MailAccess) {}
  async issue(ctx: MailContext, messageId: string, assetId: string): Promise<string> {
    const message = await resolveMessage(this.repo, ctx, messageId), asset = await this.assets.info(ctx, assetId)
    if (asset.accountId !== message.accountId || asset.messageId !== messageId || asset.state !== "ready") throw new MailError("UNAVAILABLE", "图片不可用")
    if (asset.cid) {
      let cursor: string | undefined, matches = 0
      do {
        const page = await this.repo.page<StoredMailAsset>(ctx, "assets", { accountId: asset.accountId, cursor, limit: 100 })
        matches += page.items.filter(a => a.data.asset.messageId === messageId && a.data.asset.cid === asset.cid).length
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      if (matches !== 1) throw new MailError("AMBIGUOUS_CID", "邮件中的图片标识重复")
    }
    if (!rasterMime(await this.assets.read(ctx, assetId, MAIL_MAX_IMAGE_BYTES))) throw new MailError("IMAGE_BLOCKED", "图片格式不可显示")
    const token = randomUUID()
    for (const [key, grant] of this.grants) if (grant.expiresAt <= Date.now() || grant.ownerId !== ctx.ownerId || grant.generation !== ctx.generation) this.grants.delete(key)
    if (this.grants.size >= 1000) this.grants.delete(this.grants.keys().next().value!)
    this.grants.set(token, { ownerId: ctx.ownerId, generation: ctx.generation, messageId, assetId, expiresAt: Date.now() + 5 * 60_000 })
    return token
  }
  async read(ctx: MailContext, messageId: string, token: string): Promise<{ mime: string; base64: string }> {
    const grant = this.grants.get(token)
    if (!grant || grant.expiresAt <= Date.now() || grant.ownerId !== ctx.ownerId || grant.generation !== ctx.generation || grant.messageId !== messageId) throw new MailError("UNAVAILABLE", "图片授权已失效")
    await resolveMessage(this.repo, ctx, messageId)
    const bytes = await this.assets.read(ctx, grant.assetId, MAIL_MAX_IMAGE_BYTES), mime = rasterMime(bytes)
    if (!mime) throw new MailError("IMAGE_BLOCKED", "图片格式不可显示")
    return { mime, base64: bytes.toString("base64") }
  }
  async remote(ctx: MailContext, messageId: string, url: string, allowed: boolean): Promise<{ token: string; assetId: string }> {
    const message = await resolveMessage(this.repo, ctx, messageId)
    const image = await fetchRemoteImage(url, { allowed, signal: ctx.signal, authorize: origin => this.access(ctx, "network.connect", origin) })
    const asset = await this.assets.put(ctx, Readable.from([image.bytes]), { accountId: message.accountId, messageId, mime: image.mime, name: "remote-image", cache: true }, MAIL_MAX_IMAGE_BYTES)
    await this.assets.trim(ctx)
    return { token: await this.issue(ctx, messageId, asset.id), assetId: asset.id }
  }
  clear(): void { this.grants.clear() }
}
