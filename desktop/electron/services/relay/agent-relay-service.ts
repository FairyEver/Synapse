import { createHash, randomUUID } from "node:crypto"

import type {
  DataNamespace,
  RelayBindingEntryV1,
  RelayRunEntryV1,
} from "../../runtime/data-repo"
import type { ProjectContainerRegistry } from "../../runtime/project-container"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type { StructuredLogger } from "../../runtime/service-registry"
import {
  AgentRuntimeService,
  AGENT_RUNTIME_SERVICE_ID,
  type AgentMessage,
} from "../agent-runtime"
import type { ReplyTarget } from "../reply-target"
import type { SideChannelService } from "../side-channel"
import type { RelayProjectSummary, RelaySendRequest, RelaySendResult } from "./types"

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_VISIBLE_CHARS = 1200

export interface AgentRelayServiceDeps {
  readonly projectContainers: ProjectContainerRegistry
  readonly bindings: DataNamespace<RelayBindingEntryV1>
  readonly runs: DataNamespace<RelayRunEntryV1>
  readonly listProjects: () => Promise<readonly RelayProjectSummary[]>
  readonly sideChannel?: SideChannelService
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly logger?: StructuredLogger
  readonly now?: () => Date
}

export class AgentRelayService {
  private readonly deps: AgentRelayServiceDeps

  constructor(deps: AgentRelayServiceDeps) {
    this.deps = deps
  }

