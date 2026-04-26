import { randomUUID } from "node:crypto"

import type {
  DataNamespace,
  RelayBindingEntryV1,
  RelayRunEntryV1,
} from "../../runtime/data-repo"
import type { ProjectContainerRegistry } from "../../runtime/project-container"
import type { AuditSink } from "../../runtime/security"
import type { StructuredLogger } from "../../runtime/service-registry"
import {
  AgentRuntimeService,
  AGENT_RUNTIME_SERVICE_ID,
  type AgentMessage,
} from "../agent-runtime"
import type { FeishuConnectorService } from "../connectors"
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
  readonly feishuConnector?: Pick<FeishuConnectorService, "sendAutomationMessage">
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
    const run = await this.createRun(request, targetSessionKey)
    const sourceTarget = this.deps.sideChannel?.getReplyTarget(
      request.sourceProjectId,
      request.sourceSessionKey,
    )

    if (request.visible && sourceTarget) {
      await this.trySendVisible(sourceTarget, `Relay started: ${target.name ?? target.projectId}`)
    }

    try {
      const container = await this.deps.projectContainers.open(target.projectId, {
        name: target.name,
        workspacePath: target.workspacePath,
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
      await this.finishRun(run, status, {
        resultText: result.timedOut ? undefined : result.resultText,
        partialText: result.partialText,
        lastError: result.error,
      })
      this.recordAudit(status === "success" || status === "timeout" ? "allowed" : "failed", request, run.id, result.error)
      if (request.visible && sourceTarget) {
        const visibleText = result.timedOut
          ? result.partialText || "Relay is still running."
          : result.resultText || result.error || "Relay completed."
        await this.trySendVisible(sourceTarget, `Relay result: ${truncate(visibleText)}`)
      }
      return {
        ok: true,
        runId: run.id,
        sourceProjectId: request.sourceProjectId,
        targetProjectId: request.targetProjectId,
        targetSessionKey,
        timedOut: result.timedOut,
        resultText: result.timedOut ? undefined : result.resultText,
        partialText: result.partialText,
        error: result.error,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.finishRun(run, "failed", { lastError: message })
      this.recordAudit("failed", request, run.id, message)
      if (request.visible && sourceTarget) {
        await this.trySendVisible(sourceTarget, `Relay failed: ${truncate(message)}`)
      }
      throw error
    }
  }

  async listBindings(sourceProjectId?: string): Promise<readonly RelayBindingEntryV1[]> {
    const filter = sourceProjectId ? { sourceProjectId } as Partial<RelayBindingEntryV1> : undefined
    return this.deps.bindings.list(filter)
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
    return projectId
      ? runs.filter((run) => run.sourceProjectId === projectId || run.targetProjectId === projectId)
      : runs
  }

  getStatus(): {
    readonly bindingCount: number
    readonly recentRunCount: number
  } {
    return {
      bindingCount: 0,
      recentRunCount: 0,
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
      sourceSessionKey: request.sourceSessionKey,
      targetSessionKey,
      status: "running",
      visible: request.visible ?? false,
      startedAt: now,
      metadata: request.metadata,
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

  private async trySendVisible(target: ReplyTarget, content: string): Promise<void> {
    if (target.transport.kind !== "feishu" || !this.deps.feishuConnector) return
    try {
      await this.deps.feishuConnector.sendAutomationMessage(target, content)
    } catch (error) {
      this.deps.logger?.warn("Relay visible record failed.", {
        error: error instanceof Error ? error.message : String(error),
        projectId: target.projectId,
        sessionKey: target.sessionKey,
      })
    }
  }

  private recordAudit(
    outcome: "allowed" | "failed",
    request: RelaySendRequest,
    runId: string,
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
        visible: request.visible,
        error,
      },
    })
  }

  private isoNow(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}

function relaySessionKey(sourceProjectId: string, sourceSessionKey: string): string {
  return `relay:${sourceProjectId}:${sourceSessionKey}`
}

function truncate(value: string): string {
  return value.length <= MAX_VISIBLE_CHARS
    ? value
    : `${value.slice(0, MAX_VISIBLE_CHARS)}\n...`
}

