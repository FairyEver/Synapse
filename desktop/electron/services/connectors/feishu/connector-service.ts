import type { DataRepository } from "../../../runtime/data-repo"
import type { ProjectContainerRegistry } from "../../../runtime/project-container"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import type { StructuredLogger } from "../../../runtime/service-registry"
import {
  AgentRuntimeService,
  AGENT_RUNTIME_SERVICE_ID,
} from "../../agent-runtime"
import type { SideChannelService } from "../../side-channel"
import { ConnectorRepository } from "../connector-repository"
import type { FeishuConnectorSummary } from "../types"
import {
  FEISHU_CONNECTOR_SERVICE_ID,
  type FeishuCardActionEvent,
  type FeishuClientFactory,
  type FeishuCredentialInput,
  type FeishuReplyContext,
  type FeishuMessageEvent,
  type FeishuRuntimeClient,
  type FeishuSetupBeginResult,
  type FeishuSetupPollResult,
} from "./feishu-types"
import { isFeishuAdmin, normalizeFeishuMessage } from "./message-normalizer"
import { FeishuReplyService } from "./reply-service"
import { FeishuSetupService, secretId } from "./setup-service"
import { feishuSdkClientFactory } from "./sdk-client"

export interface FeishuProjectSummary {
  readonly projectId: string
  readonly name?: string
  readonly workspacePath?: string
}

export interface FeishuConnectorServiceDeps {
  readonly dataRepository: DataRepository
  readonly projectContainers: ProjectContainerRegistry
  readonly sideChannel: SideChannelService
  readonly listProjects: () => Promise<readonly FeishuProjectSummary[]>
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly logger?: StructuredLogger
  readonly clientFactory?: FeishuClientFactory
  readonly setupService?: FeishuSetupService
  readonly connectorRepository?: ConnectorRepository
}

interface RunningFeishuConnector {
  readonly projectId: string
  readonly connectorId: string
  readonly client: FeishuRuntimeClient
  botOpenId?: string
}

export interface FeishuConnectorRuntimeStatus {
  readonly projectId: string
  readonly configured: boolean
  readonly running: boolean
  readonly connector?: FeishuConnectorSummary
}

export class FeishuConnectorService {
  private readonly deps: FeishuConnectorServiceDeps
  private readonly connectorRepository: ConnectorRepository
  private readonly setupService: FeishuSetupService
  private readonly clientFactory: FeishuClientFactory
  private readonly running = new Map<string, RunningFeishuConnector>()
  private unregisterDispatcher: (() => void) | undefined

  constructor(deps: FeishuConnectorServiceDeps) {
    this.deps = deps
    this.connectorRepository = deps.connectorRepository ?? new ConnectorRepository({
      connectors: deps.dataRepository.namespace("connectors"),
    })
    this.setupService = deps.setupService ?? new FeishuSetupService({
      dataRepository: deps.dataRepository,
      connectorRepository: this.connectorRepository,
      permissionGuard: deps.permissionGuard,
      auditSink: deps.auditSink,
      logger: deps.logger,
    })
    this.clientFactory = deps.clientFactory ?? feishuSdkClientFactory
  }

  start(): void {
    if (this.unregisterDispatcher) return
    const replyService = new FeishuReplyService({
      clientForConnector: (connectorId) => this.running.get(connectorId)?.client,
      permissionGuard: this.deps.permissionGuard,
      auditSink: this.deps.auditSink,
      logger: this.deps.logger,
    })
    this.unregisterDispatcher = this.deps.sideChannel.registerDispatcher("feishu", replyService)
  }

  async stop(): Promise<void> {
    this.unregisterDispatcher?.()
    this.unregisterDispatcher = undefined
    await Promise.all([...this.running.values()].map((entry) => this.stopProject(entry.projectId)))
  }

  beginSetup(projectId: string): Promise<FeishuSetupBeginResult> {
    return this.setupService.beginSetup(projectId)
  }

  pollSetup(setupId: string): Promise<FeishuSetupPollResult> {
    return this.setupService.pollSetup(setupId)
  }

  saveSetup(setupId: string): Promise<FeishuConnectorSummary> {
    return this.setupService.saveSetup(setupId)
  }

  saveManualCredentials(input: FeishuCredentialInput): Promise<FeishuConnectorSummary> {
    return this.setupService.saveManualCredentials(input)
  }

