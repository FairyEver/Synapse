import { Buffer } from "node:buffer"
import { randomUUID, timingSafeEqual } from "node:crypto"

import type { ConversationEntryV1 } from "../../runtime/data-repo"
import type {
  LocalHttpRequest,
  LocalHttpResponse,
  LocalWebSocketConnection,
  LocalWebSocketUpgradeDecision,
  NetworkServiceRegistry,
  ResolvedNetworkBinding,
} from "../../runtime/network"
import { createLocalNetworkHostLifecycle } from "../../runtime/network"
import type { ProjectContainerRegistry } from "../../runtime/project-container"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type { StructuredLogger } from "../../runtime/service-registry"
import {
  AgentRuntimeService,
  AGENT_RUNTIME_SERVICE_ID,
  type AgentEvent,
  type AgentMessage,
} from "../agent-runtime"
import type { ReplyTarget } from "../reply-target"
import type { SideChannelService } from "../side-channel"
import type { SideChannelPreparedAttachment } from "../side-channel"
import {
  normalizeCapabilities,
  parseBridgeBase,
  parseBridgeCardAction,
  parseBridgeMessage,
  parseBridgeRegister,
  sanitizeBridgeMetadata,
  type BridgeCardAction,
  type BridgeMessage,
  type BridgeRegister,
} from "./bridge-protocol"
import type {
  BridgeAdapterStatus,
  BridgeAdapterSummary,
  BridgeProjectSummary,
  BridgeOutboundDispatcher,
} from "./types"

export interface BridgeAdapterServiceDeps {
  readonly projectContainers: ProjectContainerRegistry
  readonly networkRegistry: NetworkServiceRegistry
  readonly sideChannel: SideChannelService
  readonly listProjects: () => Promise<readonly BridgeProjectSummary[]>
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly logger?: StructuredLogger
  readonly token?: string
  readonly preferredPort?: number
  readonly bindAddress?: string
  readonly path?: string
  readonly sessionsPath?: string
  readonly maxBodyBytes?: number
}

interface BridgeAdapterConnection {
  readonly id: string
  readonly platform: string
  readonly capabilities: Set<string>
  readonly metadata?: Record<string, unknown>
  readonly connection: LocalWebSocketConnection
  readonly registeredAt: string
  lastSeenAt: string
  connected: boolean
}

const NETWORK_SERVICE_ID = "bridge.adapter"
const DEFAULT_BRIDGE_PATH = "/bridge/ws"
const DEFAULT_SESSIONS_PATH = "/bridge/sessions"
const DEFAULT_BRIDGE_PORT = 9810
const CAPABILITIES_SNAPSHOT_PROTO = "capabilities_snapshot_v1"

export class BridgeAdapterService implements BridgeOutboundDispatcher {
  private readonly deps: BridgeAdapterServiceDeps
  private readonly token: string
  private readonly path: string
  private readonly sessionsPath: string
  private readonly adapters = new Map<string, BridgeAdapterConnection>()
  private binding: ResolvedNetworkBinding | undefined
  private disposeDispatcher: (() => void) | undefined

  constructor(deps: BridgeAdapterServiceDeps) {
    this.deps = deps
    this.token = deps.token ?? randomUUID()
    this.path = ensurePath(deps.path ?? DEFAULT_BRIDGE_PATH)
    this.sessionsPath = ensurePath(deps.sessionsPath ?? DEFAULT_SESSIONS_PATH)
  }

