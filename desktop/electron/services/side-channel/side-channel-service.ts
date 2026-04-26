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
import { ReplyOutboxService, type ReplyTarget } from "../reply-target"
import { AttachmentPolicyError, prepareSideChannelAttachments } from "./attachment-policy"
import type {
  ReplyTargetRuntime,
  SideChannelCronAddHandler,
  ReplyTransportDispatcher,
  SideChannelCronAddRequest,
  SideChannelSendRequest,
  SideChannelSendResult,
  SideChannelStatus,
} from "./types"

export interface SideChannelProjectSummary {
  readonly projectId: string
  readonly name?: string
  readonly workspacePath?: string
}

export interface SideChannelServiceDeps {
  readonly projectContainers: ProjectContainerRegistry
  readonly networkRegistry: NetworkServiceRegistry
  readonly dataRepository: DataRepository
  readonly listProjects: () => Promise<readonly SideChannelProjectSummary[]>
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly logger?: StructuredLogger
  readonly token?: string
  readonly preferredPort?: number
  readonly bindAddress?: string
  readonly sendPath?: string
  readonly cronAddPath?: string
  readonly maxBodyBytes?: number
}

const DEFAULT_SEND_PATH = "/send"
const DEFAULT_CRON_ADD_PATH = "/cron/add"
const NETWORK_SERVICE_ID = "side-channel.send"

export class SideChannelService implements ReplyTargetRuntime {
  private readonly deps: SideChannelServiceDeps
  private readonly token: string
  private readonly sendPath: string
  private readonly cronAddPath: string
  private readonly targets = new Map<string, ReplyTarget>()
  private readonly dispatchers = new Map<string, ReplyTransportDispatcher>()
  private cronAddHandler: SideChannelCronAddHandler | undefined
  private binding: ResolvedNetworkBinding | undefined

  constructor(deps: SideChannelServiceDeps) {
    this.deps = deps
    this.token = deps.token ?? randomUUID()
    this.sendPath = deps.sendPath ?? DEFAULT_SEND_PATH
    this.cronAddPath = deps.cronAddPath ?? DEFAULT_CRON_ADD_PATH
  }

  async start(): Promise<void> {
    const permission = await this.deps.permissionGuard?.check({
      action: "network.listen",
      actor: { kind: "user" },
      resource: `127.0.0.1:${String(this.deps.preferredPort ?? 0)}${this.sendPath}`,
      context: { serviceId: NETWORK_SERVICE_ID },
    })
    if (permission && !permission.allowed) {
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
            error: event.error,
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
      cronAddPath: this.cronAddPath,
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
      SYNAPSE_CRON_ADD_URL: `${baseUrl}${this.cronAddPath}`,
      SYNAPSE_SIDE_CHANNEL_TOKEN: this.token,
    }
  }

  rememberReplyTarget(target: ReplyTarget): void {
    this.targets.set(targetKey(target.projectId, target.sessionKey), target)
  }

  registerDispatcher(kind: string, dispatcher: ReplyTransportDispatcher): () => void {
    this.dispatchers.set(kind, dispatcher)
    return () => {
      if (this.dispatchers.get(kind) === dispatcher) {
        this.dispatchers.delete(kind)
      }
    }
  }

  registerCronAddHandler(handler: SideChannelCronAddHandler): () => void {
    this.cronAddHandler = handler
    return () => {
      if (this.cronAddHandler === handler) {
        this.cronAddHandler = undefined
      }
    }
  }

