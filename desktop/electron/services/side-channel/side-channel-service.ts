import { randomUUID, timingSafeEqual } from "node:crypto"

import type { DataRepository, OutboxEntryV1, OutboxPayloadV1 } from "../../runtime/data-repo"
import type {
  LocalHttpRequest,
  LocalHttpResponse,
  NetworkServiceRegistry,
  ResolvedNetworkBinding,
} from "../../runtime/network"
import { createLocalNetworkHostLifecycle } from "../../runtime/network"
import type { ProjectContainerRegistry } from "../../runtime/project-container"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type { StructuredLogger } from "../../runtime/service-registry"
import type { AgentEvent } from "../agent-runtime"
import type { ProcessIsolationResolver } from "../execution-isolation"
import { ReplyOutboxService, type ReplyTarget } from "../reply-target"
import { AttachmentPolicyError, prepareSideChannelAttachments } from "./attachment-policy"
import type {
  ReplyTargetRuntime,
  ReplyTransportDispatcher,
  SideChannelRelaySendHandler,
  SideChannelRelaySendRequest,
  SideChannelSendRequest,
  SideChannelSendResult,
  SideChannelStatus,
} from "./types"

export interface SideChannelProjectSummary {
  readonly projectId: string
  readonly name?: string
  readonly workspacePath?: string
  readonly managedKnowledgeBase?: boolean
}

export interface SideChannelServiceDeps {
  readonly projectContainers: ProjectContainerRegistry
  readonly networkRegistry: NetworkServiceRegistry
  readonly dataRepository: DataRepository
  readonly listProjects: () => Promise<readonly SideChannelProjectSummary[]>
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly executionIsolation?: ProcessIsolationResolver
  readonly logger?: StructuredLogger
  readonly token?: string
  readonly preferredPort?: number
  readonly bindAddress?: string
  readonly sendPath?: string
  readonly relaySendPath?: string
  readonly maxBodyBytes?: number
  readonly rateLimitPerMinute?: number
}

const DEFAULT_SEND_PATH = "/send"
const DEFAULT_RELAY_SEND_PATH = "/relay/send"
const DEFAULT_RATE_LIMIT_PER_MINUTE = 120
const NETWORK_SERVICE_ID = "side-channel.send"

export class SideChannelService implements ReplyTargetRuntime {
  private readonly deps: SideChannelServiceDeps
  private readonly token: string
  private readonly sendPath: string
  private readonly relaySendPath: string
  private readonly targets = new Map<string, ReplyTarget>()
  private readonly dispatchers = new Map<string, ReplyTransportDispatcher>()
  private readonly rateLimiter = new Map<string, number[]>()
  private readonly outboxes = new Map<string, ReplyOutboxService>()
  private relaySendHandler: SideChannelRelaySendHandler | undefined
  private binding: ResolvedNetworkBinding | undefined

  constructor(deps: SideChannelServiceDeps) {
    this.deps = deps
    this.token = deps.token ?? randomUUID()
    this.sendPath = deps.sendPath ?? DEFAULT_SEND_PATH
    this.relaySendPath = deps.relaySendPath ?? DEFAULT_RELAY_SEND_PATH
  }

