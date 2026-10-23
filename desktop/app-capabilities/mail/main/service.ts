import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import type { DataRepository } from "../../../electron/runtime/data-repo"
import type { ManagedAssetStore } from "../../../electron/runtime/data-repo/assets"
import type { PermissionGuard, AuditSink } from "../../../electron/runtime/security"
import type { IpcInvocationSender } from "../../../electron/runtime/ipc/types"
import { MAIL_INPUT_SCHEMAS, MAIL_RESULT_SCHEMAS } from "../shared/schema"
import { parseMailReference } from "../shared/manifest"
import { MAIL_MAX_IMAGE_BYTES } from "../shared/limits"
import { configureAccountSchema, type ConfigureAccount, type MailChanged, type MailOpenRequest, type MailScope } from "../shared/private-schema"
import { MailError, type MailAction, type MailContext, type MailInputs, type MailResults } from "../shared/types"
import { MailContextProvider, createMailAccess } from "./context"
import { MailRepository } from "./repository"
import { MailAssets } from "./assets"
import { MailAccounts, type StoredAccount } from "./accounts"
import { MailSync, resolveMessage } from "./sync"
import { MailContent } from "./mime"
import { MailSearch } from "./search"
import { MailMutations } from "./mutations"
import { MailDrafts } from "./drafts"
import { MailDraftSync } from "./draft-sync"
import { MailSend } from "./send"
import { MailSendOperations } from "./send-reconcile"
import { MailBodyResources, rasterMime } from "./body-resources"
import { MailNotifications } from "./notifications"
import type { MailNotificationAdapter } from "./notification-adapter"
import { createMailProtocols } from "./protocol"
import type { MailProtocols } from "./protocol/types"