  async start(): Promise<void> {
    const permission = await this.deps.permissionGuard?.check({
      action: "network.listen",
      actor: { kind: "user" },
      resource: `127.0.0.1:${String(this.deps.preferredPort ?? DEFAULT_BRIDGE_PORT)}${this.path}`,
      context: { serviceId: NETWORK_SERVICE_ID },
    })
    if (permission && !permission.allowed) {
      throw new Error(permission.reason)
    }
    this.disposeDispatcher = this.deps.sideChannel.registerDispatcher("bridge", this)
    this.binding = await this.deps.networkRegistry.register({
      id: NETWORK_SERVICE_ID,
      role: "websocket",
      preferredPort: this.deps.preferredPort ?? DEFAULT_BRIDGE_PORT,
      bindAddress: this.deps.bindAddress ?? "127.0.0.1",
      auth: { kind: "local-token", tokenSecretRef: "bridge.local-token" },
      handler: { handle: () => ({ ok: true }) },
      audit: (event) => {
        this.deps.auditSink?.record({
          action: "network.listen",
          actor: { kind: "system", id: "bridge-adapter" },
          resource: event.serviceId,
          outcome: event.action === "failed" ? "failed" : "allowed",
          metadata: {
            action: event.action,
            role: event.role,
            bindAddress: event.binding?.bindAddress,
            port: event.binding?.port,
            error: event.error,
          },
        })
      },
      start: (binding) => createLocalNetworkHostLifecycle(binding, {
        maxBodyBytes: this.deps.maxBodyBytes,
        acceptWebSocket: (request) => this.acceptWebSocket(request),
        handleWebSocket: (connection) => this.handleWebSocket(connection),
        handleHttp: (request) => this.handleHttp(request),
      }),
    })
  }

  async stop(): Promise<void> {
    this.disposeDispatcher?.()
    this.disposeDispatcher = undefined
    for (const adapter of this.adapters.values()) {
      adapter.connected = false
      adapter.connection.close()
    }
    await this.deps.networkRegistry.unregister(NETWORK_SERVICE_ID)
    this.binding = undefined
  }

  getStatus(): BridgeAdapterStatus {
    return {
      started: Boolean(this.binding),
      bindAddress: this.binding?.bindAddress,
      port: this.binding?.port,
      path: this.path,
      sessionsPath: this.sessionsPath,
      adapters: this.listAdapters(),
    }
  }

  listAdapters(): BridgeAdapterSummary[] {
    return [...this.adapters.values()]
      .map((adapter) => this.summary(adapter))
      .sort((a, b) => a.platform.localeCompare(b.platform))
  }

  async dispatchAgentEvent(target: ReplyTarget, event: AgentEvent): Promise<void> {
    const adapter = this.adapterForTarget(target)
    switch (event.type) {
      case "text":
      case "result":
        await this.sendReply(adapter, target, event.content)
        break
      case "thinking":
        if (adapter.capabilities.has("typing")) {
          adapter.connection.sendJson({
            type: "typing",
            session_key: target.sessionKey,
            reply_ctx: target.replyCtx?.replyCtx,
            active: true,
          })
        }
        break
      case "error":
        adapter.connection.sendJson({
          type: "error",
          session_key: target.sessionKey,
          reply_ctx: target.replyCtx?.replyCtx,
          error: { code: "agent_error", message: event.message },
        })
        break
      case "permissionRequest":
        await this.sendPermission(adapter, target, event)
        break
      case "toolUse":
        await this.sendProgress(adapter, target, `Using ${event.toolName}`)
        break
      case "toolResult":
        await this.sendProgress(adapter, target, event.content ?? event.toolName)
        break
      default: {
        const exhaustive: never = event
        throw new Error(`Unsupported agent event ${(exhaustive as AgentEvent).type}`)
      }
    }
  }

  async dispatchSideChannelSend(
    target: ReplyTarget,
    payload: {
      readonly message?: string
      readonly attachments: readonly SideChannelPreparedAttachment[]
    },
  ): Promise<void> {
    const adapter = this.adapterForTarget(target)
    const hasImages = payload.attachments.some((attachment) => attachment.kind === "image")
    const hasFiles = payload.attachments.some((attachment) => attachment.kind === "file")
    if (hasImages && !adapter.capabilities.has("image")) {
      throw new Error(`bridge adapter "${adapter.platform}" does not support image`)
    }
    if (hasFiles && !adapter.capabilities.has("file")) {
      throw new Error(`bridge adapter "${adapter.platform}" does not support file`)
    }
    adapter.connection.sendJson({
      type: "reply",
      session_key: target.sessionKey,
      reply_ctx: target.replyCtx?.replyCtx,
      content: payload.message ?? "",
      attachments: payload.attachments.map((attachment) => ({
        kind: attachment.kind,
        file_name: attachment.fileName,
        mime_type: attachment.mimeType,
        data: attachment.bytes.toString("base64"),
      })),
    })
  }

