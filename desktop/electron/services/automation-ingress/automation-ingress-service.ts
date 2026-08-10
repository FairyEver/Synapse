import { randomUUID, timingSafeEqual } from "node:crypto"

import {
  AUTOMATION_INGRESS_WEBHOOK_RUN_LIST_LIMIT,
  AUTOMATION_INGRESS_WEBHOOK_RUN_RETENTION_LIMIT,
} from "../../../config"
import { redactSensitiveText } from "../../../src/lib/agent-redaction"
import type {
  DataNamespace,
  WebhookConfigEntryV1,
  WebhookRunEntryV1,
} from "../../runtime/data-repo"
import {
  createLocalNetworkHostLifecycle,
  type LocalHttpRequest,
  type LocalHttpResponse,
  type NetworkServiceRegistry,
  type ResolvedNetworkBinding,
} from "../../runtime/network"
import type { ProjectContainerRegistry } from "../../runtime/project-container"
import type { ControlledProcessRunner } from "../../runtime/process"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type { StructuredLogger } from "../../runtime/service-registry"
import { assertValidWebhookNumericConfig } from "../../runtime/lib/webhook-config-validation"
import { sanitizeError } from "../error-sanitize"
import { isShellKind, resolveShellCommand } from "../shell-exec"
import { WINDOWS_DEFAULT_SHELL } from "../../../action-packages/builtin/shell-defaults"
import {
  AgentRuntimeService,
  AGENT_RUNTIME_SERVICE_ID,
  type AgentMessage,
} from "../agent-runtime"
import type { ProcessIsolationResolver } from "../execution-isolation"
import type { WebhookConfigUpdate, WebhookConfigUpdateResult, WebhookStatus } from "./types"

const CONFIG_ID = "webhook:default"
const DEFAULT_PATH = "/hook"
const DEFAULT_BIND_ADDRESS = "127.0.0.1"
const DEFAULT_MAX_BODY_BYTES = 256 * 1024
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60
const DEFAULT_WAIT_MS = 30_000
const NETWORK_SERVICE_ID = "automation.webhook"
const MAX_REPLY_CHARS = 3000
const MAX_REQUEST_TIMEOUT_MINS = 120
const INTERRUPTED_WEBHOOK_RUN_ERROR = "Webhook 运行因应用关闭或重启而中断。"
const SAFE_WEBHOOK_REQUEST_METADATA_KEYS = new Set([
  "correlationId",
  "correlation_id",
  "event",
  "label",
  "messageId",
  "message_id",
  "requestId",
  "request_id",
  "source",
  "traceId",
  "trace_id",
])
const SAFE_WEBHOOK_RUN_METADATA_KEYS = new Set([
  ...SAFE_WEBHOOK_REQUEST_METADATA_KEYS,
  "conversationId",
  "sdkSessionId",
])
const SENSITIVE_METADATA_KEY = /token|secret|authorization|cookie|password|credential|api[-_]?key|session[-_]?key/i

export interface AutomationIngressProjectSummary {
  readonly projectId: string
  readonly name?: string
  readonly workspacePath?: string
  readonly managedKnowledgeBase?: boolean
}

export interface AutomationIngressServiceDeps {
  readonly projectContainers: ProjectContainerRegistry
  readonly networkRegistry: NetworkServiceRegistry
  readonly configs: DataNamespace<WebhookConfigEntryV1>
  readonly runs: DataNamespace<WebhookRunEntryV1>
  readonly processRunner: ControlledProcessRunner
  readonly listProjects: () => Promise<readonly AutomationIngressProjectSummary[]>
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly executionIsolation?: ProcessIsolationResolver
  readonly logger?: StructuredLogger
  readonly runListLimit?: number
  readonly runRetentionLimit?: number
  readonly now?: () => Date
  readonly platform?: NodeJS.Platform
}

interface PreparedWebhook {
  readonly project: AutomationIngressProjectSummary
  readonly prompt?: string
  readonly exec?: string
}

export class AutomationIngressService {
  private readonly deps: AutomationIngressServiceDeps
  private readonly runListLimit: number
  private readonly runRetentionLimit: number
  private readonly rateLimiter = new Map<string, number[]>()
  private binding: ResolvedNetworkBinding | undefined
  private runtimeConfigRestartRequired = false
  private recoveredInterruptedRuns = false

