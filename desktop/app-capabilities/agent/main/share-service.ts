import { createHash, randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import type { z } from "zod"
import type { ConversationEntryV1, DataNamespace, ManagedAssetStore } from "../../../electron/runtime/data-repo"
import type { ShareImageRecord } from "../../../electron/runtime/data-repo/schemas/agent-share"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import type { DispatchContext } from "../../../synapse-capabilities/shared/types"
import type { GeneratedUiSnapshot, GeneratedUiTarget } from "../../../src/types/agent-generated-ui"
import { AGENT_SHARE_MAX_PNG_BYTES, type AgentShareImageResult } from "../../../src/types/agent-share"
import { validateSharePng } from "../../../electron/services/agent-share-image-service"
import { redactSensitiveText } from "../../../electron/services/agent-runtime/redaction"
import { shareRenderErrors, shareGenerateInputSchema, shareMessagesInputSchema, shareOutputInputSchema, type ShareImageSource, type ShareImageSummary, type ShareRenderRequest, type ShareRenderResponse } from "../shared/share"
import { buildShareSnapshot, selectShareMessages } from "./share-selection"

type Context = { projectId: string; conversationId: string; turnId: string; rendererId: number; beforeIndex: number; prefixHash: string; expiresAt: number }
type Pending = { request: ShareRenderRequest; context: Context; actor: ActorIdentity; resources: AbortController; resolve: (png: string) => void; reject: (error: Error) => void }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const summary = (row: ShareImageRecord): ShareImageSummary => ({
  shareImageRef: row.id, projectId: row.projectId, conversationId: row.conversationId, turnId: row.turnId,
  sourceHistoryIndex: row.sourceHistoryIndex, sourceTimestamp: row.sourceTimestamp, fileName: row.fileName, width: row.width, height: row.height,
  byteSize: row.byteSize, sha256: row.sha256, createdAt: row.createdAt, messageRefs: row.messageRefs, contentSummary: `${row.messageRefs.length} 条原文消息`,
})

/** PNG jobs and assets belong to the host; model arguments never supply pixels or source text. */
export class AgentShareService {
  private readonly lifetime = new AbortController()
  private activeRows = new Set<string>()
  private contexts = new Map<string, Context>()
  private pending = new Map<string, Pending>()
  private running = new Map<string, { hash: string; promise: Promise<ShareImageSummary> }>()
  private unsubscribe: () => void
  constructor(private readonly deps: {
    conversations: DataNamespace<ConversationEntryV1>; images: DataNamespace<ShareImageRecord>; assets: ManagedAssetStore
    emit: (request: ShareRenderRequest, rendererId: number) => void
    cancel?: (requestId: string, rendererId: number) => void
    changed: (projectId: string, conversationId: string) => void
    projectExists?: (projectId: string) => Promise<boolean>
    rendererAlive: (rendererId: number) => boolean
    check: PermissionGuard["check"]; audit: AuditSink["record"]
    output: (input: { pngBase64: string; action: "copy" | "save"; fileName: string; outputPath?: string; rendererId: number; actor: ActorIdentity; signal?: AbortSignal }) => Promise<AgentShareImageResult>
    readUiState: (target: GeneratedUiTarget) => Promise<GeneratedUiSnapshot>
    logger: { warn(message: string, metadata: Record<string, unknown>): void }
  }) {
    this.unsubscribe = deps.conversations.onChange(change => {
      if (change.kind === "remove" && change.id) void this.removeConversation(change.id).catch(cause => this.warn(cause))
    })
  }

  async createContext(input: Omit<Context, "beforeIndex" | "prefixHash" | "expiresAt">): Promise<string> {
    const conversation = await this.conversation(input.projectId, input.conversationId)
    if (conversation.platform !== "local-renderer" || conversation.claudeCodeContinuation) throw new Error("仅支持当前桌面对话。")
    let beforeIndex = conversation.history.length - 1
    while (beforeIndex >= 0 && conversation.history[beforeIndex]?.role !== "user") beforeIndex--
    if (beforeIndex < 0) throw new Error("当前消息不存在。")
    for (const [key, value] of this.contexts) if (value.expiresAt < Date.now() || value.conversationId === input.conversationId) this.contexts.delete(key)
    if (this.contexts.size >= 128) throw new Error("分享上下文过多，请稍后重试。")
    const ref = randomUUID()
    this.contexts.set(ref, { ...input, beforeIndex, prefixHash: hash(conversation.history.slice(0, beforeIndex)), expiresAt: Date.now() + 60 * 60_000 })
    return ref
  }

  async messages(raw: unknown, caller: DispatchContext) {
    const input = shareMessagesInputSchema.parse(raw), context = await this.context(input.shareContextRef, caller)
    const snapshot = await this.snapshot(context)
    const matches = input.query ? snapshot.filter(m => m.content.toLocaleLowerCase().includes(input.query!.toLocaleLowerCase())) : snapshot
    const page = matches.slice(input.offset, input.offset + input.limit)
    return { messages: page.map(m => ({ messageRef: m.messageRef, turnRef: m.turnRef, role: m.role, timestamp: m.timestamp,
      excerpt: redactSensitiveText(m.content).slice(0, 512), excerptTruncated: m.content.length > 512, hasImages: Boolean(m.attachments?.some(a => a.kind === "image")) })),
      images: (await this.rows({ projectId: context.projectId, conversationId: context.conversationId, state: "ready" }, 20, 0, "desc")).map(summary),
      total: matches.length, historyComplete: true, complete: input.offset + page.length >= matches.length, nextOffset: input.offset + page.length < matches.length ? input.offset + page.length : null }
  }

  async generate(raw: unknown, caller: DispatchContext): Promise<ShareImageSummary> {
    caller = this.withLifetime(caller)
    const input = shareGenerateInputSchema.parse(raw), context = await this.context(input.shareContextRef, caller)
    caller.abortSignal?.throwIfAborted()
    const requestKey = hash([caller.clientId, caller.actor, context.conversationId, input.idempotencyKey])
    const requestHash = hash(input)
    const running = this.running.get(requestKey)
    if (running) {
      if (running.hash !== requestHash) throw new Error("同一请求标识不能更改分享内容。")
      return running.promise
    }
    if (this.running.size >= 8) throw new Error("正在生成的图片过多，请稍后重试。")
    // Register the promise before the first storage await so concurrent retries join it.
    const promise = (async () => {
      const previous = (await this.rows({ requestKey }, 1))[0]
      if (previous) {
        if (previous.requestHash !== requestHash) throw new Error("同一请求标识不能更改分享内容。")
        if (previous.state === "ready") { await this.image(previous.id); return summary(previous) }
        throw new Error("此前生成未完成，请使用新的请求标识重试。")
      }
      return this.renderAndStore(input, context, caller, requestKey, requestHash)
    })()
    this.running.set(requestKey, { hash: requestHash, promise })
    try { return await promise } finally { this.running.delete(requestKey) }
  }

  private async renderAndStore(input: z.infer<typeof shareGenerateInputSchema>, context: Context, caller: DispatchContext, requestKey: string, requestHash: string) {
    const messages = selectShareMessages(await this.snapshot(context), input.selection, input.messageRefs)
    const generatedUi: Record<string, GeneratedUiSnapshot> = {}
    for (const message of messages) for (const block of message.metadata?.generatedUi?.blocks ?? []) {
      generatedUi[block.id] = { ...await this.deps.readUiState({ projectId: context.projectId, conversationId: context.conversationId, blockId: block.id }), readOnly: true }
    }
    caller.abortSignal?.throwIfAborted()
    if (![...this.contexts.values()].includes(context)) throw new Error("分享上下文已失效。")
    const request: ShareRenderRequest = { requestId: randomUUID(), nonce: randomUUID(), projectId: context.projectId, conversationId: context.conversationId, messages, settings: input.settings, generatedUi }
    const png = await this.render(request, context, caller)
    caller.abortSignal?.throwIfAborted()
    const { bytes, width, height } = validateSharePng(png)
    const conversation = await this.conversation(context.projectId, context.conversationId)
    const id = randomUUID(), assetKey = randomUUID()
    const row: ShareImageRecord = { id, schemaVersion: 1, projectId: context.projectId, conversationId: context.conversationId, turnId: context.turnId,
      sourceHistoryIndex: context.beforeIndex, sourceTimestamp: conversation.history[context.beforeIndex]!.timestamp, rendererId: context.rendererId, state: "staged", assetKey, fileName: `Synapse 对话 ${input.settings.scale}x.png`,
      width, height, byteSize: bytes.length, sha256: "", createdAt: new Date().toISOString(), messageRefs: messages.map(m => m.messageRef), settings: input.settings, requestKey, requestHash }
    this.activeRows.add(id)
    try {
      await this.deps.images.upsert(row)
      const asset = await this.deps.assets.put(Readable.from([bytes]), AGENT_SHARE_MAX_PNG_BYTES, caller.abortSignal, assetKey)
      caller.abortSignal?.throwIfAborted()
      await this.conversation(context.projectId, context.conversationId)
      const ready = { ...row, state: "ready" as const, sha256: asset.sha256 }
      await this.deps.images.upsert(ready)
      caller.abortSignal?.throwIfAborted()
      await this.conversation(context.projectId, context.conversationId)
      this.deps.changed(context.projectId, context.conversationId)
      return summary(ready)
    } catch (error) { await this.removeRow(row); throw error }
    finally { this.activeRows.delete(id) }
  }

  private render(request: ShareRenderRequest, context: Context, caller: DispatchContext): Promise<string> {
    if (!this.deps.rendererAlive(context.rendererId)) throw new Error("来源窗口已关闭，请重新打开对话。")
    return new Promise((resolve, reject) => {
      const resources = new AbortController()
      let finished = false
      const finish = (error?: Error, png?: string) => {
        if (finished) return
        finished = true
        resources.abort()
        clearTimeout(timer); clearInterval(watch); caller.abortSignal?.removeEventListener("abort", abort)
        this.pending.delete(request.requestId)
        if (error) { this.deps.cancel?.(request.requestId, context.rendererId); reject(error) } else resolve(png!)
      }
      const abort = () => finish(new Error("图片生成已取消。"))
      const timer = setTimeout(() => finish(new Error("图片生成超时，请重试。")), 60_000)
      const watch = setInterval(() => { if (!this.deps.rendererAlive(context.rendererId)) finish(new Error("来源窗口已关闭。")) }, 500)
      this.pending.set(request.requestId, { request, context, actor: caller.actor!, resources, resolve: png => finish(undefined, png), reject: error => finish(error) })
      caller.abortSignal?.addEventListener("abort", abort, { once: true })
      if (caller.abortSignal?.aborted) abort()
      else { try { this.deps.emit(request, context.rendererId) } catch (error) { finish(error instanceof Error ? error : new Error("渲染请求失败。")) } }
    })
  }

  renderActor(rendererId: number, input: Pick<ShareRenderResponse, "requestId" | "nonce" | "projectId" | "conversationId">): ActorIdentity {
    const pending = this.pending.get(input.requestId)
    if (!pending || pending.context.rendererId !== rendererId || pending.request.nonce !== input.nonce || pending.context.projectId !== input.projectId || pending.context.conversationId !== input.conversationId) throw new Error("图片生成请求已失效或来源不匹配。")
    return pending.actor
  }

  renderSignal(rendererId: number, input: Pick<ShareRenderResponse, "requestId" | "nonce" | "projectId" | "conversationId">): AbortSignal {
    this.renderActor(rendererId, input)
    return this.pending.get(input.requestId)!.resources.signal
  }

  async complete(rendererId: number, input: ShareRenderResponse): Promise<void> {
    this.renderActor(rendererId, input)
    const pending = this.pending.get(input.requestId)!
    if (input.error) pending.reject(new Error(shareRenderErrors[input.error as keyof typeof shareRenderErrors] ?? shareRenderErrors.render_failed))
    else if (input.pngBase64) {
      try { validateSharePng(input.pngBase64); pending.resolve(input.pngBase64) }
      catch (error) { pending.reject(error instanceof Error ? error : new Error("图片无效。")); throw error }
    } else throw new Error("缺少生成结果。")
  }

  async list(projectId: string, conversationId: string, offset = 0): Promise<ShareImageSummary[]> {
    await this.conversation(projectId, conversationId)
    return (await this.rows({ projectId, conversationId, state: "ready" }, 100, offset)).map(summary)
  }

  async assertImageTarget(ref: string, projectId: string, conversationId: string) {
    const row = await this.image(ref)
    if (row.projectId !== projectId || row.conversationId !== conversationId) throw new Error("图片不属于当前对话。")
  }

  async readImage(ref: string, caller: DispatchContext): Promise<ShareImageSource> {
    const row = await this.image(ref)
    await this.authorize(row.conversationId, caller)
    const bytes = await this.deps.assets.read(row.assetKey, AGENT_SHARE_MAX_PNG_BYTES)
    if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw new Error("分享图片内容已变化，请重新生成。")
    caller.abortSignal?.throwIfAborted()
    return { bytes, fileName: row.fileName, mimeType: "image/png" }
  }

  async output(raw: unknown, caller: DispatchContext, rendererId?: number): Promise<AgentShareImageResult> {
    caller = this.withLifetime(caller)
    const input = shareOutputInputSchema.parse(raw), row = await this.image(input.shareImageRef)
    const source = await this.readImage(input.shareImageRef, caller)
    caller.abortSignal?.throwIfAborted()
    return this.deps.output({ pngBase64: source.bytes.toString("base64"), action: input.action, fileName: row.fileName, outputPath: input.outputPath, rendererId: rendererId ?? row.rendererId, actor: caller.actor!, signal: caller.abortSignal })
  }

  async removeConversation(conversationId: string) {
    for (const pending of this.pending.values()) if (pending.context.conversationId === conversationId) pending.reject(new Error("对话已删除。"))
    for (const [ref, context] of this.contexts) if (context.conversationId === conversationId) this.contexts.delete(ref)
    while (true) {
      const rows = await this.rows({ conversationId }, 100)
      if (!rows.length) break
      for (const row of rows) await this.removeRow(row)
    }
  }
  async removeProject(projectId: string) {
    for (const pending of this.pending.values()) if (pending.context.projectId === projectId) pending.reject(new Error("项目已移除。"))
    for (const [ref, context] of this.contexts) if (context.projectId === projectId) this.contexts.delete(ref)
    while (true) {
      const batch = await this.rows({ projectId }, 100)
      if (!batch.length) break
      for (const row of batch) await this.removeRow(row)
    }
  }
  async recover() {
    // Bounded startup batches; never blocks creating the main window.
    for (const state of ["staged", "delete-pending"] as const) {
      let batch: ShareImageRecord[]
      do { batch = await this.rows({ state }, 100); for (const row of batch) if (!this.activeRows.has(row.id)) await this.removeRow(row) } while (batch.length === 100)
    }
    // A crash between deleting a conversation and its asset cleanup leaves a ready row.
    let offset = 0
    while (true) {
      const batch = await this.rows({ state: "ready" }, 100, offset)
      for (const row of batch) {
        const source = await this.deps.conversations.get(row.conversationId)
        if (!source || source.projectId !== row.projectId || (this.deps.projectExists && !await this.deps.projectExists(row.projectId))) await this.removeRow(row)
        else offset++
      }
      if (batch.length < 100) break
    }
  }
  dispose() { this.lifetime.abort(); this.unsubscribe(); for (const pending of this.pending.values()) pending.reject(new Error("应用正在退出。")); this.contexts.clear() }
  private async removeRow(row: ShareImageRecord) {
    await this.deps.images.upsert({ ...row, state: "delete-pending" })
    await this.deps.assets.remove(row.assetKey); await this.deps.assets.remove(row.assetKey, true); await this.deps.images.remove(row.id)
  }
  private async image(ref: string) {
    const row = await this.deps.images.get(ref)
    if (!row || row.state !== "ready") throw new Error("分享图片不存在或已删除。")
    await this.conversation(row.projectId, row.conversationId)
    return row
  }
  private async conversation(projectId: string, conversationId: string) {
    if (this.deps.projectExists && !await this.deps.projectExists(projectId)) throw new Error("来源项目已移除。")
    const conversation = await this.deps.conversations.get(conversationId)
    if (!conversation || conversation.projectId !== projectId) throw new Error("对话不存在或来源不匹配。")
    return conversation
  }
  private async context(ref: string, caller: DispatchContext) {
    const context = this.contexts.get(ref)
    if (!context || context.expiresAt < Date.now()) throw new Error("分享上下文已失效，请从当前用户消息重新发起。")
    await this.authorize(context.conversationId, caller)
    return context
  }
  private async snapshot(context: Context) {
    const conversation = await this.conversation(context.projectId, context.conversationId)
    if (hash(conversation.history.slice(0, context.beforeIndex)) !== context.prefixHash) throw new Error("分享历史已变化，请重新发起。")
    return buildShareSnapshot(conversation, context.beforeIndex)
  }
  private withLifetime(caller: DispatchContext): DispatchContext {
    return { ...caller, abortSignal: caller.abortSignal ? AbortSignal.any([caller.abortSignal, this.lifetime.signal]) : this.lifetime.signal }
  }
  private async authorize(conversationId: string, caller: DispatchContext) {
    this.lifetime.signal.throwIfAborted()
    if (!caller.actor) throw new Error("缺少调用者身份。")
    caller.abortSignal?.throwIfAborted()
    const request = { action: "agent.conversation.read" as const, actor: caller.actor, resource: `agent:conversation:${conversationId}`, context: { source: "agent.share" } }
    const permission = await this.deps.check(request)
    this.deps.audit({ ...request, outcome: permission.allowed ? "allowed" : "denied", metadata: { source: "agent.share" } })
    if (!permission.allowed) throw new Error("没有权限分享此对话。")
  }
  private async rows(filter: Partial<Record<keyof ShareImageRecord, string>>, limit: number, offset = 0, order: "asc" | "desc" = "asc") {
    if (this.deps.images.listWindow) return (await this.deps.images.listWindow({ filter, limit, offset, orderBy: "createdAt", order })).map(item => item.value)
    return (await this.deps.images.list(filter as Partial<ShareImageRecord>)).sort((a, b) => (order === "asc" ? 1 : -1) * a.createdAt.localeCompare(b.createdAt)).slice(offset, offset + limit)
  }
  private warn(cause: unknown) { this.deps.logger.warn("Agent share cleanup failed.", { errorName: cause instanceof Error ? cause.name : typeof cause }) }
}