  private acceptWebSocket(
    request: Omit<LocalHttpRequest, "body">,
  ): LocalWebSocketUpgradeDecision {
    const url = new URL(request.url, "http://127.0.0.1")
    if (url.pathname !== this.path) {
      return { ok: false, status: 404, message: "not found" }
    }
    if (!this.authenticated(request.headers, url)) {
      this.recordAdapterAudit("denied", "unknown", "auth_failed")
      return { ok: false, status: 401, message: "unauthorized" }
    }
    return { ok: true }
  }

  private handleWebSocket(connection: LocalWebSocketConnection): void {
    let adapter: BridgeAdapterConnection | undefined
    connection.onClose(() => {
      if (adapter) this.disconnectAdapter(adapter)
    })
    connection.onJsonMessage(async (value) => {
      if (!adapter) {
        const result = await this.handleRegister(connection, value)
        adapter = result
        return
      }
      await this.handleAdapterMessage(adapter, value)
    })
  }

  private async handleRegister(
    connection: LocalWebSocketConnection,
    value: unknown,
  ): Promise<BridgeAdapterConnection | undefined> {
    const parsed = parseBridgeRegister(value)
    if (!parsed.ok) {
      connection.sendJson({
        type: "register_ack",
        ok: false,
        error: parsed.error.message,
        code: parsed.error.code,
      })
      connection.close()
      return undefined
    }
    const adapter = this.registerAdapter(connection, parsed.value)
    connection.sendJson({ type: "register_ack", ok: true })
    if (metadataStringListContains(adapter.metadata, "control_plane", CAPABILITIES_SNAPSHOT_PROTO)) {
      connection.sendJson(await this.capabilitiesSnapshot())
    }
    return adapter
  }

  private registerAdapter(
    connection: LocalWebSocketConnection,
    register: BridgeRegister,
  ): BridgeAdapterConnection {
    const now = this.isoNow()
    const adapter: BridgeAdapterConnection = {
      id: randomUUID(),
      platform: register.platform,
      capabilities: normalizeCapabilities(register.capabilities),
      metadata: sanitizeBridgeMetadata(register.metadata),
      connection,
      registeredAt: now,
      lastSeenAt: now,
      connected: true,
    }
    const old = this.adapters.get(register.platform)
    if (old) {
      old.connected = false
      old.connection.close()
      this.recordAdapterAudit("allowed", register.platform, "replaced")
    }
    this.adapters.set(register.platform, adapter)
    this.recordAdapterAudit("allowed", register.platform, "registered")
    return adapter
  }

  private disconnectAdapter(adapter: BridgeAdapterConnection): void {
    const current = this.adapters.get(adapter.platform)
    if (current?.id !== adapter.id) return
    adapter.connected = false
    adapter.lastSeenAt = this.isoNow()
    this.recordAdapterAudit("allowed", adapter.platform, "disconnected")
  }

  private async handleAdapterMessage(
    adapter: BridgeAdapterConnection,
    value: unknown,
  ): Promise<void> {
    adapter.lastSeenAt = this.isoNow()
    const base = parseBridgeBase(value)
    if (!base.ok) {
      this.sendProtocolError(adapter, base.error.code, base.error.message)
      return
    }
    switch (base.type) {
      case "message":
        await this.handleMessage(adapter, value)
        break
      case "card_action":
        await this.handleCardAction(adapter, value)
        break
      case "ping":
        adapter.connection.sendJson({ type: "pong", ts: Date.now() })
        break
      default:
        this.sendProtocolError(adapter, "unknown_type", `unknown message type ${base.type}`)
        break
    }
  }

  async handleMessage(adapter: BridgeAdapterConnection, value: unknown): Promise<void> {
    const parsed = parseBridgeMessage(value)
    if (!parsed.ok) {
      this.sendProtocolError(adapter, parsed.error.code, parsed.error.message)
      return
    }
    const message = parsed.value
    if (message.images.length > 0 || message.files.length > 0) {
      this.sendProtocolError(
        adapter,
        "unsupported_attachment",
        "bridge inbound attachments are not supported in this stage",
        message.session_key,
        message.reply_ctx,
      )
      return
    }
    try {
      const { project, agent } = await this.resolveProjectAgent(message.project)
      const agentMessage = this.toAgentMessage(project.projectId, adapter, message)
      await agent.send(agentMessage)
      this.recordAdapterAudit("allowed", adapter.platform, "message", {
        projectId: project.projectId,
        sessionKey: message.session_key,
      })
    } catch (error) {
      this.sendProtocolError(
        adapter,
        error instanceof BridgeAdapterError ? error.code : "message_failed",
        error instanceof Error ? error.message : String(error),
        message.session_key,
        message.reply_ctx,
      )
    }
  }