  constructor(deps: AutomationIngressServiceDeps) {
    this.deps = deps
    this.runListLimit = normalizePositiveLimit(
      deps.runListLimit,
      AUTOMATION_INGRESS_WEBHOOK_RUN_LIST_LIMIT,
    )
    this.runRetentionLimit = normalizePositiveLimit(
      deps.runRetentionLimit,
      AUTOMATION_INGRESS_WEBHOOK_RUN_RETENTION_LIMIT,
    )
  }

  async start(): Promise<void> {
    if (!this.recoveredInterruptedRuns) {
      await this.recoverInterruptedRuns()
      this.recoveredInterruptedRuns = true
    }
    const config = await this.getConfigOrDefault()
    if (!config.enabled) return
    await this.checkListenPermission(config)
    this.binding = await this.deps.networkRegistry.register({
      id: NETWORK_SERVICE_ID,
      role: "http",
      preferredPort: config.preferredPort,
      bindAddress: config.bindAddress,
      auth: { kind: "bearer", tokenSecretRef: "webhook.config.token" },
      handler: { handle: () => ({ ok: true }) },
      audit: (event) => {
        this.deps.auditSink?.record({
          action: "network.listen",
          actor: { kind: "system", id: "automation-ingress" },
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
      onPortAssigned: (port) => {
        void this.updateAssignedPort(port).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          this.deps.logger?.warn("Webhook assigned port persistence failed.", {
            errorName: error instanceof Error ? error.name : typeof error,
            errorLength: message.length,
          })
        })
      },
      start: (binding) => createLocalNetworkHostLifecycle(binding, {
        maxBodyBytes: config.maxBodyBytes,
        handleHttp: (request) => this.handleHttp(request),
      }),
    })
    this.runtimeConfigRestartRequired = false
  }

  async stop(): Promise<void> {
    await this.deps.networkRegistry.unregister(NETWORK_SERVICE_ID)
    this.binding = undefined
  }

  async getStatus(): Promise<WebhookStatus> {
    return statusFromConfig(await this.getConfigOrDefault(), this.binding, this.runtimeConfigRestartRequired)
  }

  async updateConfig(input: WebhookConfigUpdate): Promise<WebhookConfigUpdateResult> {
    assertValidWebhookNumericConfig(input)
    const existing = await this.getConfigOrDefault()
    const bindAddress = input.bindAddress?.trim() || existing.bindAddress
    const preferredPort = input.preferredPort ?? existing.preferredPort
    const path = normalizePath(input.path ?? existing.path)
    const enabled = input.enabled ?? existing.enabled
    const changedFields = configChangedFields(input)
    await this.authorizeConfigUpdate(input, {
      enabled,
      bindAddress,
      preferredPort,
      path,
      changedFields,
    })
    const token = input.resetToken ? randomUUID() : existing.token
    const next: WebhookConfigEntryV1 = {
      ...existing,
      enabled,
      bindAddress,
      preferredPort,
      path,
      token,
      maxBodyBytes: input.maxBodyBytes ?? existing.maxBodyBytes,
      rateLimitPerMinute: input.rateLimitPerMinute ?? existing.rateLimitPerMinute,
      serviceRestartRequired: true,
      updatedAt: this.isoNow(),
    }
    await this.deps.configs.upsert(next)
    this.runtimeConfigRestartRequired = Boolean(this.binding)
    return {
      status: statusFromConfig(next, this.binding, this.runtimeConfigRestartRequired),
      token: input.resetToken ? token : undefined,
    }
  }

  private async authorizeConfigUpdate(
    input: WebhookConfigUpdate,
    target: {
      readonly enabled: boolean
      readonly bindAddress: string
      readonly preferredPort?: number
      readonly path: string
      readonly changedFields: readonly string[]
    },
  ): Promise<void> {
    if (requiresListenConfigAuthorization(input, target.enabled)) {
      await this.authorizeConfigPermission({
        action: "network.listen",
        resource: webhookListenResource(target),
        changedFields: target.changedFields,
      })
    }
    if (input.resetToken) {
      await this.authorizeConfigPermission({
        action: "secret.write",
        resource: "automation.webhook.token",
        changedFields: target.changedFields,
      })
    }
  }

  private async authorizeConfigPermission(input: {
    readonly action: "network.listen" | "secret.write"
    readonly resource: string
    readonly changedFields: readonly string[]
  }): Promise<void> {
    const metadata = {
      source: "automationIngress.updateConfig",
      changedFields: [...input.changedFields],
    }
    const permission = await this.deps.permissionGuard?.check({
      action: input.action,
      actor: { kind: "user" },
      resource: input.resource,
      context: {
        serviceId: NETWORK_SERVICE_ID,
        source: "automationIngress.updateConfig",
      },
    })
    if (permission && !permission.allowed) {
      this.deps.auditSink?.record({
        action: input.action,
        actor: { kind: "user" },
        resource: input.resource,
        outcome: "denied",
        metadata: {
          ...metadata,
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      throw new Error(permission.reason)
    }
    this.deps.auditSink?.record({
      action: input.action,
      actor: { kind: "user" },
      resource: input.resource,
      outcome: "allowed",
      metadata,
    })
  }

  async listRuns(projectId?: string): Promise<readonly WebhookRunEntryV1[]> {
    const runs = await this.deps.runs.list()
    const filteredRuns = projectId ? runs.filter((run) => run.projectId === projectId) : runs
    return sortWebhookRunsNewestFirst(filteredRuns)
      .slice(0, this.runListLimit)
      .map(sanitizeWebhookRunForDisplay)
  }

  private async recoverInterruptedRuns(): Promise<void> {
    const runs = await this.deps.runs.list({ status: "running" })
    let recoveredCount = 0

    for (const run of runs) {
      try {
        await this.finishRun(run, "failed", { lastError: INTERRUPTED_WEBHOOK_RUN_ERROR })
        recoveredCount += 1
      } catch (error) {
        this.deps.logger?.warn("Webhook run startup recovery failed.", {
          runId: run.id,
          projectId: run.projectId,
          kind: run.kind,
          boundary: "webhook-startup-run-recovery",
          ...errorDiagnostic(error),
        })
      }
    }

    if (recoveredCount > 0) {
      this.deps.logger?.info("Recovered interrupted webhook runs.", {
        boundary: "webhook-startup-run-recovery",
        recoveredCount,
      })
    }
  }

  private async handleHttp(request: LocalHttpRequest): Promise<LocalHttpResponse> {
    const url = new URL(request.url, "http://127.0.0.1")
    try {
      const config = await this.getConfigOrDefault()
      if (!config.enabled) {
        return jsonResponse(404, false, undefined, "not_found", "not found")
      }
      if (url.pathname !== config.path) {
        return jsonResponse(404, false, undefined, "not_found", "not found")
      }
      if (request.method !== "POST") {
        return jsonResponse(405, false, undefined, "method_not_allowed", "POST only")
      }
      if (!this.consumeRateLimit(request, config.rateLimitPerMinute)) {
        return jsonResponse(429, false, undefined, "rate_limited", "rate limited")
      }
      if (!this.authenticated(request, url, config.token)) {
        this.recordAudit("denied", `webhook:${config.path}`, { reason: "unauthorized" })
        return jsonResponse(401, false, undefined, "unauthorized", "unauthorized")
      }
      const body = parseJsonBody(request.body)
      const mode = stringValue(body.replyMode) === "wait" ? "wait" : "async"
      const prepared = await this.prepareWebhook(body)
      const timeoutMins = prepared.exec ? requestTimeoutMinsValue(body) : undefined
      const promise = this.executeWebhook(prepared, body, request, config.path, timeoutMins)
      if (mode === "wait") {
        promise.catch((error) => {
          this.deps.logger?.warn("Webhook wait-mode run failed after response.", {
            boundary: "webhook-wait-background",
            path: config.path,
            mode,
            ...errorDiagnostic(error),
          })
        })
        const result = await promiseWithTimeout(promise, DEFAULT_WAIT_MS)
        if (!result) return jsonResponse(202, true, { status: "running" })
        return jsonResponse(200, true, result)
      }
      void promise.catch((error) => {
        this.deps.logger?.warn("Webhook background run failed.", {
          boundary: "webhook-background",
          path: config.path,
          mode,
          ...errorDiagnostic(error),
        })
      })
      return jsonResponse(202, true, { status: "queued" })
    } catch (error) {
      if (error instanceof WebhookError) {
        this.deps.logger?.warn("Webhook request validation failed.", {
          boundary: "webhook.validation",
          path: url.pathname,
          method: request.method,
          status: error.status,
          source: remoteSource(request),
          bodyLength: request.body.length,
          ...errorDiagnostic(error),
        })
        return jsonResponse(error.status, false, undefined, error.code, error.message)
      }
      this.deps.logger?.warn("Webhook request failed before dispatch.", {
        boundary: "webhook.request",
        path: url.pathname,
        method: request.method,
        source: remoteSource(request),
        bodyLength: request.body.length,
        ...errorDiagnostic(error),
      })
      return jsonResponse(500, false, undefined, "internal_error", "internal error")
    }
  }

  private async executeWebhook(
    prepared: PreparedWebhook,
    body: Record<string, unknown>,
    request: LocalHttpRequest,
    path: string,
    timeoutMins: number | undefined,
  ): Promise<Record<string, unknown>> {
    const { project, prompt, exec } = prepared
    const sessionKey = stringValue(body.sessionKey) ?? stringValue(body.session_key)
    const run = await this.createRun({
      projectId: project.projectId,
      kind: prompt ? "prompt" : "exec",
      source: remoteSource(request),
      metadata: sanitizeWebhookRequestMetadata(recordValue(body.metadata)),
    })
    try {
      const result = prompt
        ? await this.executePrompt(run, project, body, prompt)
        : await this.executeShell(run, project, body, exec ?? "", timeoutMins)
      const resultStatus = stringValue(result.status)
      const finalStatus: WebhookRunEntryV1["status"] = resultStatus === "failed" || resultStatus === "timeout"
        ? resultStatus
        : "success"
      const resultBoundary = run.kind === "prompt" ? "agent-runtime" : "process-runner"
      const resultError = stringValue(result.error)
      const safeResultError = resultBoundary === "agent-runtime" && resultError
        ? summarizeReturnedAgentError(resultError)
        : resultError
      const resultDiagnostic = errorDiagnostic(resultError ?? resultStatus ?? finalStatus)
      const resultCorrelation = run.kind === "prompt"
        ? { messageId: webhookAgentMessageId(body, run.id), ...agentResultCorrelation(result) }
        : agentResultCorrelation(result)
      const resultText = stringValue(result.resultText)
      const safeResultText = resultText ? sanitizeWebhookRunText(resultText) : undefined
      await this.finishRun(run, finalStatus, {
        resultText,
        lastError: finalStatus === "success" ? undefined : safeResultError ?? resultStatus,
        metadata: resultCorrelation,
      })
      if (finalStatus !== "success") {
        this.deps.logger?.warn("Webhook prompt run completed with agent error.", {
          runId: run.id,
          projectId: project.projectId,
          kind: run.kind,
          ...resultCorrelation,
          status: finalStatus,
          boundary: resultBoundary,
          ...resultDiagnostic,
        })
      }
      const auditMetadata = {
        runId: run.id,
        projectId: project.projectId,
        kind: run.kind,
        ...resultCorrelation,
      }
      this.recordAudit(finalStatus === "success" ? "allowed" : "failed", `webhook:${path}`, finalStatus === "success"
        ? auditMetadata
        : { ...auditMetadata, status: finalStatus, boundary: resultBoundary, ...resultDiagnostic })
      return {
        runId: run.id,
        ...result,
        resultText: safeResultText,
        ...(safeResultError ? { error: safeResultError } : {}),
      }
    } catch (error) {
      const message = errorMessage(error)
      const diagnostic = errorDiagnostic(error)
      const persistedLastError = run.kind === "prompt" && !(error instanceof WebhookError)
        ? summarizeReturnedAgentError(message)
        : sanitizeWebhookAgentError(message)
      await this.finishRunSafely(run, "failed", { lastError: persistedLastError })
      this.deps.logger?.warn("Webhook run threw.", {
        runId: run.id,
        projectId: project.projectId,
        kind: run.kind,
        ...(run.kind === "prompt" ? { messageId: webhookAgentMessageId(body, run.id) } : {}),
        boundary: run.kind === "prompt" ? "agent-runtime" : "process-runner",
        ...diagnostic,
      })
      this.recordAudit("failed", `webhook:${path}`, {
        runId: run.id,
        projectId: project.projectId,
        kind: run.kind,
        ...(run.kind === "prompt" ? { messageId: webhookAgentMessageId(body, run.id) } : {}),
        ...diagnostic,
      })
      throw error
    }
  }

  private async executePrompt(
    run: WebhookRunEntryV1,
    project: AutomationIngressProjectSummary,
    body: Record<string, unknown>,
    prompt: string,
  ): Promise<Record<string, unknown>> {
    const sessionKey = stringValue(body.sessionKey) ?? stringValue(body.session_key)
    if (!sessionKey) throw new WebhookError("session_required", "sessionKey is required", 400)
    const container = await this.deps.projectContainers.open(project.projectId, {
      name: project.name,
      workspacePath: project.workspacePath,
      managedKnowledgeBase: project.managedKnowledgeBase,
    })
    const agent = container.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID)
    const content = appendPayloadContext(prompt, body.payload)
    const message: AgentMessage = {
      projectId: project.projectId,
      sessionKey,
      platform: "webhook",
      messageId: webhookAgentMessageId(body, run.id),
      userId: "webhook",
      userName: "webhook",
      content,
      workspaceKey: stringValue(body.workspaceKey),
      workspacePath: project.workspacePath,
      createdAt: this.isoNow(),
    }
    const result = await agent.send(message)
    return {
      status: result.error ? "failed" : "success",
      resultText: result.resultText,
      error: result.error,
      conversationId: result.conversationId,
      sdkSessionId: result.agentSessionId,
    }
  }

  private async prepareWebhook(body: Record<string, unknown>): Promise<PreparedWebhook> {
    const project = await this.resolveProject(stringValue(body.projectId) ?? stringValue(body.project))
    const prompt = stringValue(body.prompt)
    const exec = stringValue(body.exec)
    if (Boolean(prompt) === Boolean(exec)) {
      throw new WebhookError("invalid_payload", "prompt and exec are mutually exclusive", 400)
    }
    return { project, prompt, exec }
  }

  private async executeShell(
    run: WebhookRunEntryV1,
    project: AutomationIngressProjectSummary,
    body: Record<string, unknown>,
    exec: string,
    timeoutMins: number | undefined,
  ): Promise<Record<string, unknown>> {
    const workDir = stringValue(body.workDir) ?? stringValue(body.workspacePath) ?? project.workspacePath
    if (!workDir) throw new WebhookError("workspace_required", "workDir is required", 400)
    const timeoutMs = timeoutMinsToMs(timeoutMins)
    const env: Record<string, string> = {}
    const shell = resolveShellCommand(shellValue(body.shell), exec, {
      platform: this.deps.platform,
      windowsDefault: WINDOWS_DEFAULT_SHELL,
    })
    const result = await this.deps.processRunner.run({
      actor: { kind: "agent", id: "webhook" },
      action: "shell.exec",
      command: shell.command,
      args: [...shell.args],
      cwd: workDir,
      env,
      envAllowlist: Object.keys(env),
      isolation: await this.deps.executionIsolation?.resolveProcessIsolation(project.projectId),
      timeoutMs,
      output: {
        stdout: "buffer",
        stderr: "buffer",
        maxBufferBytes: 1024 * 1024,
      },
      metadata: {
        source: "webhook",
        projectId: project.projectId,
        runId: run.id,
        shell: shell.shell,
      },
    })
    const output = formatShellOutput(result.stdout, result.stderr)
    const statusText = result.timedOut
      ? "timeout"
      : result.exitCode === 0 && !result.error
        ? "success"
        : "failed"
    const replyText = output || result.error || statusText
    if (statusText !== "success") {
      throw new WebhookError(statusText, sanitizeWebhookShellError(result.error ?? replyText), result.timedOut ? 504 : 500)
    }
    return {
      status: statusText,
      resultText: truncate(replyText),
      exitCode: result.exitCode,
    }
  }

  private authenticated(
    request: LocalHttpRequest,
    url: URL,
    token: string | undefined,
  ): boolean {
    if (!token) return false
    const auth = firstHeader(request.headers.authorization)
    if (auth?.startsWith("Bearer ") && timingSafeEqualText(auth.slice(7), token)) return true
    const header = firstHeader(request.headers["x-webhook-token"])
      ?? firstHeader(request.headers["x-synapse-webhook-token"])
    const candidate = header ?? url.searchParams.get("token")
    return candidate !== null && candidate !== undefined && timingSafeEqualText(candidate, token)
  }

  private consumeRateLimit(request: LocalHttpRequest, limit: number): boolean {
    const key = remoteSource(request)
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

  private async resolveProject(projectId: string | undefined): Promise<AutomationIngressProjectSummary> {
    const projects = await this.deps.listProjects()
    if (projectId) {
      const project = projects.find((item) => item.projectId === projectId)
      if (!project) throw new WebhookError("project_not_found", "project was not found", 404)
      return project
    }
    if (projects.length === 1 && projects[0]) return projects[0]
    throw new WebhookError("project_required", "project is required", 400)
  }

  private async getConfigOrDefault(): Promise<WebhookConfigEntryV1> {
    const existing = await this.deps.configs.get(CONFIG_ID)
    if (existing) return existing
    const now = this.isoNow()
    return {
      id: CONFIG_ID,
      schemaVersion: 1,
      enabled: false,
      bindAddress: DEFAULT_BIND_ADDRESS,
      path: DEFAULT_PATH,
      token: randomUUID(),
      maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
      rateLimitPerMinute: DEFAULT_RATE_LIMIT_PER_MINUTE,
      createdAt: now,
      updatedAt: now,
    }
  }

  private async updateAssignedPort(port: number): Promise<void> {
    const config = await this.getConfigOrDefault()
    await this.deps.configs.upsert({
      ...config,
      assignedPort: port,
      serviceRestartRequired: false,
      updatedAt: this.isoNow(),
    })
    this.runtimeConfigRestartRequired = false
  }

  private async createRun(input: {
    readonly projectId: string
    readonly kind: "prompt" | "exec"
    readonly source: string
    readonly metadata?: Record<string, unknown>
  }): Promise<WebhookRunEntryV1> {
    const now = this.isoNow()
    const run: WebhookRunEntryV1 = {
      id: `webhook-run:${randomUUID()}`,
      schemaVersion: 1,
      requestId: randomUUID(),
      projectId: input.projectId,
      kind: input.kind,
      status: "running",
      source: input.source,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    }
    if (input.metadata) {
      run.metadata = input.metadata
    }
    await this.deps.runs.upsert(run)
    return run
  }

  private async finishRun(
    run: WebhookRunEntryV1,
    status: WebhookRunEntryV1["status"],
    patch: {
      readonly resultText?: string
      readonly lastError?: string
      readonly metadata?: Record<string, unknown>
    },
  ): Promise<void> {
    const metadata = sanitizeWebhookRunMetadata(patch.metadata ? { ...run.metadata, ...patch.metadata } : run.metadata)
    const nextRun: WebhookRunEntryV1 = {
      ...run,
      status,
      resultText: patch.resultText ? truncate(sanitizeWebhookRunText(patch.resultText)) : undefined,
      lastError: patch.lastError ? sanitizeWebhookRunText(patch.lastError) : undefined,
      finishedAt: this.isoNow(),
      updatedAt: this.isoNow(),
    }
    if (metadata) {
      nextRun.metadata = metadata
    } else {
      delete nextRun.metadata
    }
    await this.deps.runs.upsert(nextRun)
    await this.pruneStoredRunsSafely()
  }

  private async finishRunSafely(
    run: WebhookRunEntryV1,
    status: WebhookRunEntryV1["status"],
    patch: {
      readonly resultText?: string
      readonly lastError?: string
      readonly metadata?: Record<string, unknown>
    },
  ): Promise<void> {
    try {
      await this.finishRun(run, status, patch)
    } catch (error) {
      this.deps.logger?.warn("Webhook run finish failed.", {
        runId: run.id,
        projectId: run.projectId,
        kind: run.kind,
        status,
        boundary: "webhook.run-finish",
        ...errorDiagnostic(error),
      })
    }
  }

  private async pruneStoredRunsSafely(): Promise<void> {
    try {
      await this.pruneStoredRuns()
    } catch (error) {
      this.deps.logger?.warn("Webhook run retention cleanup failed.", {
        boundary: "webhook.run-retention",
        ...errorDiagnostic(error),
      })
    }
  }

  private async pruneStoredRuns(): Promise<void> {
    const runs = await this.deps.runs.list()
    const finishedRuns = sortWebhookRunsNewestFirst(runs.filter((run) => run.status !== "running"))
    const staleRuns = finishedRuns.slice(this.runRetentionLimit)
    await Promise.all(staleRuns.map((run) => this.deps.runs.remove(run.id)))
  }

  private async checkListenPermission(config: WebhookConfigEntryV1): Promise<void> {
    const resource = `${config.bindAddress}:${String(config.preferredPort ?? 0)}${config.path}`
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
  }

  private recordAudit(
    outcome: "allowed" | "denied" | "failed",
    resource: string,
    metadata: Record<string, unknown>,
  ): void {
    this.deps.auditSink?.record({
      action: "network.connect",
      actor: { kind: "agent", id: "webhook" },
      resource,
      outcome,
      metadata,
    })
  }

  private isoNow(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}

function statusFromConfig(
  config: WebhookConfigEntryV1,
  binding: ResolvedNetworkBinding | undefined,
  runtimeConfigRestartRequired: boolean,
): WebhookStatus {
  return {
    enabled: config.enabled && Boolean(binding),
    bindAddress: config.bindAddress,
    path: config.path,
    preferredPort: config.preferredPort,
    assignedPort: binding?.port ?? config.assignedPort,
    maxBodyBytes: config.maxBodyBytes,
    rateLimitPerMinute: config.rateLimitPerMinute,
    serviceRestartRequired: binding ? runtimeConfigRestartRequired : config.serviceRestartRequired,
    lastError: config.lastError,
  }
}

function sanitizeWebhookRunForDisplay(run: WebhookRunEntryV1): WebhookRunEntryV1 {
  const safeRun = { ...run }
  delete safeRun.sessionKey
  delete safeRun.workspacePath
  if (safeRun.resultText) {
    safeRun.resultText = sanitizeWebhookRunText(safeRun.resultText)
  }
  if (safeRun.lastError) {
    safeRun.lastError = sanitizeWebhookRunText(safeRun.lastError)
  }
  const metadata = sanitizeWebhookRunMetadata(run.metadata)
  if (metadata) {
    safeRun.metadata = metadata
  } else {
    delete safeRun.metadata
  }
  return safeRun
}

function sortWebhookRunsNewestFirst(runs: readonly WebhookRunEntryV1[]): WebhookRunEntryV1[] {
  return [...runs].sort((left, right) => {
    const timeDelta = webhookRunTimeValue(right) - webhookRunTimeValue(left)
    if (timeDelta !== 0) return timeDelta
    return right.id.localeCompare(left.id)
  })
}

function webhookRunTimeValue(run: WebhookRunEntryV1): number {
  return Date.parse(run.finishedAt ?? run.updatedAt ?? run.startedAt ?? run.createdAt)
}

function normalizePositiveLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

function sanitizeWebhookRequestMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return sanitizeMetadata(metadata, SAFE_WEBHOOK_REQUEST_METADATA_KEYS)
}

function sanitizeWebhookRunMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return sanitizeMetadata(metadata, SAFE_WEBHOOK_RUN_METADATA_KEYS)
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (!allowedKeys.has(key) || SENSITIVE_METADATA_KEY.test(key)) continue
    if (typeof value === "string") {
      sanitized[key] = truncate(value)
      continue
    }
    if (typeof value === "number" || typeof value === "boolean" || value === null) {
      sanitized[key] = value
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

function appendPayloadContext(prompt: string, payload: unknown): string {
  if (payload === undefined) return prompt
  return `${prompt.trimEnd()}\n\nContext:\n${stringFromUnknown(payload)}`
}

function parseJsonBody(body: Buffer): Record<string, unknown> {
  try {
    const value = JSON.parse(body.toString("utf8")) as unknown
    const record = recordValue(value)
    if (!record) throw new Error("JSON body must be an object")
    return record
  } catch (error) {
    throw new WebhookError("invalid_json", errorMessage(error), 400)
  }
}

function jsonResponse(
  status: number,
  ok: boolean,
  data?: unknown,
  code?: string,
  message?: string,
): LocalHttpResponse {
  return {
    status,
    body: ok ? { ok, data } : { ok, error: { code, message } },
  }
}

async function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function shellValue(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    throw new WebhookError("invalid_shell", "shell must be posix, cmd, or powershell", 400)
  }
  const normalized = value.trim().toLowerCase()
  if (!isShellKind(normalized)) {
    throw new WebhookError("invalid_shell", "shell must be posix, cmd, or powershell", 400)
  }
  return normalized
}

function timeoutMinsToMs(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return value * 60_000
}

function requestTimeoutMinsValue(body: Record<string, unknown>): number | undefined {
  const value = body.timeoutMins !== undefined ? body.timeoutMins : body.timeout_mins
  if (value === undefined || value === null) return undefined
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < 1
    || value > MAX_REQUEST_TIMEOUT_MINS
  ) {
    throw new WebhookError(
      "invalid_timeout",
      `timeoutMins must be an integer from 1 to ${MAX_REQUEST_TIMEOUT_MINS}`,
      400,
    )
  }
  return value
}

function formatShellOutput(stdout: string | undefined, stderr: string | undefined): string {
  return [stdout?.trim(), stderr?.trim()].filter(Boolean).join("\n")
}

function truncate(value: string): string {
  if (value.length <= MAX_REPLY_CHARS) return value
  return `${value.slice(0, MAX_REPLY_CHARS)}\n...`
}

function sanitizeWebhookRunText(value: string): string {
  return redactSensitiveText(value)
}

function normalizePath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return DEFAULT_PATH
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

function configChangedFields(input: WebhookConfigUpdate): string[] {
  const fields: string[] = []
  if (input.enabled !== undefined) fields.push("enabled")
  if (input.bindAddress !== undefined) fields.push("bindAddress")
  if (input.preferredPort !== undefined) fields.push("preferredPort")
  if (input.path !== undefined) fields.push("path")
  if (input.maxBodyBytes !== undefined) fields.push("maxBodyBytes")
  if (input.rateLimitPerMinute !== undefined) fields.push("rateLimitPerMinute")
  if (input.resetToken) fields.push("resetToken")
  return fields
}

function requiresListenConfigAuthorization(
  input: WebhookConfigUpdate,
  enabled: boolean,
): boolean {
  return enabled && (
    input.enabled === true
    || input.bindAddress !== undefined
    || input.preferredPort !== undefined
    || input.path !== undefined
    || input.maxBodyBytes !== undefined
    || input.rateLimitPerMinute !== undefined
  )
}

function webhookListenResource(input: {
  readonly bindAddress: string
  readonly preferredPort?: number
  readonly path: string
}): string {
  return `${input.bindAddress}:${String(input.preferredPort ?? 0)}${input.path}`
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringFromUnknown(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function remoteSource(request: LocalHttpRequest): string {
  return request.remoteAddress ?? "local"
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function timingSafeEqualText(a: string, b: string): boolean {
  const aBytes = Buffer.from(a)
  const bBytes = Buffer.from(b)
  if (aBytes.length !== bBytes.length) return false
  try {
    return timingSafeEqual(aBytes, bBytes)
  } catch {
    return false
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function summarizeReturnedAgentError(error: string): string {
  const sanitized = sanitizeWebhookAgentError(error)
  if (!sanitized) return "执行失败"
  const truncated = sanitized.length <= 120 ? sanitized : `${sanitized.slice(0, 120)}...`
  return `执行失败：${truncated}`
}

function sanitizeWebhookAgentError(value: string): string {
  return sanitizeError(value)
}

function sanitizeWebhookShellError(value: string): string {
  return sanitizeError(value) || "failed"
}

function webhookAgentMessageId(body: Record<string, unknown>, runId: string): string {
  return stringValue(body.messageId) ?? runId
}

function agentResultCorrelation(result: Record<string, unknown>): Record<string, string> | undefined {
  const conversationId = stringValue(result.conversationId)
  const sdkSessionId = stringValue(result.sdkSessionId) ?? stringValue(result.agentSessionId)
  if (!conversationId && !sdkSessionId) return undefined
  return {
    ...(conversationId ? { conversationId } : {}),
    ...(sdkSessionId ? { sdkSessionId } : {}),
  }
}

function errorDiagnostic(error: unknown): {
  readonly errorName: string
  readonly errorLength: number
  readonly errorCode?: string
} {
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: errorMessage(error).length,
    ...(error instanceof WebhookError ? { errorCode: error.code } : {}),
  }
}

class WebhookError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}