  async start(): Promise<void> {
    const bindAddress = this.deps.bindAddress ?? "127.0.0.1"
    const resource = `${bindAddress}:${String(this.deps.preferredPort ?? 0)}${this.sendPath}`
    const permission = await this.deps.permissionGuard?.check({
      action: "network.listen",
      actor: { kind: "user" },
      resource,
      context: { serviceId: NETWORK_SERVICE_ID },
    })
    if (permission && !permission.allowed) {
      this.deps.auditSink?.record({
        action: "network.listen",
        actor: { kind: "user" },
        resource,
        outcome: "denied",
        metadata: {
          serviceId: NETWORK_SERVICE_ID,
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      throw new Error(permission.reason)
    }
    this.binding = await this.deps.networkRegistry.register({
      id: NETWORK_SERVICE_ID,
      role: "http",
      preferredPort: this.deps.preferredPort,
      bindAddress: this.deps.bindAddress ?? "127.0.0.1",
      auth: { kind: "local-token", tokenSecretRef: "side-channel.local-token" },
      handler: { handle: () => ({ ok: true }) },
      audit: (event) => {
        this.deps.auditSink?.record({
          action: "network.listen",
          actor: { kind: "system", id: "side-channel" },
          resource: event.serviceId,
          outcome: event.action === "failed" ? "failed" : "allowed",
          metadata: {
            action: event.action,
            role: event.role,
            bindAddress: event.binding?.bindAddress,
            port: event.binding?.port,
            ...networkAuditErrorDiagnostic(event.error),
          },
        })
      },
      start: (binding) => createLocalNetworkHostLifecycle(binding, {
        maxBodyBytes: this.deps.maxBodyBytes,
        handleHttp: (request) => this.handleHttp(request),
      }),
    })
  }

  async stop(): Promise<void> {
    await this.deps.networkRegistry.unregister(NETWORK_SERVICE_ID)
    this.binding = undefined
  }

  getStatus(): SideChannelStatus {
    return {
      enabled: Boolean(this.binding),
      bindAddress: this.binding?.bindAddress,
      port: this.binding?.port,
      sendPath: this.sendPath,
      relaySendPath: this.relaySendPath,
    }
  }

  getAgentEnv(projectId: string, sessionKey: string): Record<string, string> | undefined {
    if (!this.binding) return undefined
    const baseUrl = `http://${this.binding.bindAddress}:${String(this.binding.port)}`
    const url = `${baseUrl}${this.sendPath}`
    return {
      CC_PROJECT: projectId,
      CC_SESSION_KEY: sessionKey,
      SYNAPSE_PROJECT: projectId,
      SYNAPSE_SESSION_KEY: sessionKey,
      SYNAPSE_SIDE_CHANNEL_BASE_URL: baseUrl,
      SYNAPSE_SIDE_CHANNEL_URL: url,
      SYNAPSE_RELAY_SEND_URL: `${baseUrl}${this.relaySendPath}`,
      SYNAPSE_SIDE_CHANNEL_TOKEN: this.token,
    }
  }

  rememberReplyTarget(target: ReplyTarget): void {
    this.targets.set(targetKey(target.projectId, target.sessionKey), target)
  }

  getReplyTarget(projectId: string, sessionKey: string): ReplyTarget | undefined {
    return this.targets.get(targetKey(projectId, sessionKey))
  }

  registerDispatcher(kind: string, dispatcher: ReplyTransportDispatcher): () => void {
    this.dispatchers.set(kind, dispatcher)
    return () => {
      if (this.dispatchers.get(kind) === dispatcher) {
        this.dispatchers.delete(kind)
      }
    }
  }

  registerRelaySendHandler(handler: SideChannelRelaySendHandler): () => void {
    this.relaySendHandler = handler
    return () => {
      if (this.relaySendHandler === handler) {
        this.relaySendHandler = undefined
      }
    }
  }

  canDispatchAgentEvent(target: ReplyTarget): boolean {
    return this.dispatchers.has(target.transport.kind)
  }

  dispatchAgentEvent(target: ReplyTarget, event: AgentEvent): Promise<void> {
    const dispatcher = this.dispatchers.get(target.transport.kind)
    const conversationId = event.conversationId ?? target.conversationId
    if (!dispatcher) {
      return Promise.resolve()
    }
    return dispatcher.dispatchAgentEvent(target, event).catch((error) => {
      this.deps.logger?.warn("Reply target dispatch failed.", {
        projectId: target.projectId,
        hasSessionKey: Boolean(target.sessionKey),
        transportKind: target.transport.kind,
        connectorId: target.transport.connectorId,
        eventType: event.type,
        conversationId,
        sdkSessionId: event.sdkSessionId,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: errorMessage(error).length,
      })
    })
  }

  async send(request: SideChannelSendRequest): Promise<SideChannelSendResult> {
    const project = await this.resolveProject(request.projectId ?? request.project)
    const sessionKey = (request.sessionKey ?? request.session_key ?? "").trim()
    if (!sessionKey) {
      throw new SideChannelError("missing_session_key", "sessionKey is required", 400)
    }
    const message = request.message?.trim()
    if (!message && !request.images?.length && !request.files?.length) {
      throw new SideChannelError("empty_payload", "message or attachment is required", 400)
    }
    const target = this.targets.get(targetKey(project.projectId, sessionKey))
    if (!target) {
      throw new SideChannelError("session_not_found", "session reply target was not found", 404)
    }
    const attachments = await prepareSideChannelAttachments({
      images: request.images,
      files: request.files,
      workspacePath: project.workspacePath,
      permissionGuard: this.deps.permissionGuard,
    })
    const payload = outboxPayload(message, attachments)
    const dispatcher = this.dispatchers.get(target.transport.kind)
    const outbox = this.outbox(project.projectId)
    if (isMutedTarget(target)) {
      const outboxRecorded = await this.recordOutbox(outbox, { target, payload, status: "sent" })
      this.recordSendAudit("allowed", target, attachments.length)
      return {
        ok: true,
        projectId: project.projectId,
        sessionKey,
        outboxRecorded,
      }
    }

    try {
      if (!dispatcher) {
        throw new SideChannelError("dispatch_unavailable", "dispatcher is unavailable", 502)
      }
      await dispatcher.dispatchSideChannelSend(target, { message, attachments })
      const outboxRecorded = await this.recordOutbox(outbox, { target, payload, status: "sent" })
      this.recordSendAudit("allowed", target, attachments.length)
      return {
        ok: true,
        projectId: project.projectId,
        sessionKey,
        outboxRecorded,
      }
    } catch (error) {
      const diagnostic = errorDiagnostic(error)
      await this.recordOutbox(outbox, { target, payload, status: "failed", lastError: outboxLastError(error) })
      this.recordSendAudit("failed", target, attachments.length, diagnostic)
      this.deps.logger?.warn("Side-channel send dispatch failed.", {
        projectId: target.projectId,
        hasSessionKey: Boolean(target.sessionKey),
        transportKind: target.transport.kind,
        connectorId: target.transport.connectorId,
        attachmentCount: attachments.length,
        ...diagnostic,
      })
      throw new SideChannelError("dispatch_failed", "dispatch failed", 502)
    }
  }

  private async recordOutbox(
    outbox: ReplyOutboxService,
    input: Parameters<ReplyOutboxService["record"]>[0],
  ): Promise<boolean> {
    try {
      await outbox.record(input)
      return true
    } catch {
      return false
    }
  }

  private async handleHttp(request: LocalHttpRequest): Promise<LocalHttpResponse> {
    const url = new URL(request.url, "http://127.0.0.1")
    if (
      url.pathname !== this.sendPath
      && url.pathname !== this.relaySendPath
    ) {
      return jsonResponse(404, false, undefined, {
        code: "not_found",
        message: "not found",
      })
    }
    if (!this.authenticated(request, url)) {
      this.recordIngressAudit("denied", url.pathname, { reason: "unauthorized" })
      return jsonResponse(401, false, undefined, {
        code: "unauthorized",
        message: "unauthorized",
      })
    }
    if (!this.consumeRateLimit(request, url.pathname)) {
      this.recordIngressAudit("denied", url.pathname, { reason: "rate_limited" })
      return jsonResponse(429, false, undefined, {
        code: "rate_limited",
        message: "rate limited",
      })
    }
    if (request.method !== "POST") {
      this.recordIngressAudit("denied", url.pathname, { reason: "method_not_allowed" })
      return jsonResponse(405, false, undefined, {
        code: "method_not_allowed",
        message: "POST only",
      })
    }
    this.recordIngressAudit("allowed", url.pathname, { method: request.method })
    let body: (SideChannelSendRequest & SideChannelRelaySendRequest) | undefined
    try {
      body = parseJsonBody(request.body)
      if (url.pathname === this.relaySendPath) {
        const result = await this.handleRelaySend(body)
        return jsonResponse(200, true, result)
      }
      const result = await this.send(body)
      return jsonResponse(200, true, result)
    } catch (error) {
      const response = responseForError(error)
      this.recordIngressAudit("failed", url.pathname, {
        ...sideChannelRequestShape(body),
        errorCode: sideChannelErrorCode(error),
        errorLength: errorMessage(error).length,
        errorName: error instanceof Error ? error.name : typeof error,
        method: request.method,
        status: response.status,
      })
      this.logHttpFailure(url.pathname, request.method, body, response.status, error)
      return response
    }
  }

  private authenticated(request: LocalHttpRequest, url: URL): boolean {
    const auth = firstHeader(request.headers.authorization)
    if (auth?.startsWith("Bearer ") && timingSafeEqualText(auth.slice(7), this.token)) {
      return true
    }
    const token = firstHeader(request.headers["x-synapse-side-channel-token"])
      ?? firstHeader(request.headers["x-synapse-token"])
      ?? url.searchParams.get("token")
    return token !== null && token !== undefined && timingSafeEqualText(token, this.token)
  }

  private consumeRateLimit(request: LocalHttpRequest, path: string): boolean {
    const limit = this.deps.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE
    if (limit <= 0) return false
    const key = `${request.remoteAddress ?? "local"}:${path}`
    const now = Date.now()
    const cutoff = now - 60_000
    const values = (this.rateLimiter.get(key) ?? []).filter((value) => value >= cutoff)
    if (values.length >= limit) {
      this.rateLimiter.set(key, values)
      return false
    }
    values.push(now)
    this.rateLimiter.set(key, values)
    return true
  }

  private async resolveProject(projectId: string | undefined): Promise<SideChannelProjectSummary> {
    const projects = await this.deps.listProjects()
    if (projectId) {
      const project = projects.find((item) => item.projectId === projectId)
      if (!project) {
        throw new SideChannelError("project_not_found", "project was not found", 404)
      }
      return project
    }
    if (projects.length === 1 && projects[0]) {
      return projects[0]
    }
    throw new SideChannelError("project_required", "project is required", 400)
  }

  private async handleRelaySend(request: SideChannelRelaySendRequest): Promise<unknown> {
    if (!this.relaySendHandler) {
      throw new SideChannelError("relay_unavailable", "relay send handler is unavailable", 503)
    }
    const project = await this.resolveProject(request.sourceProjectId ?? request.source_project)
    const sessionKey = this.resolveSessionKey(
      project.projectId,
      request.sourceSessionKey ?? request.source_session_key,
    )
    const sourceTarget = this.targets.get(targetKey(project.projectId, sessionKey))
    if (!sourceTarget) {
      throw new SideChannelError("source_session_not_found", "source session was not found", 404)
    }
    if (!relayMessage(request).trim()) {
      throw new SideChannelError("empty_payload", "message is required", 400)
    }
    return this.relaySendHandler({
      request,
      sourceProjectId: project.projectId,
      sourceSessionKey: sessionKey,
      sourceTarget,
    })
  }

  private resolveSessionKey(projectId: string, value: string | undefined): string {
    const explicit = value?.trim()
    if (explicit) return explicit
    const matches = [...this.targets.values()].filter((target) => target.projectId === projectId)
    if (matches.length === 1 && matches[0]) return matches[0].sessionKey
    throw new SideChannelError("session_key_required", "sessionKey is required", 400)
  }

  private outbox(projectId: string): ReplyOutboxService {
    const existing = this.outboxes.get(projectId)
    if (existing) return existing
    const outbox = new ReplyOutboxService({
      projectId,
      outbox: this.deps.dataRepository.namespace<OutboxEntryV1>("outbox"),
      logger: this.deps.logger,
    })
    this.outboxes.set(projectId, outbox)
    return outbox
  }

  private recordSendAudit(
    outcome: "allowed" | "failed",
    target: ReplyTarget,
    attachmentCount: number,
    diagnostic: Record<string, unknown> = {},
  ): void {
    this.deps.auditSink?.record({
      action: "network.connect",
      actor: { kind: "agent", id: "side-channel" },
      resource: "side-channel:/send",
      outcome,
      metadata: {
        projectId: target.projectId,
        ...(target.conversationId ? { conversationId: target.conversationId } : {}),
        transportKind: target.transport.kind,
        connectorId: target.transport.connectorId,
        attachmentCount,
        ...diagnostic,
      },
    })
  }

  private recordIngressAudit(
    outcome: "allowed" | "denied" | "failed",
    path: string,
    metadata: Record<string, unknown>,
  ): void {
    this.deps.auditSink?.record({
      action: "network.connect",
      actor: { kind: "agent", id: "side-channel" },
      resource: `side-channel:${path}`,
      outcome,
      metadata,
    })
  }

  private logHttpFailure(
    path: string,
    method: string,
    request: (SideChannelSendRequest & SideChannelRelaySendRequest) | undefined,
    status: number,
    error: unknown,
  ): void {
    this.deps.logger?.warn("Side-channel HTTP request failed.", {
      path,
      method,
      projectId: stringValue(request?.projectId ?? request?.project ?? request?.sourceProjectId ?? request?.source_project),
      hasSessionKey: Boolean(stringValue(request?.sessionKey ?? request?.session_key ?? request?.sourceSessionKey ?? request?.source_session_key)),
      messageLength: typeof request?.message === "string" ? request.message.length : 0,
      imageCount: arrayLength(request?.images),
      fileCount: arrayLength(request?.files),
      errorCode: sideChannelErrorCode(error),
      status,
      boundary: "side-channel-http",
      errorName: error instanceof Error ? error.name : typeof error,
      errorLength: errorMessage(error).length,
    })
  }
}

function sideChannelRequestShape(
  request: (SideChannelSendRequest & SideChannelRelaySendRequest) | undefined,
): Record<string, unknown> {
  if (!request) return {}
  return {
    fileCount: arrayLength(request.files),
    imageCount: arrayLength(request.images),
    messageLength: typeof request.message === "string" ? request.message.length : 0,
    projectId: stringValue(request.projectId ?? request.project ?? request.sourceProjectId ?? request.source_project),
  }
}

function outboxPayload(
  message: string | undefined,
  attachments: readonly {
    readonly kind: "image" | "file"
    readonly fileName: string
    readonly mimeType: string
    readonly size: number
  }[],
): OutboxPayloadV1 {
  return {
    kind: message ? "text" : (attachments[0]?.kind ?? "event"),
    content: message,
    attachments: attachments.map((attachment) => ({
      kind: attachment.kind,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
    metadata: { source: "side-channel" },
  }
}

function parseJsonBody(
  body: Buffer,
): SideChannelSendRequest & SideChannelRelaySendRequest {
  try {
    const value = JSON.parse(body.toString("utf8")) as unknown
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("JSON body must be an object")
    }
    return value as SideChannelSendRequest & SideChannelRelaySendRequest
  } catch (error) {
    throw new SideChannelError(
      "invalid_json",
      error instanceof Error ? error.message : String(error),
      400,
    )
  }
}

function jsonResponse(
  status: number,
  ok: boolean,
  data?: unknown,
  error?: { readonly code: string; readonly message: string },
): LocalHttpResponse {
  return {
    status,
    body: ok ? { ok, data } : { ok, error },
  }
}

function responseForError(error: unknown): LocalHttpResponse {
  if (error instanceof AttachmentPolicyError) {
    return jsonResponse(400, false, undefined, {
      code: error.code,
      message: error.message,
    })
  }
  if (error instanceof SideChannelError) {
    return jsonResponse(error.status, false, undefined, {
      code: error.code,
      message: error.message,
    })
  }
  return jsonResponse(500, false, undefined, {
    code: sideChannelErrorCode(error),
    message: "internal error",
  })
}

function sideChannelErrorCode(error: unknown): string {
  if (error instanceof AttachmentPolicyError || error instanceof SideChannelError) return error.code
  return "internal_error"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function outboxLastError(error: unknown): string {
  if (error instanceof SideChannelError) return error.message
  const diagnostic = errorDiagnostic(error)
  return `${diagnostic.errorName} (${diagnostic.errorLength} chars)`
}

function errorDiagnostic(error: unknown): {
  readonly errorName: string
  readonly errorLength: number
  readonly errorCode?: string
} {
  const diagnostic = {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: errorMessage(error).length,
  }
  if (error instanceof AttachmentPolicyError || error instanceof SideChannelError) {
    return { ...diagnostic, errorCode: error.code }
  }
  return diagnostic
}

function networkAuditErrorDiagnostic(error: string | undefined): {
  readonly errorName?: string
  readonly errorLength?: number
} {
  if (!error) return {}
  return { errorName: "Error", errorLength: error.length }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function timingSafeEqualText(a: string, b: string): boolean {
  const aBytes = Buffer.from(a)
  const bBytes = Buffer.from(b)
  if (aBytes.length !== bBytes.length) return false
  return cryptoTimingSafeEqual(aBytes, bBytes)
}

function cryptoTimingSafeEqual(a: Buffer, b: Buffer): boolean {
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function targetKey(projectId: string, sessionKey: string): string {
  return `${projectId}:${sessionKey}`
}

function isMutedTarget(target: ReplyTarget): boolean {
  return target.metadata?.muted === true || target.replyCtx?.muted === true
}

function relayMessage(request: SideChannelRelaySendRequest): string {
  return request.message ?? ""
}

export class SideChannelError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}