  async handleCardAction(adapter: BridgeAdapterConnection, value: unknown): Promise<void> {
    const parsed = parseBridgeCardAction(value)
    if (!parsed.ok) {
      this.sendProtocolError(adapter, parsed.error.code, parsed.error.message)
      return
    }
    const action = parsed.value
    const permission = parsePermissionAction(action.action)
    if (!permission) {
      this.sendProtocolError(
        adapter,
        "unsupported_card_action",
        "card action is not supported",
        action.session_key,
        action.reply_ctx,
      )
      return
    }
    try {
      const { project, agent } = await this.resolveProjectAgent(action.project)
      await agent.respondPermission({
        requestId: permission.requestId,
        behavior: permission.behavior,
        actor: { kind: "user", id: `bridge:${adapter.platform}` },
      })
      this.recordAdapterAudit("allowed", adapter.platform, "card_action", {
        projectId: project.projectId,
        sessionKey: action.session_key,
        requestId: permission.requestId,
        behavior: permission.behavior,
      })
    } catch (error) {
      this.sendProtocolError(
        adapter,
        "permission_response_failed",
        error instanceof Error ? error.message : String(error),
        action.session_key,
        action.reply_ctx,
      )
    }
  }

  private async handleHttp(request: LocalHttpRequest): Promise<LocalHttpResponse> {
    const url = new URL(request.url, "http://127.0.0.1")
    if (!url.pathname.startsWith(this.sessionsPath)) {
      return bridgeResponse(404, false, undefined, "not found")
    }
    if (!this.authenticated(request.headers, url)) {
      return bridgeResponse(401, false, undefined, "unauthorized")
    }
    try {
      return await this.handleSessionsHttp(request, url)
    } catch (error) {
      if (error instanceof BridgeAdapterError) {
        return bridgeResponse(error.status, false, undefined, error.message)
      }
      return bridgeResponse(500, false, undefined, error instanceof Error ? error.message : String(error))
    }
  }

  private async handleSessionsHttp(
    request: LocalHttpRequest,
    url: URL,
  ): Promise<LocalHttpResponse> {
    if (url.pathname === this.sessionsPath) {
      if (request.method === "GET") {
        const sessionKey = url.searchParams.get("session_key") ?? ""
        if (!sessionKey) throw new BridgeAdapterError("missing_session_key", "session_key query parameter is required", 400)
        const { agent } = await this.resolveProjectAgent(url.searchParams.get("project") ?? undefined)
        const sessions = (await agent.listSessions()).filter((session) => session.sessionKey === sessionKey)
        return bridgeResponse(200, true, {
          sessions: sessions.map(sessionForBridge),
          active_session_id: sessions.find((session) => session.active)?.id,
        })
      }
      if (request.method === "POST") {
        const body = parseJsonRecord(request.body)
        const sessionKey = stringField(body, "session_key")
        if (!sessionKey) throw new BridgeAdapterError("missing_session_key", "session_key is required", 400)
        const { agent } = await this.resolveProjectAgent(stringField(body, "project"))
        const created = await agent.createSession({
          sessionKey,
          platform: platformFromSessionKey(sessionKey) ?? "bridge",
          name: stringField(body, "name") ?? sessionKey,
        })
        return bridgeResponse(200, true, {
          id: created.id,
          name: created.name,
          message: "session created",
        })
      }
      throw new BridgeAdapterError("method_not_allowed", "GET or POST only", 405)
    }

    const sub = url.pathname.slice(this.sessionsPath.length + 1)
    if (sub === "switch") {
      if (request.method !== "POST") throw new BridgeAdapterError("method_not_allowed", "POST only", 405)
      const body = parseJsonRecord(request.body)
      const sessionKey = stringField(body, "session_key")
      const target = stringField(body, "target")
      if (!sessionKey || !target) {
        throw new BridgeAdapterError("missing_params", "session_key and target are required", 400)
      }
      const { agent } = await this.resolveProjectAgent(stringField(body, "project"))
      const session = await agent.switchSession(sessionKey, target)
      return bridgeResponse(200, true, {
        message: "session switched",
        active_session_id: session.id,
      })
    }

    const sessionKey = url.searchParams.get("session_key") ?? ""
    if (!sessionKey) throw new BridgeAdapterError("missing_session_key", "session_key query parameter is required", 400)
    const { agent } = await this.resolveProjectAgent(url.searchParams.get("project") ?? undefined)
    if (request.method === "GET") {
      const session = await agent.getSession(sub)
      if (!session || session.sessionKey !== sessionKey) {
        throw new BridgeAdapterError("session_not_found", "session not found", 404)
      }
      return bridgeResponse(200, true, {
        id: session.id,
        name: session.name,
        history: session.history.slice(-50).map((entry) => ({
          role: entry.role,
          content: entry.content,
        })),
      })
    }
    if (request.method === "DELETE") {
      const removed = await agent.deleteSession(sub)
      if (!removed) throw new BridgeAdapterError("session_not_found", "session not found", 404)
      return bridgeResponse(200, true, { message: "session deleted" })
    }
    throw new BridgeAdapterError("method_not_allowed", "GET or DELETE only", 405)
  }