  dispatchAgentEvent(target: ReplyTarget, event: AgentEvent): void {
    const dispatcher = this.dispatchers.get(target.transport.kind)
    if (!dispatcher) return
    void dispatcher.dispatchAgentEvent(target, event).catch((error) => {
      this.deps.logger?.warn("Reply target dispatch failed.", {
        error: error instanceof Error ? error.message : String(error),
        projectId: target.projectId,
        sessionKey: target.sessionKey,
        transportKind: target.transport.kind,
        connectorId: target.transport.connectorId,
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
    if (isMutedTarget(target)) {
      return {
        ok: true,
        projectId: project.projectId,
        sessionKey,
        outboxRecorded: true,
      }
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

    try {
      if (dispatcher) {
        await dispatcher.dispatchSideChannelSend(target, { message, attachments })
      }
      outbox.record({ target, payload, status: "sent" })
      this.recordSendAudit("allowed", target, attachments.length)
      return {
        ok: true,
        projectId: project.projectId,
        sessionKey,
        outboxRecorded: true,
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      outbox.record({ target, payload, status: "failed", lastError: messageText })
      this.recordSendAudit("failed", target, attachments.length, messageText)
      throw new SideChannelError("dispatch_failed", messageText, 502)
    }
  }

  private async handleHttp(request: LocalHttpRequest): Promise<LocalHttpResponse> {
    const url = new URL(request.url, "http://127.0.0.1")
    if (url.pathname !== this.sendPath && url.pathname !== this.cronAddPath) {
      return jsonResponse(404, false, undefined, {
        code: "not_found",
        message: "not found",
      })
    }
    if (!this.authenticated(request, url)) {
      return jsonResponse(401, false, undefined, {
        code: "unauthorized",
        message: "unauthorized",
      })
    }
    if (request.method !== "POST") {
      return jsonResponse(405, false, undefined, {
        code: "method_not_allowed",
        message: "POST only",
      })
    }
    try {
      const body = parseJsonBody(request.body)
      if (url.pathname === this.cronAddPath) {
        const result = await this.handleCronAdd(body)
        return jsonResponse(200, true, result)
      }
      const result = await this.send(body)
      return jsonResponse(200, true, result)
    } catch (error) {
      return responseForError(error)
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

  private async handleCronAdd(request: SideChannelCronAddRequest): Promise<unknown> {
    const project = await this.resolveProject(request.projectId ?? request.project)
    const sessionKey = this.resolveSessionKey(project.projectId, request.sessionKey ?? request.session_key)
    const target = this.targets.get(targetKey(project.projectId, sessionKey))
    if (!target) {
      throw new SideChannelError("session_not_found", "session reply target was not found", 404)
    }
    if (!this.cronAddHandler) {
      throw new SideChannelError("cron_add_unavailable", "cron add handler is unavailable", 503)
    }
    if (request.exec?.trim()) {
      await this.checkCronExecPermission(project.projectId, sessionKey, request.exec)
    }
    return this.cronAddHandler({
      request,
      projectId: project.projectId,
      sessionKey,
      target,
    })
  }

  private resolveSessionKey(projectId: string, value: string | undefined): string {
    const explicit = value?.trim()
    if (explicit) return explicit
    const matches = [...this.targets.values()].filter((target) => target.projectId === projectId)
    if (matches.length === 1 && matches[0]) return matches[0].sessionKey
    throw new SideChannelError("session_key_required", "sessionKey is required", 400)
  }

  private async checkCronExecPermission(
    projectId: string,
    sessionKey: string,
    command: string,
  ): Promise<void> {
    const permission = await this.deps.permissionGuard?.check({
      action: "shell.exec",
      actor: { kind: "agent", id: "side-channel" },
      resource: command,
      context: {
        projectId,
        sessionKey,
        source: "side-channel:/cron/add",
      },
    })
    if (permission && !permission.allowed) {
      this.deps.auditSink?.record({
        action: "shell.exec",
        actor: { kind: "agent", id: "side-channel" },
        resource: command,
        outcome: "denied",
        metadata: {
          projectId,
          sessionKey,
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      throw new SideChannelError("permission_denied", permission.reason, 403)
    }
    this.deps.auditSink?.record({
      action: "shell.exec",
      actor: { kind: "agent", id: "side-channel" },
      resource: command,
      outcome: "allowed",
      metadata: {
        projectId,
        sessionKey,
        source: "side-channel:/cron/add",
      },
    })
  }

  private outbox(projectId: string): ReplyOutboxService {
    return new ReplyOutboxService({
      projectId,
      outbox: this.deps.dataRepository.namespace<OutboxEntryV1>("outbox"),
      logger: this.deps.logger,
    })
  }

  private recordSendAudit(
    outcome: "allowed" | "failed",
    target: ReplyTarget,
    attachmentCount: number,
    error?: string,
  ): void {
    this.deps.auditSink?.record({
      action: "network.connect",
      actor: { kind: "agent", id: "side-channel" },
      resource: "side-channel:/send",
      outcome,
      metadata: {
        projectId: target.projectId,
        sessionKey: target.sessionKey,
        transportKind: target.transport.kind,
        connectorId: target.transport.connectorId,
        attachmentCount,
        error,
      },
    })
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

function parseJsonBody(body: Buffer): SideChannelSendRequest & SideChannelCronAddRequest {
  try {
    const value = JSON.parse(body.toString("utf8")) as unknown
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("JSON body must be an object")
    }
    return value as SideChannelSendRequest & SideChannelCronAddRequest
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
    code: "internal_error",
    message: error instanceof Error ? error.message : String(error),
  })
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

export class SideChannelError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}