  async send(request: RelaySendRequest): Promise<RelaySendResult> {
    const source = await this.resolveProject(request.sourceProjectId)
    const target = await this.resolveProject(request.targetProjectId)
    const targetSessionKey = relaySessionKey(request.sourceProjectId, request.sourceSessionKey)
    await this.checkSpawnPermission(request, target.projectId, targetSessionKey)
    const run = await this.createRun(request, targetSessionKey)
    try {
      const container = await this.deps.projectContainers.open(target.projectId, {
        name: target.name,
        workspacePath: target.workspacePath,
        managedKnowledgeBase: target.managedKnowledgeBase,
      })
      const agent = container.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID)
      const message: AgentMessage = {
        projectId: target.projectId,
        sessionKey: targetSessionKey,
        platform: "relay",
        userId: "relay",
        userName: source.name ?? source.projectId,
        content: request.message,
        workspaceKey: request.workspaceKey,
        workspacePath: request.workspacePath,
        replyCtx: {
          kind: "relay",
          muted: true,
          sourceProjectId: source.projectId,
          sourceSessionKey: request.sourceSessionKey,
        },
        createdAt: this.isoNow(),
      }
      const result = await agent.sendSideSessionWithTimeout(
        message,
        `Relay ${source.name ?? source.projectId}`,
        request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      )
      const status = result.timedOut
        ? "timeout"
        : result.error
          ? "failed"
          : "success"
      const failure = result.error ? relayFailureMetadata(result.error) : undefined
      if (failure) {
        this.deps.logger?.warn("Agent relay runtime failed.", {
          boundary: "agent-relay.agent-runtime",
          runId: run.id,
          sourceProjectId: request.sourceProjectId,
          sourceSessionKey: request.sourceSessionKey,
          targetProjectId: request.targetProjectId,
          targetSessionKey,
          errorName: failure.errorName,
          errorLength: failure.errorLength,
        })
      }
      await this.finishRun(run, status, {
        resultText: result.timedOut ? undefined : result.resultText,
        partialText: result.partialText,
        lastError: failure?.summary,
      })
      this.recordAudit(status === "success" ? "allowed" : "failed", request, run.id, targetSessionKey, failure?.summary)
      return {
        ok: true,
        runId: run.id,
        sourceProjectId: request.sourceProjectId,
        targetProjectId: request.targetProjectId,
        targetSessionKey,
        timedOut: result.timedOut,
        resultText: result.timedOut ? undefined : result.resultText,
        partialText: result.partialText,
        error: failure?.summary,
      }
    } catch (error) {
      const failure = relayFailureMetadata(error)
      this.deps.logger?.warn("Agent relay runtime failed.", {
        boundary: "agent-relay.agent-runtime",
        runId: run.id,
        sourceProjectId: request.sourceProjectId,
        sourceSessionKey: request.sourceSessionKey,
        targetProjectId: request.targetProjectId,
        targetSessionKey,
        errorName: failure.errorName,
        errorLength: failure.errorLength,
      })
      await this.finishRun(run, "failed", { lastError: failure.summary })
      this.recordAudit("failed", request, run.id, targetSessionKey, failure.summary)
      if (request.visible) {
        const sourceTarget = this.deps.sideChannel?.getReplyTarget(
          request.sourceProjectId,
          request.sourceSessionKey,
        )
        if (sourceTarget) {
          await this.trySendVisible(sourceTarget, "Relay failed. Check diagnostics.")
        }
      }
      throw error
    }
  }

  async listBindings(sourceProjectId?: string): Promise<readonly RelayBindingEntryV1[]> {
    const filter = sourceProjectId ? { sourceProjectId } as Partial<RelayBindingEntryV1> : undefined
    return this.deps.bindings.list(filter)
  }

  async countBindings(sourceProjectId?: string): Promise<number> {
    const filter = sourceProjectId ? { sourceProjectId } as Partial<RelayBindingEntryV1> : undefined
    return countNamespace(this.deps.bindings, filter)
  }

  async bind(input: {
    readonly sourceProjectId: string
    readonly targetProjectId: string
    readonly sourceSessionKey?: string
    readonly sourceChannelKey?: string
    readonly workspaceKey?: string
    readonly workspacePath?: string
    readonly createdBy?: string
  }): Promise<RelayBindingEntryV1> {
    await this.resolveProject(input.sourceProjectId)
    await this.resolveProject(input.targetProjectId)
    const now = this.isoNow()
    const entry: RelayBindingEntryV1 = {
      id: `relay-binding:${randomUUID()}`,
      schemaVersion: 1,
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.targetProjectId,
      sourceSessionKey: input.sourceSessionKey,
      sourceChannelKey: input.sourceChannelKey,
      workspaceKey: input.workspaceKey,
      workspacePath: input.workspacePath,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
    }
    await this.deps.bindings.upsert(entry)
    return entry
  }

  async unbind(id: string): Promise<boolean> {
    const existing = await this.deps.bindings.get(id)
    if (!existing) return false
    await this.deps.bindings.remove(id)
    return true
  }

  async listRuns(projectId?: string): Promise<readonly RelayRunEntryV1[]> {
    const runs = await this.deps.runs.list()
    const filtered = projectId
      ? runs.filter((run) => run.sourceProjectId === projectId || run.targetProjectId === projectId)
      : runs
    return filtered.map(sanitizeRelayRunForDiagnostics)
  }

  async countRuns(projectId?: string): Promise<number> {
    if (!projectId) return countNamespace(this.deps.runs)
    return (await this.listRuns(projectId)).length
  }

  private async trySendVisible(target: ReplyTarget, message: string): Promise<void> {
    try {
      await this.deps.sideChannel?.send({
        projectId: target.projectId,
        sessionKey: target.sessionKey,
        message: truncate(message),
      })
    } catch (error) {
      const failure = relayFailureMetadata(error)
      this.deps.logger?.warn("Agent relay visible response failed.", {
        boundary: "agent-relay.visible-response",
        sourceProjectId: target.projectId,
        sourceSessionKey: target.sessionKey,
        errorName: failure.errorName,
        errorLength: failure.errorLength,
      })
    }
  }

  private async createRun(
    request: RelaySendRequest,
    targetSessionKey: string,
  ): Promise<RelayRunEntryV1> {
    const now = this.isoNow()
    const run: RelayRunEntryV1 = {
      id: `relay-run:${randomUUID()}`,
      schemaVersion: 1,
      requestId: randomUUID(),
      sourceProjectId: request.sourceProjectId,
      targetProjectId: request.targetProjectId,
      sourceSessionKeyHash: sessionKeyHash(request.sourceProjectId, request.sourceSessionKey),
      targetSessionKeyHash: sessionKeyHash(request.targetProjectId, targetSessionKey),
      status: "running",
      visible: request.visible ?? false,
      startedAt: now,
      metadata: sanitizeRelayMetadata(request.metadata),
      createdAt: now,
      updatedAt: now,
    }
    await this.deps.runs.upsert(run)
    return run
  }

  private async finishRun(
    run: RelayRunEntryV1,
    status: RelayRunEntryV1["status"],
    patch: {
      readonly resultText?: string
      readonly partialText?: string
      readonly lastError?: string
    },
  ): Promise<void> {
    await this.deps.runs.upsert({
      ...run,
      status,
      resultText: patch.resultText,
      partialText: patch.partialText,
      lastError: patch.lastError,
      finishedAt: this.isoNow(),
      updatedAt: this.isoNow(),
    })
  }

  private async resolveProject(projectId: string): Promise<RelayProjectSummary> {
    const project = (await this.deps.listProjects()).find((item) => item.projectId === projectId)
    if (!project) throw new Error(`Project "${projectId}" was not found`)
    return project
  }

  private recordAudit(
    outcome: "allowed" | "failed",
    request: RelaySendRequest,
    runId: string,
    targetSessionKey: string,
    error?: string,
  ): void {
    this.deps.auditSink?.record({
      action: "agent.spawn",
      actor: { kind: "agent", id: "relay" },
      resource: request.targetProjectId,
      outcome,
      metadata: {
        runId,
        sourceProjectId: request.sourceProjectId,
        sourceSessionKey: request.sourceSessionKey,
        targetProjectId: request.targetProjectId,
        targetSessionKey,
        visible: request.visible,
        error,
      },
    })
  }

  private async checkSpawnPermission(
    request: RelaySendRequest,
    targetProjectId: string,
    targetSessionKey: string,
  ): Promise<void> {
    if (!this.deps.permissionGuard) return
    const actor = { kind: "agent" as const, id: "relay" }
    const resource = relayAuditResource(targetProjectId, targetSessionKey)
    const metadata = {
      sourceProjectId: request.sourceProjectId,
      sourceSessionKey: request.sourceSessionKey,
      targetProjectId,
      targetSessionKey,
      visible: request.visible,
    }
    try {
      const permission = await this.deps.permissionGuard.check({
        action: "agent.spawn",
        actor,
        resource,
        context: metadata,
      })
      if (!permission.allowed) {
        this.deps.auditSink?.record({
          action: "agent.spawn",
          actor,
          resource,
          outcome: "denied",
          metadata: {
            ...metadata,
            reason: permission.reason,
            policyId: permission.policyId,
          },
        })
        throw new Error("Agent relay spawn denied by permission policy")
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Agent relay spawn denied by permission policy") {
        throw error
      }
      const failure = relayFailureMetadata(error)
      this.deps.auditSink?.record({
        action: "agent.spawn",
        actor,
        resource,
        outcome: "failed",
        metadata: {
          ...metadata,
          error: failure.summary,
        },
      })
      throw new Error("Agent relay spawn permission check failed")
    }
  }

  private isoNow(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}