  private async resolveProjectAgent(projectId: string | undefined): Promise<{
    readonly project: BridgeProjectSummary
    readonly agent: AgentRuntimeService
  }> {
    const project = await this.resolveProject(projectId)
    const container = await this.deps.projectContainers.open(project.projectId, {
      name: project.name,
      workspacePath: project.workspacePath,
    })
    return {
      project,
      agent: container.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID),
    }
  }

  private async resolveProject(projectId: string | undefined): Promise<BridgeProjectSummary> {
    const projects = await this.deps.listProjects()
    if (projectId) {
      const project = projects.find((item) => item.projectId === projectId)
      if (!project) throw new BridgeAdapterError("project_not_found", "project was not found", 404)
      return project
    }
    if (projects.length === 1 && projects[0]) return projects[0]
    throw new BridgeAdapterError("project_required", "project is required", 400)
  }

  private toAgentMessage(
    projectId: string,
    adapter: BridgeAdapterConnection,
    message: BridgeMessage,
  ): AgentMessage {
    return {
      projectId,
      sessionKey: message.session_key,
      platform: adapter.platform,
      messageId: message.msg_id,
      userId: message.user_id,
      userName: message.user_name,
      content: message.content,
      replyCtx: {
        kind: "bridge",
        platform: adapter.platform,
        projectId,
        sessionKey: message.session_key,
        replyCtx: message.reply_ctx,
        capabilities: [...adapter.capabilities],
      },
    }
  }

  private adapterForTarget(target: ReplyTarget): BridgeAdapterConnection {
    const platform = target.transport.connectorId ?? stringValue(target.replyCtx?.platform)
    if (!platform) throw new Error("bridge reply target is missing adapter platform")
    const adapter = this.adapters.get(platform)
    if (!adapter?.connected) throw new Error(`bridge adapter "${platform}" is not connected`)
    return adapter
  }

  private async sendReply(
    adapter: BridgeAdapterConnection,
    target: ReplyTarget,
    content: string,
  ): Promise<void> {
    adapter.connection.sendJson({
      type: "reply",
      session_key: target.sessionKey,
      reply_ctx: target.replyCtx?.replyCtx,
      content,
    })
  }

  private async sendProgress(
    adapter: BridgeAdapterConnection,
    target: ReplyTarget,
    content: string,
  ): Promise<void> {
    if (adapter.capabilities.has("update_message")) {
      adapter.connection.sendJson({
        type: "update_message",
        session_key: target.sessionKey,
        reply_ctx: target.replyCtx?.replyCtx,
        content,
      })
      return
    }
    await this.sendReply(adapter, target, content)
  }

  private async sendPermission(
    adapter: BridgeAdapterConnection,
    target: ReplyTarget,
    event: Extract<AgentEvent, { type: "permissionRequest" }>,
  ): Promise<void> {
    if (!adapter.capabilities.has("card")) {
      await this.sendReply(adapter, target, `Permission required: ${event.toolName}`)
      return
    }
    adapter.connection.sendJson({
      type: "card",
      session_key: target.sessionKey,
      reply_ctx: target.replyCtx?.replyCtx,
      card: {
        title: "Permission required",
        body: event.toolName,
        actions: [
          { label: "Allow", action: `perm:${event.requestId}:allow` },
          { label: "Deny", action: `perm:${event.requestId}:deny` },
        ],
      },
    })
  }

  private sendProtocolError(
    adapter: BridgeAdapterConnection,
    code: string,
    message: string,
    sessionKey?: string,
    replyCtx?: unknown,
  ): void {
    adapter.connection.sendJson({
      type: "error",
      session_key: sessionKey,
      reply_ctx: replyCtx,
      error: { code, message },
    })
    this.deps.logger?.warn("Bridge protocol error.", {
      platform: adapter.platform,
      code,
      sessionKey,
    })
  }

  private async capabilitiesSnapshot(): Promise<Record<string, unknown>> {
    const projects = await this.deps.listProjects()
    return {
      type: "capabilities_snapshot",
      v: 1,
      host: { id: "synapse", name: "Synapse" },
      projects: projects.map((project) => ({
        project: project.projectId,
        commands: [],
      })),
    }
  }

  private summary(adapter: BridgeAdapterConnection): BridgeAdapterSummary {
    return {
      platform: adapter.platform,
      capabilities: [...adapter.capabilities].sort(),
      metadata: adapter.metadata,
      connected: adapter.connected,
      registeredAt: adapter.registeredAt,
      lastSeenAt: adapter.lastSeenAt,
    }
  }

  private authenticated(
    headers: Record<string, string | string[] | undefined>,
    url: URL,
  ): boolean {
    const auth = firstHeader(headers.authorization)
    if (auth?.startsWith("Bearer ") && timingSafeEqualText(auth.slice(7), this.token)) {
      return true
    }
    const token = firstHeader(headers["x-bridge-token"]) ?? url.searchParams.get("token")
    return token !== null && token !== undefined && timingSafeEqualText(token, this.token)
  }

  private recordAdapterAudit(
    outcome: "allowed" | "denied" | "failed",
    platform: string,
    action: string,
    metadata: Record<string, unknown> = {},
  ): void {
    this.deps.auditSink?.record({
      action: "network.connect",
      actor: { kind: "connector", id: platform },
      resource: "bridge-adapter",
      outcome,
      metadata: {
        bridgeAction: action,
        platform,
        ...metadata,
      },
    })
  }

  private isoNow(): string {
    return new Date().toISOString()
  }
}