  async list(projectId?: string): Promise<FeishuConnectorSummary[]> {
    const connectors = await this.connectorRepository.list(projectId)
    return connectors
      .filter((connector) => connector.platform === "feishu")
      .map((connector) => this.connectorRepository.toFeishuSummary(connector))
  }

  async getStatus(projectId: string): Promise<FeishuConnectorRuntimeStatus> {
    const connector = await this.connectorRepository.getByProject(projectId, "feishu")
    return {
      projectId,
      configured: Boolean(connector?.secretRef),
      running: connector ? this.running.has(connector.id) : false,
      connector: connector ? this.connectorRepository.toFeishuSummary(connector) : undefined,
    }
  }

  async startProject(projectId: string): Promise<FeishuConnectorRuntimeStatus> {
    const connector = await this.connectorRepository.getByProject(projectId, "feishu")
    if (!connector?.secretRef) {
      throw new Error("飞书连接器尚未配置。")
    }
    const existing = this.running.get(connector.id)
    if (existing) return this.getStatus(projectId)

    await this.checkNetworkPermission(projectId, connector.id)
    await this.connectorRepository.updateStatus(connector.id, "connecting")
    const secret = await this.setupService.readSecret(projectId)
    if (!secret) throw new Error("飞书凭据不存在。")

    const client = this.clientFactory.create({
      appId: secret.appId,
      appSecret: secret.appSecret,
      logger: this.deps.logger,
    })
    const running: RunningFeishuConnector = {
      projectId,
      connectorId: connector.id,
      client,
    }

    try {
      running.botOpenId = await client.fetchBotOpenId().catch((error) => {
        this.deps.logger?.warn("Failed to fetch Feishu bot identity.", {
          error: error instanceof Error ? error.message : String(error),
          projectId,
        })
        return undefined
      })
      await client.start({
        onMessage: (event) => this.handleMessage(projectId, connector.id, event),
        onCardAction: (event) => this.handleCardAction(event),
        onError: (error) => {
          void this.markDegraded(connector.id, error)
        },
        onReconnecting: () => {
          void this.connectorRepository.updateStatus(connector.id, "degraded")
        },
        onReconnected: () => {
          void this.connectorRepository.updateStatus(connector.id, "connected", {
            lastConnectedAt: new Date().toISOString(),
          })
        },
      })
      this.running.set(connector.id, running)
      await this.connectorRepository.updateStatus(connector.id, "connected", {
        lastConnectedAt: new Date().toISOString(),
      })
      this.recordAudit("allowed", projectId, connector.id, "start")
      return this.getStatus(projectId)
    } catch (error) {
      await this.markError(connector.id, error)
      this.recordAudit("failed", projectId, connector.id, "start", error)
      throw error
    }
  }

  async stopProject(projectId: string): Promise<FeishuConnectorRuntimeStatus> {
    const connector = await this.connectorRepository.getByProject(projectId, "feishu")
    if (!connector) {
      return { projectId, configured: false, running: false }
    }
    const running = this.running.get(connector.id)
    if (running) {
      await running.client.stop()
      this.running.delete(connector.id)
    }
    await this.connectorRepository.updateStatus(connector.id, "disabled")
    this.recordAudit("allowed", projectId, connector.id, "stop")
    return this.getStatus(projectId)
  }

  async handleMessage(
    projectId: string,
    connectorId: string,
    event: FeishuMessageEvent,
  ): Promise<void> {
    const connector = await this.connectorRepository.get(connectorId)
    if (!connector) return
    const running = this.running.get(connectorId)
    const normalized = normalizeFeishuMessage({
      projectId,
      connector,
      botOpenId: running?.botOpenId,
      event,
    })
    if (normalized.kind === "ignored") {
      if (normalized.dedupe) await this.connectorRepository.updateDedupe(connectorId, normalized.dedupe)
      this.recordAudit("denied", projectId, connectorId, "message", undefined, {
        reason: normalized.reason,
      })
      return
    }

    await this.connectorRepository.updateDedupe(connectorId, normalized.dedupe)
    try {
      const { agent } = await this.resolveProjectAgent(projectId)
      await agent.send(normalized.message)
      this.recordAudit("allowed", projectId, connectorId, "message", undefined, {
        sessionKey: normalized.message.sessionKey,
        messageId: normalized.message.messageId,
      })
    } catch (error) {
      await this.markDegraded(connectorId, error)
      this.recordAudit("failed", projectId, connectorId, "message", error)
      await running?.client.replyText(
        normalized.message.replyCtx as FeishuReplyContext,
        error instanceof Error ? error.message : String(error),
      ).catch((replyError) => {
        this.deps.logger?.warn("Failed to send Feishu error reply.", {
          error: replyError instanceof Error ? replyError.message : String(replyError),
          projectId,
          connectorId,
        })
      })
    }
  }

