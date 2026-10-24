import { ImapFlow, type ImapFlowOptions, type FetchMessageObject, type MessageAddressObject, type CopyResponseObject } from "imapflow"
import { Readable } from "node:stream"
import { MailError, type AccountConfig, type MailContext, type Address } from "../../shared/types"
import { MAIL_MAX_ATTACHMENT_BYTES } from "../../shared/limits"
import type { MailAccess } from "../assets"
import { normalizeProtocolError, protocolCall, type MailImapSession, type MailSearchQuery, type RemoteHeader, type UidMapping } from "./types"

export function imapOptions(config: AccountConfig, credential: string): ImapFlowOptions {
  return { host: config.imap.host, port: config.imap.port, secure: config.imap.security === "tls",
    ...(config.imap.security === "starttls" ? { doSTARTTLS: true } : {}),
    auth: { user: config.username ?? config.email, pass: credential }, tls: { rejectUnauthorized: true },
    logger: false, disableAutoIdle: true, maxIdleTime: 25_000, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  }
}
const addresses = (values?: MessageAddressObject[]): Address[] => (values ?? []).flatMap(v => v.address ? [{ address: v.address, ...(v.name ? { name: v.name } : {}) }] : [])
function header(value: FetchMessageObject): RemoteHeader {
  const envelope = value.envelope
  const date = envelope?.date ?? value.internalDate
  const parsed = date ? new Date(date) : null
  const received = value.internalDate ? new Date(value.internalDate) : null
  const references = value.headers?.toString().replace(/\r?\n[ \t]+/gu, " ").match(/^references:\s*(.+)$/imu)?.[1].match(/<[^<>\r\n]+>/gu) ?? []
  return { uid: value.uid, subject: envelope?.subject ?? "", from: addresses(envelope?.from), to: addresses(envelope?.to), cc: addresses(envelope?.cc), sender: addresses(envelope?.sender), replyTo: addresses(envelope?.replyTo), date: parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null,
    receivedAt: received && Number.isFinite(received.getTime()) ? received.toISOString() : null,
    size: value.size ?? 0, flags: [...(value.flags ?? [])], messageId: envelope?.messageId ?? null, references, structure: value.bodyStructure ?? null }
}
const mapping = (result: CopyResponseObject | false): UidMapping | null => result && result.uidValidity && result.uidMap
  ? { uidValidity: String(result.uidValidity), uids: result.uidMap } : null
function uidRange(uids: number[]): string {
  if (!uids.length || uids.length > 100 || uids.some(uid => !Number.isSafeInteger(uid) || uid <= 0)) throw new MailError("INVALID_INPUT", "邮件 UID 范围无效")
  return uids.join(",")
}

