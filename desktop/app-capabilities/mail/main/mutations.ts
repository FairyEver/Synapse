import { createHash, randomUUID } from "node:crypto"
import type { MailRecord } from "../../../electron/runtime/data-repo/schemas/mail"
import { MAIL_INPUT_SCHEMAS } from "../shared/schema"
import { MailError, type BatchResult, type Folder, type FolderMutation, type MailContext, type MailInputs, type MailResults, type MessageMutation } from "../shared/types"
import { MailRepository } from "./repository"
import { MailAccounts, type StoredAccount } from "./accounts"
import { providerPolicy } from "./protocol/aliyun-policy"
import { normalizeProtocolError, type MailImapSession } from "./protocol/types"
import { resolveMessage, assertRemoteGeneration, type MailChanged, type StoredFolder, type StoredMessage } from "./sync"

type PendingItem = { id: string; status: "prepared" | "submitting" | "succeeded" | "failed" | "unknown"; code?: string; newRevision?: number }
interface MutationRecord extends Record<string, unknown> { kind: "mutation"; action: MessageMutation; digest: string; state: "prepared" | "submitting" | "completed" | "unknown"; items: PendingItem[] }
interface FolderOperation extends Record<string, unknown> { kind: "folder-mutation"; action: FolderMutation; state: "prepared" | "submitting" | "accepted" | "completed" | "unknown"; updates: { id: string; data: StoredFolder; remove?: boolean }[] }
const opaqueOperation = (text: string): string => {
  const hash = createHash("sha256").update(text).digest("hex")
  return `mo_${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
export class MailMutations {
  constructor(private readonly repo: MailRepository, private readonly accounts: MailAccounts, private readonly changed: (event: MailChanged) => void) {}
  private emit(ctx: MailContext, accountId: string, ids: string[], revision = 1) { this.accounts.context.assertCurrent(ctx); this.changed({ ownerId: ctx.ownerId, generation: ctx.generation, accountId, ids, revision }) }
  private async folder(ctx: MailContext, accountId: string, id: string): Promise<MailRecord<StoredFolder>> {
    const row = await this.repo.get<StoredFolder>(ctx, "folders", id)
    if (row.accountId !== accountId) throw new MailError("UNAVAILABLE", "目标文件夹不可用")
    return row
  }
  async listFolders(ctx: MailContext, input: MailInputs["folder.list"]): Promise<MailResults["folder.list"]> {
    await this.repo.get(ctx, "accounts", input.accountId)
    const page = await this.repo.page<StoredFolder>(ctx, "folders", input)
    return { items: page.items.map(r => r.data.folder), nextCursor: page.nextCursor }
  }
  private async allFolders(ctx: MailContext, accountId: string) {
    let cursor: string | undefined
    const rows: MailRecord<StoredFolder>[] = []
    do { const page = await this.repo.page<StoredFolder>(ctx, "folders", { accountId, cursor, limit: 100 }); rows.push(...page.items); cursor = page.nextCursor ?? undefined } while (cursor)
    return rows
  }
  private async role(ctx: MailContext, accountId: string, role: Folder["role"]) {
    const matches = (await this.allFolders(ctx, accountId)).filter(r => r.data.folder.role === role && r.data.folder.selectable)
    if (matches.length !== 1) throw new MailError("ROLE_MAPPING_REQUIRED", "请先配置此邮箱的系统文件夹映射", { role })
    return matches[0]
  }
  private async connected<T>(ctx: MailContext, accountId: string, run: (session: MailImapSession) => Promise<T>): Promise<T> {
    const { config, credential } = await this.accounts.credential(ctx, accountId)
    const session = await this.accounts.protocols.imap(ctx, config, credential)
    try { return await run(session) } finally { await session.close() }
  }
  async execute<K extends FolderMutation | MessageMutation>(ctx: MailContext, action: K, input: MailInputs[K]): Promise<MailResults[K]> {
    if (action.startsWith("folder.")) return await this.folderMutation(ctx, action as FolderMutation, input as MailInputs[FolderMutation]) as MailResults[K]
    return await this.messageMutation(ctx, action as MessageMutation, input as MailInputs[MessageMutation]) as MailResults[K]
  }
  private async folderMutation(ctx: MailContext, action: FolderMutation, input: MailInputs[FolderMutation]): Promise<Folder | { success: boolean }> {
    const params = MAIL_INPUT_SCHEMAS[action].parse(input)
    return this.accounts.exclusive(ctx, params.accountId, async () => {
      await this.recoverAccount(ctx, params.accountId)
      const account = await this.repo.get<StoredAccount>(ctx, "accounts", params.accountId)
      const folders = await this.allFolders(ctx, params.accountId)
      if (action === "folder.update") {
        const update = MAIL_INPUT_SCHEMAS["folder.update"].parse(input)
        if (account.revision !== update.expectedAccountRevision) throw new MailError("VERSION_CONFLICT", "邮箱配置已变化")
        const target = await this.folder(ctx, params.accountId, update.folderId)
        const affected = folders.filter(f => f.id === target.id || update.role !== "none" && f.data.folder.role === update.role)
        const rows = affected.map(f => ({ ...f, revision: f.revision + 1, data: { ...f.data, folder: { ...f.data.folder, role: f.id === target.id ? update.role : "none" as const } } }))
        const accountRow = { ...account, revision: account.revision + 1 }
        const changes = [...rows.map(r => ({ namespace: "app.mail.folders", row: r })), { namespace: "app.mail.accounts", row: accountRow }]
        const result = await this.repo.storage.commitBatch!({ guards: changes.map(c => ({ namespace: c.namespace, id: c.row.id, expected: { ownerId: ctx.ownerId, revision: c.row.revision - 1 } })), operations: changes.map(c => { const { id, ...patch } = c.row; return { kind: "patch" as const, namespace: c.namespace, id, patch } }) })
        this.accounts.context.assertCurrent(ctx)
        if (!result.committed) throw new MailError("VERSION_CONFLICT", "文件夹映射已变化")
        this.emit(ctx, params.accountId, affected.map(f => f.id), accountRow.revision)
        return (await this.folder(ctx, params.accountId, target.id)).data.folder
      }
      const source = "folderId" in params ? await this.folder(ctx, params.accountId, params.folderId) : null
      if (source && (source.data.folder.role !== "none" || source.data.folder.path.toUpperCase() === "INBOX")) throw new MailError("SYSTEM_FOLDER", "系统文件夹不能改名或删除")
      const parent = "parentFolderId" in params && params.parentFolderId ? await this.folder(ctx, params.accountId, params.parentFolderId) : null
      const delimiter = source?.data.delimiter ?? parent?.data.delimiter ?? folders.find(f => f.data.delimiter)?.data.delimiter ?? "/"
      let targetPath = ""
      if ("name" in params) {
        if (params.name.includes(delimiter)) throw new MailError("INVALID_INPUT", "文件夹名称不能包含层级分隔符")
        const prefix = action === "folder.rename" && source ? source.data.folder.path.slice(0, source.data.folder.path.lastIndexOf(delimiter) + 1) : parent ? `${parent.data.folder.path}${delimiter}` : ""
        targetPath = `${prefix}${params.name}`
        if (folders.some(f => f.data.folder.path === targetPath)) throw new MailError("FOLDER_EXISTS", "文件夹已存在")
      }
      if (action === "folder.delete" && source && folders.some(f => f.id !== source.id && f.data.folder.path.startsWith(`${source.data.folder.path}${delimiter}`))) throw new MailError("FOLDER_NOT_EMPTY", "文件夹仍有子文件夹")
      const id = source?.id ?? `mf_${randomUUID()}`
      const updates: FolderOperation["updates"] = action === "folder.create" && "name" in params
        ? [{ id, data: { folder: { id, accountId: params.accountId, path: targetPath, name: params.name, role: "none", uidValidity: null, serverCount: 0, metadataComplete: false, selectable: true }, delimiter, flags: [] } }]
        : action === "folder.delete" && source ? [{ id, data: source.data, remove: true }]
        : source ? folders.filter(f => f.id === id || f.data.folder.path.startsWith(`${source.data.folder.path}${delimiter}`)).map(f => ({ id: f.id, data: { ...f.data, folder: { ...f.data.folder, path: `${targetPath}${f.data.folder.path.slice(source.data.folder.path.length)}`, ...(f.id === id && "name" in params ? { name: params.name } : {}) } } })) : []
      const operationId = `mo_${randomUUID()}`
      let operation = await this.repo.save<FolderOperation>(ctx, "operations", operationId, params.accountId, { kind: "folder-mutation", action, state: "prepared", updates }, 0)
      try {
        await this.connected(ctx, params.accountId, async session => {
          const selected = source?.data.folder.selectable ? await session.select(source.data.folder.path, ctx.signal) : null
          if (source?.data.folder.uidValidity && selected) await assertRemoteGeneration(this.repo, ctx, source.id, source.data.folder.uidValidity, selected.uidValidity)
          if (action === "folder.delete" && source) {
            const mailbox = selected ?? await session.select(source.data.folder.path, ctx.signal)
            const uids = await session.searchUids(source.data.folder.path, { all: true }, ctx.signal)
            if (mailbox.count !== 0 || uids.length) throw new MailError("FOLDER_NOT_EMPTY", "文件夹中仍有邮件")
          }
          operation = await this.repo.save(ctx, "operations", operationId, params.accountId, { ...operation.data, state: "submitting" }, operation.revision)
          if (action === "folder.create") await session.createFolder(targetPath, ctx.signal)
          else if (action === "folder.rename" && source) await session.renameFolder(source.data.folder.path, targetPath, ctx.signal)
          else if (source) await session.deleteFolder(source.data.folder.path, ctx.signal)
          operation = await this.repo.save(ctx, "operations", operationId, params.accountId, { ...operation.data, state: "accepted" }, operation.revision)
        })
        await this.applyFolderOperation(ctx, operationId)
      } catch (error) {
        if (operation.data.state === "submitting") await this.repo.save(ctx, "operations", operationId, params.accountId, { ...operation.data, state: "unknown" }, operation.revision)
        if (operation.data.state === "submitting") throw new MailError("OPERATION_UNKNOWN", "文件夹操作结果待核验，请先刷新文件夹")
        throw error
      }
      return action === "folder.delete" ? { success: true } : (await this.folder(ctx, params.accountId, id)).data.folder
    })
  }
  private async applyFolderOperation(ctx: MailContext, operationId: string) {
    const operation = await this.repo.get<FolderOperation>(ctx, "operations", operationId)
    if (operation.data.kind !== "folder-mutation" || operation.data.state !== "accepted") return
    for (const update of operation.data.updates) {
      const row = await this.repo.find<StoredFolder>(ctx, "folders", update.id)
      if (update.remove) {
        let cursor: string | undefined
        do {
          const page = await this.repo.page<StoredMessage>(ctx, "messages", { accountId: operation.accountId, cursor, limit: 100 })
          for (const message of page.items) if (message.data.summary.locator.folderId === update.id && !message.data.summary.stale) await this.repo.save(ctx, "messages", message.id, operation.accountId, { ...message.data, summary: { ...message.data.summary, stale: true } }, message.revision, message.sortKey)
          cursor = page.nextCursor ?? undefined
        } while (cursor)
        if (row) await this.repo.remove(ctx, "folders", row.id, row.revision)
      } else {
        const data = row ? { ...row.data, folder: { ...row.data.folder, path: update.data.folder.path, name: update.data.folder.name } } : update.data
        await this.repo.save(ctx, "folders", update.id, operation.accountId, data, row?.revision ?? 0, update.data.folder.path)
      }
    }
    await this.repo.save(ctx, "operations", operationId, operation.accountId, { ...operation.data, state: "completed" }, operation.revision)
    this.emit(ctx, operation.accountId, operation.data.updates.map(u => u.id))
  }
  async recover(ctx: MailContext): Promise<void> {
    let cursor: string | undefined
    do {
      const page = await this.repo.page<FolderOperation>(ctx, "operations", { cursor, limit: 100 })
      for (const row of page.items) if (row.data.kind === "folder-mutation" && row.data.state === "accepted") await this.accounts.exclusive(ctx, row.accountId, () => this.applyFolderOperation(ctx, row.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  }
  private async recoverAccount(ctx: MailContext, accountId: string): Promise<void> {
    let cursor: string | undefined
    do {
      const page = await this.repo.page<FolderOperation>(ctx, "operations", { accountId, cursor, limit: 100 })
      for (const row of page.items) if (row.data.kind === "folder-mutation" && row.data.state === "accepted") await this.applyFolderOperation(ctx, row.id)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  }
  private async messageMutation(ctx: MailContext, action: MessageMutation, input: MailInputs[MessageMutation]): Promise<BatchResult> {
    const params = MAIL_INPUT_SCHEMAS[action].parse(input)
    return this.accounts.exclusive(ctx, params.accountId, async () => {
      await this.recoverAccount(ctx, params.accountId)
      const account = await this.accounts.get(ctx, params.accountId)
      const digest = createHash("sha256").update(JSON.stringify([action, params])).digest("hex")
      const operationId = "clientRequestId" in params ? opaqueOperation(`${ctx.ownerId}:${params.accountId}:${params.clientRequestId}`) : `mo_${randomUUID()}`
      let operation = await this.repo.find<MutationRecord>(ctx, "operations", operationId)
      if (operation && (operation.data.kind !== "mutation" || operation.data.digest !== digest)) throw new MailError("IDEMPOTENCY_CONFLICT", "此请求标识已用于其他邮件操作")
      if (operation?.data.items.some(item => item.status === "submitting")) operation = await this.repo.save(ctx, "operations", operationId, params.accountId, { ...operation.data, state: "unknown" as const, items: operation.data.items.map(item => item.status === "submitting" ? { ...item, status: "unknown" as const, code: "INTERRUPTED" } : item) }, operation.revision)
      const result = (): BatchResult => ({ items: operation!.data.items.map(item => ({ ...item, status: item.status === "prepared" || item.status === "submitting" ? "unknown" : item.status })) })
      if (operation && operation.data.items.every(i => i.status !== "prepared")) return result()
      for (const id of params.messageIds) {
        const message = await this.repo.get<StoredMessage>(ctx, "messages", id)
        if (message.accountId !== params.accountId) throw new MailError("UNAVAILABLE", "邮件不属于此账号")
      }
      const target = "targetFolderId" in params && params.targetFolderId ? await this.folder(ctx, params.accountId, params.targetFolderId)
        : action === "message.delete" && "permanent" in params && !params.permanent ? await this.role(ctx, params.accountId, "trash")
        : action === "message.restore" ? await this.role(ctx, params.accountId, "inbox") : null
      if (target && !target.data.folder.selectable) throw new MailError("UNAVAILABLE", "目标文件夹不可选择")
      if (!operation) operation = await this.repo.save<MutationRecord>(ctx, "operations", operationId, params.accountId, { kind: "mutation", action, digest, state: "prepared", items: params.messageIds.map(id => ({ id, status: "prepared" })) }, 0)
      let session: MailImapSession | undefined, connectionError: unknown
      try {
        for (let index = 0; index < operation.data.items.length; index++) {
          if (operation.data.items[index].status !== "prepared") continue
          const id = operation.data.items[index].id
          let submitted = false
          const saveItem = async (item: PendingItem) => {
            const items = [...operation!.data.items]; items[index] = item
            const state: MutationRecord["state"] = items.some(i => i.status === "submitting") ? "submitting" : items.some(i => i.status === "unknown") ? "unknown" : items.some(i => i.status === "prepared") ? "prepared" : "completed"
            operation = await this.repo.save(ctx, "operations", operationId, params.accountId, { ...operation!.data, state, items }, operation!.revision)
          }
          try {
            const message = await resolveMessage(this.repo, ctx, id), source = await this.folder(ctx, params.accountId, message.data.summary.locator.folderId)
            if (!session) {
              if (connectionError) throw connectionError
              try { const { config, credential } = await this.accounts.credential(ctx, params.accountId); session = await this.accounts.protocols.imap(ctx, config, credential) } catch (error) { connectionError = error; throw error }
            }
            const mailbox = await session.select(source.data.folder.path, ctx.signal)
            await assertRemoteGeneration(this.repo, ctx, source.id, message.data.summary.locator.uidValidity, mailbox.uidValidity)
            const uid = message.data.summary.locator.uid
            if (action === "message.delete" && "permanent" in params && params.permanent && !session.capabilities.has("UIDPLUS")) throw new MailError("UNSUPPORTED", "服务端不支持精确永久删除")
            if (target?.id === source.id) { await saveItem({ id, status: "succeeded", newRevision: message.revision }); continue }
            if (action !== "message.update" && target && !providerPolicy(account).copyActsAsMove && !session.capabilities.has("MOVE")) throw new MailError("UNSUPPORTED", "服务端不支持安全移动")
            await saveItem({ id, status: "submitting" }); submitted = true
            let saved = message
            if (action === "message.update" && "patch" in params) {
              if (params.patch.read !== undefined) await session.storeFlags(source.data.folder.path, [uid], ["\\Seen"], params.patch.read, ctx.signal)
              if (params.patch.star !== undefined) await session.storeFlags(source.data.folder.path, [uid], ["\\Flagged"], params.patch.star, ctx.signal)
              const flags = (await session.fetchFlags(source.data.folder.path, [uid], ctx.signal)).find(f => f.uid === uid)
              if (!flags || params.patch.read !== undefined && flags.flags.includes("\\Seen") !== params.patch.read || params.patch.star !== undefined && flags.flags.includes("\\Flagged") !== params.patch.star) throw new MailError("FLAGS_UNCONFIRMED", "服务端未确认邮件标记")
              saved = await this.repo.save(ctx, "messages", id, params.accountId, { ...message.data, summary: { ...message.data.summary, read: flags.flags.includes("\\Seen"), star: flags.flags.includes("\\Flagged") } }, message.revision, message.sortKey)
            } else if (action === "message.delete" && "permanent" in params && params.permanent) {
              await session.storeFlags(source.data.folder.path, [uid], ["\\Deleted"], true, ctx.signal)
              await session.uidExpunge(source.data.folder.path, [uid], ctx.signal)
              if ((await session.searchUids(source.data.folder.path, { uid: String(uid) }, ctx.signal)).includes(uid)) throw new MailError("DELETE_UNCONFIRMED", "服务端删除结果待核验")
              saved = await this.repo.save(ctx, "messages", id, params.accountId, { ...message.data, summary: { ...message.data.summary, stale: true } }, message.revision, message.sortKey)
            } else if (target) {
              const mapping = providerPolicy(account).copyActsAsMove ? await session.copy(source.data.folder.path, [uid], target.data.folder.path, ctx.signal) : await session.move(source.data.folder.path, [uid], target.data.folder.path, ctx.signal)
              const targetUid = mapping?.uids.get(uid)
              if (!mapping || !targetUid) throw new MailError("MOVE_UNCONFIRMED", "移动位置尚未核验")
              const sourceCheck = await session.select(source.data.folder.path, ctx.signal)
              await assertRemoteGeneration(this.repo, ctx, source.id, message.data.summary.locator.uidValidity, sourceCheck.uidValidity)
              if ((await session.searchUids(source.data.folder.path, { uid: String(uid) }, ctx.signal)).includes(uid)) throw new MailError("MOVE_UNCONFIRMED", "来源邮件状态尚未核验")
              const targetCheck = await session.select(target.data.folder.path, ctx.signal)
              await assertRemoteGeneration(this.repo, ctx, target.id, mapping.uidValidity, targetCheck.uidValidity)
              if (!(await session.fetchHeaders(target.data.folder.path, [targetUid], ctx.signal)).some(h => h.uid === targetUid)) throw new MailError("MOVE_UNCONFIRMED", "目标邮件状态尚未核验")
              const locator = { ...message.data.summary.locator, folderId: target.id, uidValidity: mapping.uidValidity, uid: targetUid }
              const targetRow = await this.folder(ctx, params.accountId, target.id)
              if (targetRow.data.folder.uidValidity !== mapping.uidValidity) await this.repo.save(ctx, "folders", target.id, params.accountId, { ...targetRow.data, folder: { ...targetRow.data.folder, uidValidity: mapping.uidValidity, metadataComplete: false } }, targetRow.revision, targetRow.sortKey)
              saved = await this.repo.save(ctx, "messages", id, params.accountId, { ...message.data, originalFolderId: source.id, summary: { ...message.data.summary, locator } }, message.revision, message.sortKey)
            } else throw new MailError("ROLE_MAPPING_REQUIRED", "请先配置目标文件夹")
            await saveItem({ id, status: "succeeded", newRevision: saved.revision }); this.emit(ctx, params.accountId, [id], saved.revision)
          } catch (error) {
            if (ctx.signal.aborted) throw error
            const code = normalizeProtocolError(error).code
            await saveItem({ id, status: submitted ? "unknown" : "failed", code })
          }
        }
        return result()
      } finally { await session?.close() }
    })
  }
}