export interface MailServiceDeps {
  storage: DataRepository; files: ManagedAssetStore; permissionGuard: PermissionGuard; auditSink: AuditSink
  resolveOwner(): string | null
  events(change: MailChanged, rendererIds: number[]): void
  open(request: MailOpenRequest): Promise<void>
  notifications: MailNotificationAdapter; notificationsSupported?: () => boolean
  diagnostic(code: string, accountId: string): void
  protocols?: MailProtocols
  pickFiles?: () => Promise<string[]>
  saveFile?: (name: string) => Promise<string | null>
}
export class MailService {
  private identityChanging = false
  private enabled = false
  private initialization: Promise<void> = Promise.resolve()
  private initializedGeneration = -1
  private notificationError: string | null = null
  private accountScopes = new Map<string, AbortController>()
  private subscribers = new Map<number, { ownerId: string; generation: number; detach(): void }>()
  private readonly contexts: MailContextProvider
  private readonly repo: MailRepository
  private readonly assets: MailAssets
  private readonly accounts: MailAccounts
  private readonly content: MailContent
  private readonly sync: MailSync
  private readonly search: MailSearch
  private readonly mutations: MailMutations
  private readonly drafts: MailDrafts
  private readonly draftSync: MailDraftSync
  private readonly send: MailSend
  private readonly operations: MailSendOperations
  private readonly resources: MailBodyResources
  private readonly notifications: MailNotifications
  constructor(private readonly deps: MailServiceDeps) {
    this.contexts = new MailContextProvider(() => this.identityChanging ? null : deps.resolveOwner())
    const access = createMailAccess(this.contexts, deps.permissionGuard, deps.auditSink)
    this.repo = new MailRepository(deps.storage, ctx => this.contexts.assertCurrent(ctx))
    this.assets = new MailAssets(this.repo, deps.files, access)
    this.accounts = new MailAccounts(this.repo, this.contexts, deps.protocols ?? createMailProtocols(access), access, {
      start: (ctx, id) => this.sync.startAccount(this.scoped({ ...ctx, actor: "sync" }, id), id),
      stop: async (ctx, id) => { this.accountScopes.get(id)?.abort(); this.accountScopes.delete(id); await this.sync.stopAccount(id); await this.draftSync.stopAccount(ctx, id) },
      remove: (ctx, id) => this.assets.removeAccount(ctx, id),
      open: (ctx, accountId) => this.open(ctx, { accountId, configure: true }),
    })
    this.content = new MailContent(this.repo, this.accounts, this.assets, access)
    this.resources = new MailBodyResources(this.repo, this.assets, access)
    this.search = new MailSearch(this.repo, (ctx, id, budget) => this.content.readSearchText(ctx, id, budget))
    this.mutations = new MailMutations(this.repo, this.accounts, event => this.changed(event))
    this.drafts = new MailDrafts(this.repo, this.accounts, this.assets, this.content, {
      schedule: (ctx, id) => this.draftSync.enqueue({ ...ctx, actor: "sync" }, id),
      changed: (ctx, id) => { void this.repo.get(ctx, "drafts", id).then(row => this.changed({ ownerId: ctx.ownerId, generation: ctx.generation, accountId: row.accountId, ids: [id], revision: row.revision })).catch(() => deps.diagnostic("DRAFT_EVENT_EXPIRED", id)) },
      removeRemote: (ctx, draft) => this.draftSync.removeRemote(ctx, draft),
    })
    this.draftSync = new MailDraftSync(this.repo, this.accounts, this.assets, this.drafts, deps.diagnostic)
    this.operations = new MailSendOperations(this.repo, this.accounts, this.assets, this.drafts)
    this.send = new MailSend(this.repo, this.accounts, this.assets, this.drafts, this.operations)
    this.notifications = new MailNotifications(this.repo, this.accounts, deps.notifications, (ctx, target) => this.open(ctx, { accountId: target.accountId, messageId: target.messageId ?? undefined }), (code, id) => { this.notificationError = code; deps.diagnostic(code, id) }, access)
    this.sync = new MailSync(this.repo, this.accounts, { changed: e => this.changed(e), inbox: (ctx, delta) => this.notifications.accept(ctx, delta), error: deps.diagnostic, draft: async (ctx, id) => { await this.drafts.indexRemote(ctx, id) } })
  }
  context(actor: MailContext["actor"]): MailContext { return this.contexts.current(actor) }
  scope(sender?: IpcInvocationSender): MailScope {
    const current = this.contexts.status()
    if (sender && !sender.isDestroyed() && current.ownerId) {
      this.subscribers.get(sender.id)?.detach()
      const detach = sender.onDestroyed(() => this.subscribers.delete(sender.id))
      this.subscribers.set(sender.id, { ownerId: current.ownerId, generation: current.generation, detach })
    }
    return { ...current, notificationsSupported: this.deps.notificationsSupported?.() ?? false, notificationError: this.notificationError }
  }
  private changed(event: MailChanged): void {
    const current = this.contexts.status()
    if (event.ownerId !== current.ownerId || event.generation !== current.generation) return
    const ids = [...this.subscribers].filter(([, scope]) => scope.ownerId === event.ownerId && scope.generation === event.generation).map(([id]) => id)
    this.deps.events(event, ids)
  }
  private scoped(ctx: MailContext, accountId: string): MailContext {
    let controller = this.accountScopes.get(accountId)
    if (!controller || controller.signal.aborted) { controller = new AbortController(); this.accountScopes.set(accountId, controller) }
    return { ...ctx, signal: AbortSignal.any([ctx.signal, controller.signal]) }
  }
  private async actionContext(ctx: MailContext, input: Record<string, unknown>): Promise<MailContext> {
    let accountId = typeof input.accountId === "string" ? input.accountId : undefined
    for (const [key, entity] of [["draftId", "drafts"], ["messageId", "messages"], ["assetId", "assets"], ["operationId", "operations"], ["previewId", "previews"], ["jobId", "sync-state"]] as const) {
      if (!accountId && typeof input[key] === "string") {
        let row = await this.repo.find(ctx, entity, input[key])
        if (!row && key === "jobId") row = await this.repo.find(ctx, "search-tasks", input[key])
        accountId = row?.accountId
      }
    }
    if (!accountId && typeof input.reference === "string") accountId = (await resolveMessage(this.repo, ctx, parseMailReference(input.reference)!)).accountId
    return accountId ? this.scoped(ctx, accountId) : ctx
  }
  private async open(ctx: MailContext, target: { accountId?: string; messageId?: string; configure?: boolean }): Promise<void> {
    if (target.accountId) await this.accounts.get(ctx, target.accountId)
    if (target.messageId) await resolveMessage(this.repo, ctx, target.messageId)
    this.contexts.assertCurrent(ctx)
    await this.deps.open({ requestId: randomUUID(), ownerId: ctx.ownerId, generation: ctx.generation, ...target })
    this.contexts.assertCurrent(ctx)
  }
  async openMessage(messageId: string): Promise<void> { const ctx = this.context("ui"), row = await resolveMessage(this.repo, ctx, messageId); await this.open(ctx, { accountId: row.accountId, messageId }) }
  async configure(input: ConfigureAccount) { const ctx = this.context("ui"); const result = await this.accounts.configure(ctx, configureAccountSchema.parse(input)); this.changed({ ownerId: ctx.ownerId, generation: ctx.generation, accountId: result.id, ids: [result.id], revision: result.revision }); return result }
  async beforeIdentityChange(): Promise<void> {
    this.identityChanging = true; this.contexts.refreshIdentity(); this.resources.clear()
    for (const c of this.accountScopes.values()) c.abort()
    this.accountScopes.clear()
    for (const s of this.subscribers.values()) s.detach()
    this.subscribers.clear()
    await Promise.all([this.sync.dispose(), this.search.dispose(), this.draftSync.dispose()])
  }
  identityChanged(): void { this.identityChanging = false; this.contexts.refreshIdentity(); if (this.enabled) this.initializeBackground() }
  private initializeBackground(): void {
    const state = this.contexts.status()
    if (!state.ownerId || state.generation === this.initializedGeneration) return
    this.initializedGeneration = state.generation
    const ctx = this.context("sync")
    this.initialization = this.initialization.catch(() => undefined).then(async () => {
      this.contexts.assertCurrent(ctx)
      await this.accounts.recover(ctx); await this.mutations.recover(ctx); await this.operations.recover(ctx); await this.drafts.recover(ctx)
      await this.accounts.recoverCredentials(ctx); await this.assets.recover(ctx); await this.send.expire(ctx)
      await this.sync.resume(ctx)
      let cursor: string | undefined
      do { const page = await this.repo.page(ctx, "drafts", { cursor, limit: 100 }); for (const row of page.items) if (row.data.state === "editing" && row.data.syncState !== "synced") this.draftSync.enqueue(ctx, row.id); cursor = page.nextCursor ?? undefined } while (cursor)
    }).catch(() => { if (!ctx.signal.aborted) this.deps.diagnostic("MAIL_RECOVERY_FAILED", "mail") })
  }
  startBackground(): void { this.enabled = true; this.initializeBackground() }
  async suspend(): Promise<void> { await Promise.all([this.sync.suspend(), this.draftSync.dispose()]) }
  async resume(): Promise<void> { if (this.contexts.status().ownerId) await this.sync.resume(this.context("sync")) }
  async dispose(): Promise<void> { this.enabled = false; await this.beforeIdentityChange(); await this.initialization; this.notifications.dispose(); this.contexts.dispose() }
  async imageGrant(messageId: string, assetId: string) { const ctx = await this.actionContext(this.context("ui"), { messageId }); await this.content.ensureAsset(ctx, assetId, MAIL_MAX_IMAGE_BYTES); return { token: await this.resources.issue(ctx, messageId, assetId) } }
  async imageRead(messageId: string, token: string) { return this.resources.read(this.context("ui"), messageId, token) }
  async imageRemote(messageId: string, url: string, allowed: boolean) { const ctx = await this.actionContext(this.context("ui"), { messageId }); return this.resources.remote(ctx, messageId, url, allowed) }
  async importImage(accountId: string, base64: string) {
    const ctx = this.scoped(this.context("ui"), accountId), bytes = Buffer.from(base64, "base64"), mime = rasterMime(bytes)
    if (!mime || bytes.length > MAIL_MAX_IMAGE_BYTES) throw new MailError("IMAGE_BLOCKED", "图片格式或大小不受支持")
    return this.assets.put(ctx, Readable.from([bytes]), { accountId, name: `image.${mime.split("/")[1]}`, mime }, MAIL_MAX_IMAGE_BYTES)
  }
  async pickAttachments(accountId: string) {
    const ctx = this.scoped(this.context("ui"), accountId); await this.accounts.get(ctx, accountId)
    const paths = await this.deps.pickFiles?.() ?? [], results = []
    for (const filePath of paths) results.push(await this.execute(ctx, "attachment.import_local", { accountId, filePath }))
    return results
  }
  async saveAttachment(assetId: string) {
    const ctx = await this.actionContext(this.context("ui"), { assetId }), asset = await this.assets.info(ctx, assetId)
    const outputPath = await this.deps.saveFile?.(asset.name)
    return outputPath ? this.execute(ctx, "attachment.download_file", { assetId, outputPath }) : null
  }
  async execute<K extends MailAction>(context: MailContext, action: K, input: MailInputs[K]): Promise<MailResults[K]> {
    this.contexts.assertCurrent(context)
    const parsed = MAIL_INPUT_SCHEMAS[action].parse(input)
    const ctx = action.startsWith("account.") ? context : await this.actionContext(context, parsed)
    let result: unknown
    switch (action) {
      case "account.list": result = await this.accounts.execute(ctx, "account.list", parsed as MailInputs["account.list"]); break
      case "account.get": result = await this.accounts.execute(ctx, "account.get", parsed as MailInputs["account.get"]); break
      case "account.open": result = await this.accounts.execute(ctx, "account.open", parsed as MailInputs["account.open"]); break
      case "account.update": result = await this.accounts.execute(ctx, "account.update", parsed as MailInputs["account.update"]); break
      case "account.inspect": result = await this.accounts.execute(ctx, "account.inspect", parsed as MailInputs["account.inspect"]); break
      case "account.pause": result = await this.accounts.execute(ctx, "account.pause", parsed as MailInputs["account.pause"]); break
      case "account.resume": result = await this.accounts.execute(ctx, "account.resume", parsed as MailInputs["account.resume"]); break
      case "account.delete": result = await this.accounts.execute(ctx, "account.delete", parsed as MailInputs["account.delete"]); break
      case "folder.list": result = await this.mutations.listFolders(ctx, parsed as MailInputs["folder.list"]); break
      case "folder.create": result = await this.mutations.execute(ctx, "folder.create", parsed as MailInputs["folder.create"]); break
      case "folder.rename": result = await this.mutations.execute(ctx, "folder.rename", parsed as MailInputs["folder.rename"]); break
      case "folder.delete": result = await this.mutations.execute(ctx, "folder.delete", parsed as MailInputs["folder.delete"]); break
      case "folder.update": result = await this.mutations.execute(ctx, "folder.update", parsed as MailInputs["folder.update"]); break
      case "sync.start": result = await this.sync.start(ctx, parsed as MailInputs["sync.start"]); break
      case "sync.get": result = await this.sync.get(ctx, parsed as MailInputs["sync.get"]); break
      case "sync.cancel": result = await this.sync.cancel(ctx, parsed as MailInputs["sync.cancel"]); break
      case "message.list": result = await this.search.listMessages(ctx, parsed as MailInputs["message.list"]); break
      case "message.get": result = await this.content.detail(ctx, "messageId" in parsed ? parsed.messageId! : parseMailReference((parsed as MailInputs["message.get"] & { reference: string }).reference)!); break
      case "message.count": result = await this.search.countMessages(ctx, parsed as MailInputs["message.count"]); break
      case "message.update": result = await this.mutations.execute(ctx, "message.update", parsed as MailInputs["message.update"]); break
      case "message.move": result = await this.mutations.execute(ctx, "message.move", parsed as MailInputs["message.move"]); break
      case "message.delete": result = await this.mutations.execute(ctx, "message.delete", parsed as MailInputs["message.delete"]); break
      case "message.restore": result = await this.mutations.execute(ctx, "message.restore", parsed as MailInputs["message.restore"]); break
      case "search.start": result = await this.search.execute(ctx, "search.start", parsed as MailInputs["search.start"]); break
      case "search.get": result = await this.search.execute(ctx, "search.get", parsed as MailInputs["search.get"]); break
      case "search.resume": result = await this.search.execute(ctx, "search.resume", parsed as MailInputs["search.resume"]); break
      case "search.cancel": result = await this.search.execute(ctx, "search.cancel", parsed as MailInputs["search.cancel"]); break
      case "draft.list": result = await this.drafts.execute(ctx, "draft.list", parsed as MailInputs["draft.list"]); break
      case "draft.get": result = await this.drafts.execute(ctx, "draft.get", parsed as MailInputs["draft.get"]); break
      case "draft.create": result = await this.drafts.execute(ctx, "draft.create", parsed as MailInputs["draft.create"]); break
      case "draft.update": result = await this.drafts.execute(ctx, "draft.update", parsed as MailInputs["draft.update"]); break
      case "draft.delete": result = await this.drafts.execute(ctx, "draft.delete", parsed as MailInputs["draft.delete"]); break
      case "attachment.import_local": result = await this.content.executeAttachment(ctx, "attachment.import_local", parsed as MailInputs["attachment.import_local"]); break
      case "attachment.list": result = await this.content.executeAttachment(ctx, "attachment.list", parsed as MailInputs["attachment.list"]); break
      case "attachment.get": result = await this.content.executeAttachment(ctx, "attachment.get", parsed as MailInputs["attachment.get"]); break
      case "attachment.download_file": result = await this.content.executeAttachment(ctx, "attachment.download_file", parsed as MailInputs["attachment.download_file"]); break
      case "attachment.delete": result = await this.content.executeAttachment(ctx, "attachment.delete", parsed as MailInputs["attachment.delete"]); break
      case "message.extract_to_file": result = await this.content.executeAttachment(ctx, "message.extract_to_file", parsed as MailInputs["message.extract_to_file"]); break
      case "body.read_chunk": result = await this.content.readChunk(ctx, parsed as MailInputs["body.read_chunk"]); break
      case "send.preview": result = await this.send.preview(ctx, parsed as MailInputs["send.preview"]); break
      case "message.send": result = await this.send.submit(ctx, parsed as MailInputs["message.send"]); break
      case "operation.list": result = await this.operations.list(ctx, parsed as MailInputs["operation.list"]); break
      case "operation.get": result = await this.operations.get(ctx, parsed as MailInputs["operation.get"]); break
      case "cache.clear": result = await this.assets.clearCache(ctx, (parsed as MailInputs["cache.clear"]).accountId); break
    }
    this.contexts.assertCurrent(ctx)
    const output = MAIL_RESULT_SCHEMAS[action].parse(result) as MailResults[K]
    if (!action.endsWith(".get") && !action.endsWith(".list") && "accountId" in parsed && typeof parsed.accountId === "string") this.changed({ ownerId: ctx.ownerId, generation: ctx.generation, accountId: parsed.accountId, ids: [], revision: 1 })
    return output
  }
}
