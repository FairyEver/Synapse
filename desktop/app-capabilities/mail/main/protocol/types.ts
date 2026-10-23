import type { Readable } from "node:stream"
import type { MessageStructureObject, SearchObject } from "imapflow"
import { MailError, type AccountConfig, type Address, type MailContext } from "../../shared/types"

export type MailBodyStructure = MessageStructureObject
export type MailSearchQuery = SearchObject
export interface RemoteFolder { path: string; name: string; delimiter: string; flags: string[]; specialUse: string | null; count: number | null }
export interface MailboxState { uidValidity: string; count: number; uidNext: number }
export interface RemoteHeader {
  uid: number; subject: string; from: Address[]; to: Address[]; cc: Address[]; replyTo: Address[];
  date: string | null; size: number; flags: string[]; messageId: string | null; references: string[]; structure: MailBodyStructure | null
}
export interface UidMapping { uidValidity: string; uids: Map<number, number> }
export interface AppendReceipt { uidValidity: string; uid: number }
export interface MailImapSession {
  readonly capabilities: ReadonlySet<string>
  listFolders(signal: AbortSignal): Promise<RemoteFolder[]>
  select(path: string, signal: AbortSignal): Promise<MailboxState>
  fetchHeaders(path: string, uids: number[], signal: AbortSignal): Promise<RemoteHeader[]>
  fetchBodyStructure(path: string, uid: number, signal: AbortSignal): Promise<MailBodyStructure | null>
  fetchPart(path: string, uid: number, part: string | undefined, signal: AbortSignal, maxBytes?: number): Promise<Readable>
  fetchFlags(path: string, uids: number[], signal: AbortSignal): Promise<{ uid: number; flags: string[] }[]>
  searchUids(path: string, query: MailSearchQuery, signal: AbortSignal): Promise<number[]>
  idle(path: string, signal: AbortSignal, onChange?: () => void): Promise<void>
  copy(path: string, uids: number[], target: string, signal: AbortSignal): Promise<UidMapping | null>
  move(path: string, uids: number[], target: string, signal: AbortSignal): Promise<UidMapping | null>
  append(path: string, bytes: Buffer, flags: string[], signal: AbortSignal): Promise<AppendReceipt | null>
  storeFlags(path: string, uids: number[], flags: string[], add: boolean, signal: AbortSignal): Promise<void>
  uidExpunge(path: string, uids: number[], signal: AbortSignal): Promise<void>
  createFolder(path: string, signal: AbortSignal): Promise<void>
  renameFolder(path: string, target: string, signal: AbortSignal): Promise<void>
  deleteFolder(path: string, signal: AbortSignal): Promise<void>
  close(): Promise<void>
}
export interface SmtpSnapshot { raw: Buffer; from: string; to: string[]; messageId: string }
export interface SmtpReceipt { accepted: string[]; rejected: string[]; messageId: string }
export interface MailSmtp {
  verify(signal: AbortSignal): Promise<void>
  submit(snapshot: SmtpSnapshot, signal: AbortSignal): Promise<SmtpReceipt>
  close(): void
}
export interface MailProtocols {
  imap(ctx: MailContext, config: AccountConfig, credential: string): Promise<MailImapSession>
  smtp(ctx: MailContext, config: AccountConfig, credential: string): Promise<MailSmtp>
}
export function normalizeProtocolError(error: unknown): MailError {
  if (error instanceof MailError) return error
  const details = error as { code?: unknown; authenticationFailed?: unknown; responseCode?: unknown } | null
  return details?.authenticationFailed === true || details?.code === "EAUTH" || details?.responseCode === 535
    ? new MailError("AUTH_FAILED", "邮箱认证失败，请检查密码或客户端授权码")
    : new MailError("NETWORK_ERROR", "邮箱连接失败，请稍后重试")
}
export async function protocolCall<T>(signal: AbortSignal, cancel: () => void, operation: () => Promise<T>, milliseconds = 30_000): Promise<T> {
  signal.throwIfAborted()
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    return await Promise.race([operation(), new Promise<never>((_resolve, reject) => {
      abort = () => { cancel(); reject(new MailError("CANCELLED", "邮箱操作已取消")) }
      signal.addEventListener("abort", abort, { once: true })
      if (signal.aborted) abort()
      timer = setTimeout(() => { cancel(); reject(new MailError("NETWORK_TIMEOUT", "邮箱操作超时，请先核验结果")) }, milliseconds)
    })])
  } catch (error) { throw normalizeProtocolError(error) } finally {
    if (timer) clearTimeout(timer)
    if (abort) signal.removeEventListener("abort", abort)
  }
}