function relaySessionKey(sourceProjectId: string, sourceSessionKey: string): string {
  return `relay:${sourceProjectId}:${sourceSessionKey}`
}

function relayAuditResource(targetProjectId: string, targetSessionKey: string): string {
  return `relay:${targetProjectId}:${sessionKeyHash(targetProjectId, targetSessionKey)}`
}

function sessionKeyHash(projectId: string, sessionKey: string): string {
  return createHash("sha256")
    .update(projectId)
    .update("\0")
    .update(sessionKey)
    .digest("hex")
    .slice(0, 16)
}

async function countNamespace<T>(
  namespace: DataNamespace<T>,
  filter?: Partial<T>,
): Promise<number> {
  return namespace.count
    ? namespace.count(filter)
    : (await namespace.list(filter)).length
}

function sanitizeRelayRunForDiagnostics(run: RelayRunEntryV1): RelayRunEntryV1 {
  const sourceSessionKey = typeof run.sourceSessionKey === "string" ? run.sourceSessionKey : undefined
  const targetSessionKey = typeof run.targetSessionKey === "string" ? run.targetSessionKey : undefined
  const sanitized: Record<string, unknown> = { ...run }
  delete sanitized.sourceSessionKey
  delete sanitized.targetSessionKey
  sanitized.sourceSessionKeyHash = typeof run.sourceSessionKeyHash === "string"
    ? run.sourceSessionKeyHash
    : sourceSessionKey
      ? sessionKeyHash(run.sourceProjectId, sourceSessionKey)
      : undefined
  sanitized.targetSessionKeyHash = typeof run.targetSessionKeyHash === "string"
    ? run.targetSessionKeyHash
    : targetSessionKey
      ? sessionKeyHash(run.targetProjectId, targetSessionKey)
      : undefined
  if (run.metadata) sanitized.metadata = sanitizeRelayMetadata(run.metadata)
  if (sanitized.sourceSessionKeyHash === undefined) delete sanitized.sourceSessionKeyHash
  if (sanitized.targetSessionKeyHash === undefined) delete sanitized.targetSessionKeyHash
  return sanitized as RelayRunEntryV1
}

function sanitizeRelayMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined
  return sanitizeRelayValue(metadata, 0) as Record<string, unknown>
}

function sanitizeRelayValue(value: unknown, depth: number): unknown {
  if (depth > 6) return "[truncated]"
  if (Array.isArray(value)) return value.map((item) => sanitizeRelayValue(item, depth + 1))
  if (!value || typeof value !== "object") return value
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSessionKeyField(key) ? "[redacted]" : sanitizeRelayValue(item, depth + 1)
  }
  return output
}

function isSessionKeyField(key: string): boolean {
  return key.replace(/[-_]/g, "").toLowerCase().endsWith("sessionkey")
}

function truncate(value: string): string {
  return value.length <= MAX_VISIBLE_CHARS
    ? value
    : `${value.slice(0, MAX_VISIBLE_CHARS)}\n...`
}

function relayFailureMetadata(error: unknown): {
  readonly errorName: string
  readonly errorLength: number
  readonly summary: string
} {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : String(error)
  const errorName = error instanceof Error ? error.name : typeof error
  return {
    errorName,
    errorLength: message.length,
    summary: `${errorName} (${message.length} chars)`,
  }
}