  async handleCardAction(event: FeishuCardActionEvent): Promise<void> {
    const value = actionValue(event.action?.value)
    const requestId = stringValue(value.requestId)
    const behavior = value.behavior === "allow" || value.behavior === "deny"
      ? value.behavior
      : undefined
    const projectId = stringValue(value.projectId)
    const connectorId = stringValue(value.connectorId)
    const operatorOpenId = stringValue(event.operator?.open_id)
    if (!requestId || !behavior || !projectId || !connectorId || !operatorOpenId) {
      throw new Error("飞书卡片操作缺少必要字段。")
    }
    const connector = await this.connectorRepository.get(connectorId)
    if (!connector || connector.projectId !== projectId) {
      throw new Error("飞书连接器不存在。")
    }
    if (!isFeishuAdmin(connector, operatorOpenId)) {
      this.recordAudit("denied", projectId, connectorId, "card_action", undefined, {
        requestId,
        operatorOpenId,
        reason: "operator_not_allowed",
      })
      throw new Error("当前飞书用户无权处理该权限请求。")
    }
    const { agent } = await this.resolveProjectAgent(projectId)
    await agent.respondPermission({
      requestId,
      behavior,
      actor: { kind: "user", id: `feishu:${operatorOpenId}` },
    })
    this.recordAudit("allowed", projectId, connectorId, "card_action", undefined, {
      requestId,
      behavior,
      operatorOpenId,
    })
  }

  private async resolveProjectAgent(projectId: string): Promise<{
    readonly agent: AgentRuntimeService
  }> {
    const project = await this.resolveProject(projectId)
    const container = await this.deps.projectContainers.open(project.projectId, {
      name: project.name,
      workspacePath: project.workspacePath,
    })
    return {
      agent: container.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID),
    }
  }

  private async resolveProject(projectId: string): Promise<FeishuProjectSummary> {
    const projects = await this.deps.listProjects()
    const project = projects.find((item) => item.projectId === projectId)
    if (!project) throw new Error("项目不存在。")
    return project
  }

  private async checkNetworkPermission(projectId: string, connectorId: string): Promise<void> {
    const permission = await this.deps.permissionGuard?.check({
      action: "network.connect",
      actor: { kind: "user" },
      resource: "feishu:websocket",
      context: {
        projectId,
        connectorId,
        secretRef: secretId(projectId),
      },
    })
    if (permission && !permission.allowed) {
      this.recordAudit("denied", projectId, connectorId, "start", undefined, {
        reason: permission.reason,
        policyId: permission.policyId,
      })
      throw new Error(permission.reason)
    }
  }

  private async markDegraded(connectorId: string, error: unknown): Promise<void> {
    await this.connectorRepository.updateStatus(connectorId, "degraded", {
      lastError: error instanceof Error ? error.message : String(error),
    })
  }

  private async markError(connectorId: string, error: unknown): Promise<void> {
    const existing = await this.connectorRepository.get(connectorId)
    await this.connectorRepository.update(connectorId, {
      status: "error",
      reconnect: {
        attempts: (existing?.reconnect?.attempts ?? 0) + 1,
        lastError: error instanceof Error ? error.message : String(error),
      },
    })
  }

  private recordAudit(
    outcome: "allowed" | "denied" | "failed",
    projectId: string,
    connectorId: string,
    action: string,
    error?: unknown,
    metadata: Record<string, unknown> = {},
  ): void {
    this.deps.auditSink?.record({
      action: action === "message" || action === "card_action" ? "agent.spawn" : "network.connect",
      actor: { kind: "connector", id: connectorId },
      resource: "feishu-connector",
      outcome,
      metadata: {
        projectId,
        connectorId,
        feishuAction: action,
        error: error instanceof Error ? error.message : error ? String(error) : undefined,
        ...metadata,
      },
    })
  }
}

export { FEISHU_CONNECTOR_SERVICE_ID }

function actionValue(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  }
  return {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}