export class ImapSession implements MailImapSession {
  private failure: MailError | null = null
  constructor(private readonly client: ImapFlow) {
    client.on("error", (error) => { this.failure = normalizeProtocolError(error); client.close() })
  }
  get capabilities(): ReadonlySet<string> { return new Set(this.client.capabilities.keys()) }
  async close(): Promise<void> { this.client.close() }
  private async inFolder<T>(path: string, signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    if (this.failure) throw this.failure
    return protocolCall(signal, () => this.client.close(), async () => {
      const lock = await this.client.getMailboxLock(path)
      try { return await run() } finally { lock.release() }
    })
  }
  async listFolders(signal: AbortSignal) {
    const folders = await protocolCall(signal, () => this.client.close(), () => this.client.list({ statusQuery: { messages: true } }))
    // SDK name heuristics are not proof of a server special-use mapping.
    return folders.map(f => ({ path: f.path, name: f.name, delimiter: f.delimiter, flags: [...f.flags], specialUse: f.specialUseSource === "extension" || f.specialUseSource === "user" ? f.specialUse ?? null : null, count: f.status?.messages ?? null }))
  }
  async select(path: string, signal: AbortSignal) {
    return this.inFolder(path, signal, async () => {
      const mailbox = this.client.mailbox
      if (!mailbox) throw new MailError("UNAVAILABLE", "信箱不可用")
      return { uidValidity: String(mailbox.uidValidity), count: mailbox.exists, uidNext: mailbox.uidNext ?? 1 }
    })
  }
  async fetchHeaders(path: string, uids: number[], signal: AbortSignal): Promise<RemoteHeader[]> {
    if (!uids.length) return []
    if (uids.length > 100) throw new MailError("INVALID_INPUT", "单批邮件数量超限")
    return this.inFolder(path, signal, async () => (await this.client.fetchAll(uids.join(","), { uid: true, envelope: true, flags: true, internalDate: true, size: true, bodyStructure: true, headers: ["References"] }, { uid: true })).map(header))
  }
  async fetchBodyStructure(path: string, uid: number, signal: AbortSignal) {
    return this.inFolder(path, signal, async () => {
      const item = await this.client.fetchOne(String(uid), { bodyStructure: true }, { uid: true })
      if (!item) throw new MailError("STALE_TARGET", "邮件已失效")
      return item.bodyStructure ?? null
    })
  }
  async fetchFlags(path: string, uids: number[], signal: AbortSignal) {
    if (!uids.length) return []
    if (uids.length > 100) throw new MailError("INVALID_INPUT", "单批邮件数量超限")
    return this.inFolder(path, signal, async () => (await this.client.fetchAll(uids.join(","), { uid: true, flags: true }, { uid: true })).map(m => ({ uid: m.uid, flags: [...(m.flags ?? [])] })))
  }
  async searchUids(path: string, query: MailSearchQuery, signal: AbortSignal): Promise<number[]> {
    return this.inFolder(path, signal, async () => {
      const result = await this.client.search(query, { uid: true })
      if (!Array.isArray(result)) throw new MailError("SEARCH_INCOMPLETE", "服务端未返回完整搜索结果")
      if (result.length > 1_000_000) throw new MailError("LIMIT_EXCEEDED", "请缩小邮件查询范围")
      return result
    })
  }
  async fetchPart(path: string, uid: number, part: string | undefined, signal: AbortSignal, maxBytes = MAIL_MAX_ATTACHMENT_BYTES): Promise<Readable> {
    return protocolCall(signal, () => this.client.close(), async () => {
      const lock = await this.client.getMailboxLock(path)
      try {
        const download = await this.client.download(String(uid), part, { uid: true, maxBytes: maxBytes + 1 })
        if (!download.content) {
          const message = await this.client.fetchOne(String(uid), { uid: true }, { uid: true })
          if (!message) throw new MailError("STALE_TARGET", "邮件已失效，请刷新列表")
          throw new MailError("BODY_UNAVAILABLE", "邮件内容暂不可用，请重试")
        }
        const source = download.content
        let released = false
        let timer: ReturnType<typeof setTimeout>
        const release = () => {
          if (released) return
          released = true; clearTimeout(timer); signal.removeEventListener("abort", abort); lock.release()
        }
        const stream = Readable.from((async function* () {
          let size = 0
          try {
            for await (const chunk of source) {
              signal.throwIfAborted()
              size += chunk.length
              if (size > maxBytes) throw new MailError("LIMIT_EXCEEDED", "邮件内容超过读取上限")
              yield chunk
            }
          } finally { source.destroy(); release() }
        })())
        const abort = () => { source.destroy(); stream.destroy(new MailError("CANCELLED", "邮件读取已取消")); this.client.close() }
        timer = setTimeout(() => { source.destroy(); stream.destroy(new MailError("NETWORK_TIMEOUT", "邮件读取超时")); this.client.close() }, 30_000)
        signal.addEventListener("abort", abort, { once: true })
        source.once("error", error => stream.destroy(normalizeProtocolError(error)))
        stream.once("close", () => { source.destroy(); release() }); stream.once("error", release)
        if (signal.aborted) abort()
        return stream
      } catch (error) { lock.release(); throw error }
    })
  }
  async idle(path: string, signal: AbortSignal, onChange = () => undefined): Promise<void> {
    if (this.failure) throw this.failure
    let active = true
    let lock: Awaited<ReturnType<ImapFlow["getMailboxLock"]>> | undefined
    try {
      await protocolCall(signal, () => this.client.close(), async () => {
        const result = await this.client.getMailboxLock(path)
        if (!active) { result.release(); throw new MailError("CANCELLED", "邮箱监听已取消") }
        lock = result
      })
      this.client.on("exists", onChange); this.client.on("flags", onChange); this.client.on("expunge", onChange)
      // IDLE is a persistent subscription. The SDK bounds its handshake and
      // renews it; only acquiring the mailbox uses our request deadline.
      await protocolCall(signal, () => this.client.close(), async () => {
        await this.client.idle()
        if (this.failure) throw this.failure
        if (!this.client.usable) throw new MailError("NETWORK_ERROR", "邮箱监听连接已断开")
      }, null)
    } finally {
      active = false
      this.client.off("exists", onChange); this.client.off("flags", onChange); this.client.off("expunge", onChange)
      lock?.release()
    }
  }
  async copy(path: string, uids: number[], target: string, signal: AbortSignal) {
    const range = uidRange(uids)
    return this.inFolder(path, signal, async () => mapping(await this.client.messageCopy(range, target, { uid: true })))
  }
  async move(path: string, uids: number[], target: string, signal: AbortSignal) {
    if (!this.capabilities.has("MOVE")) throw new MailError("UNSUPPORTED", "服务端不支持原生移动")
    const range = uidRange(uids)
    return this.inFolder(path, signal, async () => mapping(await this.client.messageMove(range, target, { uid: true })))
  }
  async append(path: string, bytes: Buffer, flags: string[], signal: AbortSignal) {
    return protocolCall(signal, () => this.client.close(), async () => {
      let result: Awaited<ReturnType<ImapFlow["append"]>>
      try { result = await this.client.append(path, bytes, flags) } catch (error) {
        const status = (error as { responseStatus?: unknown } | null)?.responseStatus
        if (status === "NO" || status === "BAD") throw new MailError("APPEND_REJECTED", "服务端拒绝保存邮件副本", { definitelyNotSubmitted: true })
        throw error
      }
      return result && result.uid && result.uidValidity ? { uid: result.uid, uidValidity: String(result.uidValidity) } : null
    })
  }
  async storeFlags(path: string, uids: number[], flags: string[], add: boolean, signal: AbortSignal) {
    const range = uidRange(uids)
    await this.inFolder(path, signal, async () => {
      const result = add ? await this.client.messageFlagsAdd(range, flags, { uid: true }) : await this.client.messageFlagsRemove(range, flags, { uid: true })
      if (!result) throw new MailError("UNSUPPORTED", "服务端未确认标记更新")
    })
  }
  async uidExpunge(path: string, uids: number[], signal: AbortSignal) {
    const range = uidRange(uids)
    if (!this.capabilities.has("UIDPLUS")) throw new MailError("UNSUPPORTED", "服务端不支持精确删除")
    await this.inFolder(path, signal, async () => {
      if (!await this.client.messageDelete(range, { uid: true })) throw new MailError("NETWORK_ERROR", "服务端未确认删除")
    })
  }
  async createFolder(path: string, signal: AbortSignal) { await protocolCall(signal, () => this.client.close(), async () => { await this.client.mailboxCreate(path) }) }
  async renameFolder(path: string, target: string, signal: AbortSignal) { await protocolCall(signal, () => this.client.close(), async () => { await this.client.mailboxRename(path, target) }) }
  async deleteFolder(path: string, signal: AbortSignal) { await protocolCall(signal, () => this.client.close(), async () => { await this.client.mailboxDelete(path) }) }
}

export async function connectImap(ctx: MailContext, config: AccountConfig, credential: string, access: MailAccess): Promise<MailImapSession> {
  await access(ctx, "network.connect", `${config.imap.host}:${config.imap.port}`)
  const client = new ImapFlow(imapOptions(config, credential))
  const session = new ImapSession(client)
  try { await protocolCall(ctx.signal, () => client.close(), () => client.connect()); return session } catch (error) { client.close(); throw error }
}