function bridgeResponse(
  status: number,
  ok: boolean,
  data?: unknown,
  error?: string,
): LocalHttpResponse {
  return {
    status,
    body: ok ? { ok, data } : { ok, error },
  }
}

function parseJsonRecord(body: Buffer): Record<string, unknown> {
  try {
    const value = JSON.parse(body.toString("utf8")) as unknown
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("JSON body must be an object")
    }
    return value as Record<string, unknown>
  } catch (error) {
    throw new BridgeAdapterError(
      "invalid_json",
      error instanceof Error ? error.message : String(error),
      400,
    )
  }
}

function sessionForBridge(session: ConversationEntryV1): Record<string, unknown> {
  return {
    id: session.id,
    name: session.name,
    history_count: session.history.length,
  }
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function timingSafeEqualText(a: string, b: string): boolean {
  const aBytes = Buffer.from(a)
  const bBytes = Buffer.from(b)
  if (aBytes.length !== bBytes.length) return false
  return timingSafeEqual(aBytes, bBytes)
}

function ensurePath(value: string): string {
  return value.startsWith("/") ? value : `/${value}`
}

function metadataStringListContains(
  metadata: Record<string, unknown> | undefined,
  key: string,
  want: string,
): boolean {
  const value = metadata?.[key]
  if (!Array.isArray(value)) return false
  return value.some((item) => typeof item === "string" && item.trim() === want)
}

function parsePermissionAction(action: string):
  | { readonly requestId: string; readonly behavior: "allow" | "deny" }
  | null {
  const match = /^perm:([^:]+):(allow|deny)$/.exec(action)
  if (!match?.[1] || !match[2]) return null
  return { requestId: match[1], behavior: match[2] as "allow" | "deny" }
}

function platformFromSessionKey(sessionKey: string): string | undefined {
  const idx = sessionKey.indexOf(":")
  if (idx <= 0) return undefined
  return sessionKey.slice(0, idx)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export class BridgeAdapterError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}
