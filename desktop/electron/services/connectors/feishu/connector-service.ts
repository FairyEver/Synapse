import path from "node:path"
import { createHash } from "node:crypto"
import { homedir } from "node:os"

import type { DataRepository } from "../../../runtime/data-repo"
import type { ConnectorWorkspaceConfigV1, WorkspaceBindingEntryV1 } from "../../../runtime/data-repo"
import type { ProjectContainerRegistry } from "../../../runtime/project-container"
import type {
  ActorIdentity,
  AuditSink,
  PermissionAction,
  PermissionGuard,
} from "../../../runtime/security"
import type { StructuredLogger } from "../../../runtime/service-registry"
import { createControlledProcessRunner } from "../../../runtime/process"
import {
  AgentRuntimeService,
  AGENT_RUNTIME_SERVICE_ID,
  type AgentMessage,
} from "../../agent-runtime"
import type { ReplyTarget } from "../../reply-target"
import type { AgentRelayService } from "../../relay"
import type { SideChannelService } from "../../side-channel"
import { ConnectorRepository } from "../connector-repository"
import type { ConnectorRecord, FeishuConnectorSummary } from "../types"
import {
  FEISHU_CONNECTOR_SERVICE_ID,
  type FeishuCardActionEvent,
  type FeishuCardActionResponse,
  type FeishuClientFactory,
  type FeishuCredentialInput,
  type FeishuReplyContext,
  type FeishuMessageEvent,
  type FeishuRuntimeClient,
  type FeishuSetupBeginResult,
  type FeishuSetupPollResult,
} from "./feishu-types"
import { isFeishuAdmin, normalizeFeishuMessage } from "./message-normalizer"
import { FeishuReplyService, feishuReplyContext } from "./reply-service"
import { FeishuSetupService, secretId } from "./setup-service"
import { feishuSdkClientFactory } from "./sdk-client"
import {
  WorkspaceBindingRepository,
  isDirectory,
  normalizeWorkspacePath,
  type WorkspaceBindingScope,
} from "../../workspaces"

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
  readonly workspaceBindingRepository?: WorkspaceBindingRepository
  readonly gitClone?: (input: {
    readonly repoUrl: string
    readonly destination: string
    readonly baseDir: string
    readonly actor: ActorIdentity
    readonly projectId: string
    readonly connectorId: string
  }) => Promise<void>
}

interface RunningFeishuConnector {
  readonly projectId: string
  readonly connectorId: string
  readonly client: FeishuRuntimeClient
  botOpenId?: string
}

interface WorkspaceInitFlow {
  readonly channelName?: string
  state: "awaiting_target" | "awaiting_confirm"
  repoUrl?: string
  cloneTo?: string
}

type WorkspaceResolution =
  | {
      readonly status: "resolved"
      readonly channelKey: string
      readonly channelName?: string
      readonly workspacePath: string
      readonly bindingScope?: WorkspaceBindingScope
    }
  | {
      readonly status: "unresolved"
      readonly channelKey: string
      readonly channelName?: string
    }
  | {
      readonly status: "invalid"
      readonly channelKey: string
      readonly reason: string
    }

export interface FeishuConnectorRuntimeStatus {
  readonly projectId: string
  readonly configured: boolean
  readonly running: boolean
  readonly connector?: FeishuConnectorSummary
}

export type FeishuWorkspaceConfig = ConnectorWorkspaceConfigV1

export interface FeishuWorkspaceConfigUpdate {
  readonly projectId: string
  readonly enabled: boolean
  readonly baseDir?: string
  readonly autoBindByChannelName?: boolean
  readonly idleTimeoutMs?: number
}

export interface FeishuWorkspaceBindingsSummary {
  readonly project: readonly WorkspaceBindingEntryV1[]
  readonly shared: readonly WorkspaceBindingEntryV1[]
}

export interface FeishuWorkspaceRouteInput {
  readonly projectId: string
  readonly scope: WorkspaceBindingScope
  readonly channelKey: string
  readonly workspacePath: string
  readonly channelName?: string
}

export interface FeishuWorkspaceUnbindInput {
  readonly projectId: string
  readonly scope: WorkspaceBindingScope
  readonly channelKey: string
}

export class FeishuConnectorService {
  private readonly deps: FeishuConnectorServiceDeps
  private readonly connectorRepository: ConnectorRepository
  private readonly setupService: FeishuSetupService
  private readonly clientFactory: FeishuClientFactory
  private readonly workspaceBindings: WorkspaceBindingRepository
  private readonly running = new Map<string, RunningFeishuConnector>()
  private readonly initFlows = new Map<string, WorkspaceInitFlow>()
  private readonly workspaceReapers = new Map<string, ReturnType<typeof setInterval>>()
  private replyService: FeishuReplyService | undefined
  private relayService: Pick<AgentRelayService, "bind" | "listBindings" | "send" | "unbind"> | undefined
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
    this.workspaceBindings = deps.workspaceBindingRepository ?? new WorkspaceBindingRepository({
      bindings: deps.dataRepository.namespace("workspace.bindings"),
    })
  }

  start(): void {
    if (this.unregisterDispatcher) return
    const replyService = this.getReplyService()
    this.unregisterDispatcher = this.deps.sideChannel.registerDispatcher("feishu", replyService)
  }

  registerRelayService(service: Pick<AgentRelayService, "bind" | "listBindings" | "send" | "unbind">): void {
    this.relayService = service
  }

  assertReplyTargetAvailable(target: ReplyTarget): void {
    const ctx = feishuReplyContext(target)
    if (!this.running.has(ctx.connectorId)) {
      throw new Error(`Feishu connector "${ctx.connectorId}" is not running`)
    }
  }

  sendAutomationMessage(target: ReplyTarget, content: string): Promise<void> {
    return this.getReplyService().dispatchSideChannelSend(target, {
      message: content,
      attachments: [],
    })
  }

  private getReplyService(): FeishuReplyService {
    if (this.replyService) return this.replyService
    this.replyService = new FeishuReplyService({
      clientForConnector: (connectorId) => this.running.get(connectorId)?.client,
      permissionGuard: this.deps.permissionGuard,
      auditSink: this.deps.auditSink,
      logger: this.deps.logger,
    })
    return this.replyService
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

  async getWorkspaceConfig(projectId: string): Promise<FeishuWorkspaceConfig> {
    const connector = await this.connectorRepository.getByProject(projectId, "feishu")
    return normalizeWorkspaceConfig(connector?.workspaceConfig)
  }

  async updateWorkspaceConfig(
    input: FeishuWorkspaceConfigUpdate,
  ): Promise<FeishuWorkspaceConfig> {
    const config = normalizeWorkspaceConfig(input)
    if (config.enabled) {
      if (!config.baseDir) throw new Error("请填写工作区目录。")
      await this.checkPathPermission({
        action: "fs.read.outside-userdata",
        actor: { kind: "user" },
        resource: config.baseDir,
        projectId: input.projectId,
        connectorId: `feishu:${input.projectId}`,
        feishuAction: "workspace_config",
      })
      if (!await isDirectory(config.baseDir)) {
        throw new Error("工作区目录不存在。")
      }
      config.baseDir = await normalizeWorkspacePath(config.baseDir)
    }
    const existing = await this.connectorRepository.getByProject(input.projectId, "feishu")
    if (existing) {
      await this.connectorRepository.update(existing.id, { workspaceConfig: config })
      if (this.running.has(existing.id)) {
        this.installWorkspaceReaper(existing.id, input.projectId, config)
      }
      return config
    }
    await this.connectorRepository.create({
      projectId: input.projectId,
      platform: "feishu",
      status: "disabled",
      workspaceConfig: config,
    })
    return config
  }

  async listWorkspaceBindings(projectId: string): Promise<FeishuWorkspaceBindingsSummary> {
    return {
      project: await this.workspaceBindings.listProject(projectId),
      shared: await this.workspaceBindings.listShared(),
    }
  }

  async routeWorkspaceBinding(
    input: FeishuWorkspaceRouteInput,
  ): Promise<WorkspaceBindingEntryV1> {
    const actor: ActorIdentity = { kind: "user" }
    await this.checkPathPermission({
      action: "fs.read.outside-userdata",
      actor,
      resource: input.workspacePath,
      projectId: input.projectId,
      connectorId: `feishu:${input.projectId}`,
      feishuAction: "workspace_route",
    })
    if (!await isDirectory(input.workspacePath)) {
      throw new Error("工作区目录不存在。")
    }
    return this.workspaceBindings.bind({
      projectId: input.scope === "project" ? input.projectId : undefined,
      scope: input.scope,
      platform: "feishu",
      channelKey: input.channelKey,
      channelName: input.channelName,
      workspacePath: input.workspacePath,
      boundBy: "settings",
    })
  }

  async unbindWorkspaceBinding(input: FeishuWorkspaceUnbindInput): Promise<{ ok: true }> {
    await this.workspaceBindings.unbind(
      input.scope,
      input.channelKey,
      input.scope === "project" ? input.projectId : undefined,
    )
    return { ok: true }
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
          void this.markDegraded(connector.id, error).catch((markError) => {
            this.deps.logger?.warn("Failed to mark Feishu connector degraded.", {
              connectorId: connector.id,
              projectId,
              errorName: markError instanceof Error ? markError.name : typeof markError,
              errorLength: (markError instanceof Error ? markError.message : String(markError)).length,
            })
          })
        },
        onReconnecting: () => {
          void this.connectorRepository.updateStatus(connector.id, "degraded").catch((error) => {
            this.deps.logger?.warn("Failed to mark Feishu connector reconnecting.", {
              connectorId: connector.id,
              projectId,
              errorName: error instanceof Error ? error.name : typeof error,
              errorLength: (error instanceof Error ? error.message : String(error)).length,
            })
          })
        },
        onReconnected: () => {
          void this.connectorRepository.updateStatus(connector.id, "connected", {
            lastConnectedAt: new Date().toISOString(),
          }).catch((error) => {
            this.deps.logger?.warn("Failed to mark Feishu connector reconnected.", {
              connectorId: connector.id,
              projectId,
              errorName: error instanceof Error ? error.name : typeof error,
              errorLength: (error instanceof Error ? error.message : String(error)).length,
            })
          })
        },
      })
      this.running.set(connector.id, running)
      await this.connectorRepository.updateStatus(connector.id, "connected", {
        lastConnectedAt: new Date().toISOString(),
      })
      this.installWorkspaceReaper(connector.id, projectId, connector.workspaceConfig)
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
    this.clearWorkspaceReaper(connector.id)
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
    let normalized = normalizeFeishuMessage({
      projectId,
      connector,
      botOpenId: running?.botOpenId,
      event,
    })
    if (normalized.kind === "ignored") {
      this.deps.logger?.info("Feishu message ignored before agent routing.", {
        ...rawFeishuEventLogContext(projectId, connectorId, event),
        reason: normalized.reason,
      })
      if (normalized.dedupe) await this.connectorRepository.updateDedupe(connectorId, normalized.dedupe)
      this.recordAudit("denied", projectId, connectorId, "message", undefined, {
        reason: normalized.reason,
      })
      return
    }
    this.deps.logger?.info("Feishu message normalized for agent routing.", feishuMessageLogContext(
      projectId,
      connectorId,
      normalized.message,
    ))

    await this.connectorRepository.updateDedupe(connectorId, normalized.dedupe)
    const stopProcessingIndicator = await this.startProcessingIndicator(projectId, connectorId, normalized.message, running)
    try {
      const workspaceConfig = normalizeWorkspaceConfig(connector.workspaceConfig)
      this.deps.logger?.info("Feishu workspace config checked for routing.", {
        ...feishuMessageLogContext(projectId, connectorId, normalized.message),
        workspaceEnabled: workspaceConfig.enabled,
        hasBaseDir: Boolean(workspaceConfig.baseDir),
        autoBindByChannelName: workspaceConfig.autoBindByChannelName,
      })
      if (workspaceConfig.enabled) {
        if (!workspaceConfig.baseDir) {
          await running?.client.replyText(
            normalized.message.replyCtx as FeishuReplyContext,
            "请先设置工作区目录。",
          )
          return
        }
        if (await this.handleWorkspaceCommand(connector, normalized.message, running)) {
          return
        }
        const resolved = await this.resolveWorkspace(projectId, connector.id, normalized.message, workspaceConfig)
        if (resolved.status === "invalid") {
          await running?.client.replyText(
            normalized.message.replyCtx as FeishuReplyContext,
            resolved.reason,
          )
          return
        }
        if (resolved.status === "unresolved") {
          this.deps.logger?.info("Feishu workspace unresolved before agent routing.", {
            ...feishuMessageLogContext(projectId, connector.id, normalized.message),
            workspaceResolution: resolved.status,
            resolvedChannelKey: resolved.channelKey,
            resolvedChannelName: resolved.channelName,
          })
          if (isAutomationCommand(normalized.message.content)) {
            if (await this.handleAutomationCommand(connector, normalized.message, running)) {
              return
            }
          }
          if (await this.handleWorkspaceInitFlow(connector, normalized.message, workspaceConfig, running)) {
            return
          }
        } else if (resolved.status === "resolved") {
          this.deps.logger?.info("Feishu workspace resolved for agent routing.", {
            ...feishuMessageLogContext(projectId, connector.id, normalized.message),
            workspaceResolution: resolved.status,
            resolvedChannelKey: resolved.channelKey,
            resolvedChannelName: resolved.channelName,
            bindingScope: resolved.bindingScope,
          })
          normalized = {
            ...normalized,
            message: {
              ...normalized.message,
              workspaceKey: workspaceKeyForPath(resolved.workspacePath),
              workspacePath: resolved.workspacePath,
              channelKey: resolved.channelKey,
              channelName: resolved.channelName,
            },
          }
        }
      }
      if (await this.handleAutomationCommand(connector, normalized.message, running)) {
        return
      }
      const { agent } = await this.resolveProjectAgent(projectId)
      const agentMessage = {
        ...normalized.message,
        replyCtx: {
          ...(normalized.message.replyCtx as Record<string, unknown>),
          isAdmin: isFeishuAdmin(connector, normalized.message.userId ?? ""),
        },
      }
      const result = await agent.send(agentMessage)
      this.deps.logger?.info("Feishu message routed to AgentRuntime.", {
        ...feishuMessageLogContext(projectId, connectorId, agentMessage),
        conversationId: result.conversationId,
        eventCount: result.events.length,
        resultLength: result.resultText.length,
        error: result.error,
      })
      this.recordAudit("allowed", projectId, connectorId, "message", undefined, {
        sessionKey: agentMessage.sessionKey,
        messageId: agentMessage.messageId,
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
    } finally {
      await stopProcessingIndicator()
    }
  }

  private async startProcessingIndicator(
    projectId: string,
    connectorId: string,
    message: AgentMessage,
    running: RunningFeishuConnector | undefined,
  ): Promise<() => Promise<void>> {
    const messageId = message.messageId
    const client = running?.client
    if (!messageId || !client?.addReaction) return async () => {}
    const reactionId = await client.addReaction(messageId, "OnIt").catch((error) => {
      this.deps.logger?.warn("Failed to add Feishu processing reaction.", {
        error: error instanceof Error ? error.message : String(error),
        projectId,
        connectorId,
        messageId: message.messageId,
      })
      return undefined
    })
    const removeReaction = client.removeReaction?.bind(client)
    if (!reactionId || !removeReaction) return async () => {}
    return async () => {
      await removeReaction(messageId, reactionId).catch((error) => {
        this.deps.logger?.warn("Failed to remove Feishu processing reaction.", {
          error: error instanceof Error ? error.message : String(error),
          projectId,
          connectorId,
          messageId,
        })
      })
    }
  }

  private async resolveWorkspace(
    projectId: string,
    connectorId: string,
    message: AgentMessage,
    config: FeishuWorkspaceConfig,
  ): Promise<WorkspaceResolution> {
    const channelKey = message.channelKey
    if (!channelKey) {
      return { status: "invalid", channelKey: "", reason: "缺少飞书频道信息。" }
    }
    const found = await this.workspaceBindings.lookupEffective(projectId, channelKey)
    if (found) {
      if (await isDirectory(found.binding.workspacePath)) {
        return {
          status: "resolved",
          channelKey,
          channelName: found.binding.channelName,
          workspacePath: await normalizeWorkspacePath(found.binding.workspacePath),
          bindingScope: found.scope,
        }
      }
      if (found.scope === "project") {
        await this.workspaceBindings.unbind("project", channelKey, projectId)
        this.recordAudit("denied", projectId, connectorId, "workspace_missing", undefined, {
          channelKey,
          workspacePath: found.binding.workspacePath,
          bindingScope: found.scope,
        })
        return {
          status: "unresolved",
          channelKey,
          channelName: found.binding.channelName,
        }
      }
      return {
        status: "invalid",
        channelKey,
        reason: `绑定的工作区不存在：${found.binding.workspacePath}`,
      }
    }

    const channelName = message.channelName
    if (config.autoBindByChannelName && config.baseDir && channelName) {
      const candidate = path.join(config.baseDir, channelName)
      if (await isDirectory(candidate)) {
        const binding = await this.workspaceBindings.bind({
          projectId,
          scope: "project",
          platform: "feishu",
          channelKey,
          channelName,
          workspacePath: candidate,
          baseDir: config.baseDir,
          boundBy: message.userId ? `feishu:${message.userId}` : undefined,
        })
        this.recordAudit("allowed", projectId, connectorId, "workspace_auto_bind", undefined, {
          channelKey,
          channelName,
          workspacePath: binding.workspacePath,
        })
        return {
          status: "resolved",
          channelKey,
          channelName,
          workspacePath: binding.workspacePath,
          bindingScope: "project",
        }
      }
    }

    return { status: "unresolved", channelKey, channelName }
  }

  private async handleWorkspaceCommand(
    connector: ConnectorRecord,
    message: AgentMessage,
    running: RunningFeishuConnector | undefined,
  ): Promise<boolean> {
    const parsed = parseWorkspaceCommand(message.content)
    if (!parsed) return false
    const config = normalizeWorkspaceConfig(connector.workspaceConfig)
    const reply = (content: string) =>
      running?.client.replyText(message.replyCtx as FeishuReplyContext, content)
    if (!config.enabled || !config.baseDir) {
      await reply("多工作区未启用。")
      return true
    }
    const channelKey = message.channelKey
    if (!channelKey) {
      await reply("缺少飞书频道信息。")
      return true
    }

    const actor: ActorIdentity = { kind: "user", id: `feishu:${message.userId ?? "unknown"}` }
    const [first, second, ...rest] = parsed.args
    const shared = first === "shared"
    const subCommand = shared ? second : first
    const args = shared ? rest : parsed.args.slice(1)
    const scope: WorkspaceBindingScope = shared ? "shared" : "project"
    const projectId = connector.projectId
    const connectorId = connector.id

    if (!subCommand) {
      const binding = shared
        ? await this.workspaceBindings.get("shared", channelKey)
        : await this.workspaceBindings.lookupEffective(projectId, channelKey).then((item) => item?.binding ?? null)
      await reply(binding ? `工作区：${binding.workspacePath}` : "未绑定工作区。")
      return true
    }

    if (subCommand === "list") {
      const bindings = shared
        ? await this.workspaceBindings.listShared()
        : await this.workspaceBindings.listProject(projectId)
      await reply(formatBindingList(bindings, shared ? "shared" : "project"))
      return true
    }

    if (!isFeishuAdmin(connector, message.userId ?? "")) {
      this.recordAudit("denied", projectId, connectorId, "workspace_command", undefined, {
        command: subCommand,
        channelKey,
        reason: "operator_not_allowed",
      })
      await reply("当前飞书用户无权修改工作区绑定。")
      return true
    }

    switch (subCommand) {
      case "bind": {
        const workspaceName = args[0]
        if (!workspaceName) {
          await reply("用法：/workspace bind <workspace-name>")
          return true
        }
        const workspacePath = path.join(config.baseDir, workspaceName)
        if (!await isDirectory(workspacePath)) {
          await reply("工作区不存在。")
          return true
        }
        const binding = await this.workspaceBindings.bind({
          projectId: scope === "project" ? projectId : undefined,
          scope,
          platform: "feishu",
          channelKey,
          channelName: message.channelName,
          workspacePath,
          baseDir: config.baseDir,
          boundBy: actor.id,
        })
        this.recordAudit("allowed", projectId, connectorId, "workspace_bind", undefined, {
          channelKey,
          workspacePath: binding.workspacePath,
          scope,
        })
        await reply(`已绑定：${binding.workspacePath}`)
        return true
      }
      case "route": {
        const routePath = args.join(" ").trim()
        if (!routePath) {
          await reply("用法：/workspace route <absolute-path>")
          return true
        }
        if (!path.isAbsolute(routePath)) {
          await reply("请使用绝对路径。")
          return true
        }
        const binding = await this.bindLocalPath({
          projectId,
          connectorId,
          actor,
          scope,
          channelKey,
          channelName: message.channelName,
          workspacePath: routePath,
          baseDir: config.baseDir,
        })
        await reply(`已绑定：${binding.workspacePath}`)
        return true
      }
      case "init": {
        const target = args.join(" ").trim()
        if (!target) {
          await reply("用法：/workspace init <local-dir-or-git-url>")
          return true
        }
        const binding = await this.initializeWorkspaceTarget({
          projectId,
          connectorId,
          actor,
          scope,
          channelKey,
          channelName: message.channelName,
          target,
          baseDir: config.baseDir,
        })
        await reply(`已绑定：${binding.workspacePath}`)
        return true
      }
      case "unbind": {
        const removed = await this.workspaceBindings.unbind(
          scope,
          channelKey,
          scope === "project" ? projectId : undefined,
        )
        this.recordAudit("allowed", projectId, connectorId, "workspace_unbind", undefined, {
          channelKey,
          scope,
          removed,
        })
        await reply(removed ? "已解绑。" : "没有可解绑的工作区。")
        return true
      }
      default:
        await reply("用法：/workspace [bind|route|init|unbind|list|shared]")
        return true
    }
  }

  private async handleAutomationCommand(
    connector: ConnectorRecord,
    message: AgentMessage,
    running: RunningFeishuConnector | undefined,
  ): Promise<boolean> {
    if (!isAutomationCommand(message.content)) return false
    const reply = (content: string) =>
      running?.client.replyText(message.replyCtx as FeishuReplyContext, content)
    const isAdmin = isFeishuAdmin(connector, message.userId ?? "")
    if (this.relayService && await this.handleRelayCommand(connector, message, isAdmin, reply)) {
      this.recordAudit("allowed", connector.projectId, connector.id, "relay_command", undefined, {
        sessionKey: message.sessionKey,
        userId: message.userId,
      })
      return true
    }
    await reply("Relay 不可用。")
    return true
  }

  private async handleRelayCommand(
    connector: ConnectorRecord,
    message: AgentMessage,
    isAdmin: boolean,
    reply: (content: string) => Promise<void> | void | undefined,
  ): Promise<boolean> {
    const parsed = parseRelayCommand(message.content)
    if (!parsed) return false
    if (!this.relayService) {
      await reply("Relay 不可用。")
      return true
    }
    const [subCommand, ...args] = parsed.args
    switch ((subCommand ?? "list").toLowerCase()) {
      case "list": {
        const bindings = await this.relayService.listBindings(connector.projectId)
        await reply(bindings.length > 0
          ? bindings.map((binding) => `${binding.id} -> ${binding.targetProjectId}`).join("\n")
          : "Relay 绑定为空。")
        return true
      }
      case "bind": {
        if (!isAdmin) {
          await reply("当前飞书用户无权修改 Relay 绑定。")
          return true
        }
        const targetProjectId = args[0]
        if (!targetProjectId) {
          await reply("用法：/relay bind <project-id>")
          return true
        }
        const binding = await this.relayService.bind({
          sourceProjectId: connector.projectId,
          targetProjectId,
          sourceSessionKey: message.sessionKey,
          sourceChannelKey: message.channelKey,
          workspaceKey: message.workspaceKey,
          workspacePath: message.workspacePath,
          createdBy: message.userId,
        })
        await reply(`已绑定：${binding.targetProjectId}`)
        return true
      }
      case "unbind": {
        if (!isAdmin) {
          await reply("当前飞书用户无权修改 Relay 绑定。")
          return true
        }
        const bindingId = args[0]
        if (!bindingId) {
          await reply("用法：/relay unbind <binding-id>")
          return true
        }
        const removed = await this.relayService.unbind(bindingId)
        await reply(removed ? "已解绑。" : "未找到绑定。")
        return true
      }
      case "send": {
        const targetProjectId = args[0]
        const relayMessage = args.slice(1).join(" ").trim()
        if (!targetProjectId || !relayMessage) {
          await reply("用法：/relay send <project-id> <message>")
          return true
        }
        const result = await this.relayService.send({
          sourceProjectId: connector.projectId,
          sourceSessionKey: message.sessionKey,
          targetProjectId,
          message: relayMessage,
          workspaceKey: message.workspaceKey,
          workspacePath: message.workspacePath,
          visible: true,
        })
        if (!result.timedOut && result.resultText) {
          await reply(result.resultText)
        } else if (result.timedOut) {
          await reply(result.partialText || "Relay 仍在运行。")
        } else if (result.error) {
          await reply(result.error)
        }
        return true
      }
      default:
        await reply("用法：/relay list|bind|unbind|send")
        return true
    }
  }

  private async handleWorkspaceInitFlow(
    connector: ConnectorRecord,
    message: AgentMessage,
    config: FeishuWorkspaceConfig,
    running: RunningFeishuConnector | undefined,
  ): Promise<boolean> {
    if (message.content.trim().startsWith("/")) {
      this.initFlows.delete(initFlowKey(connector.projectId, message.channelKey ?? ""))
      return false
    }
    const channelKey = message.channelKey
    if (!channelKey || !config.baseDir) return false
    const key = initFlowKey(connector.projectId, channelKey)
    const reply = (content: string) =>
      running?.client.replyText(message.replyCtx as FeishuReplyContext, content)
    const existing = this.initFlows.get(key)
    if (!existing) {
      this.initFlows.set(key, {
        state: "awaiting_target",
        channelName: message.channelName,
      })
      await reply("当前频道未绑定工作区。发送目录名、本地路径或 Git URL。")
      return true
    }

    const actor: ActorIdentity = { kind: "user", id: `feishu:${message.userId ?? "unknown"}` }
    const target = message.content.trim()
    if (existing.state === "awaiting_confirm") {
      if (!["yes", "y"].includes(target.toLowerCase())) {
        this.initFlows.delete(key)
        await reply("已取消。")
        return true
      }
      if (!existing.repoUrl || !existing.cloneTo) {
        this.initFlows.delete(key)
        await reply("初始化失败。")
        return true
      }
      await this.cloneAndBindWorkspace({
        projectId: connector.projectId,
        connectorId: connector.id,
        actor,
        scope: "project",
        channelKey,
        channelName: existing.channelName,
        repoUrl: existing.repoUrl,
        cloneTo: existing.cloneTo,
        baseDir: config.baseDir,
      })
      this.initFlows.delete(key)
      await reply(`已绑定：${existing.cloneTo}`)
      return true
    }

    if (looksLikeGitUrl(target)) {
      const cloneTo = path.join(config.baseDir, extractRepoName(target))
      this.initFlows.set(key, {
        ...existing,
        state: "awaiting_confirm",
        repoUrl: target,
        cloneTo,
      })
      await reply(`克隆到 ${cloneTo}？回复 yes 确认。`)
      return true
    }

    const binding = await this.initializeWorkspaceTarget({
      projectId: connector.projectId,
      connectorId: connector.id,
      actor,
      scope: "project",
      channelKey,
      channelName: existing.channelName,
      target,
      baseDir: config.baseDir,
    })
    this.initFlows.delete(key)
    await reply(`已绑定：${binding.workspacePath}`)
    return true
  }

  private async initializeWorkspaceTarget(input: {
    readonly projectId: string
    readonly connectorId: string
    readonly actor: ActorIdentity
    readonly scope: WorkspaceBindingScope
    readonly channelKey: string
    readonly channelName?: string
    readonly target: string
    readonly baseDir: string
  }): Promise<WorkspaceBindingEntryV1> {
    if (looksLikeGitUrl(input.target)) {
      return this.cloneAndBindWorkspace({
        ...input,
        repoUrl: input.target,
        cloneTo: path.join(input.baseDir, extractRepoName(input.target)),
      })
    }
    const workspacePath = resolveLocalPath(input.target, input.baseDir)
    return this.bindLocalPath({
      projectId: input.projectId,
      connectorId: input.connectorId,
      actor: input.actor,
      scope: input.scope,
      channelKey: input.channelKey,
      channelName: input.channelName,
      workspacePath,
      baseDir: input.baseDir,
    })
  }

  private async bindLocalPath(input: {
    readonly projectId: string
    readonly connectorId: string
    readonly actor: ActorIdentity
    readonly scope: WorkspaceBindingScope
    readonly channelKey: string
    readonly channelName?: string
    readonly workspacePath: string
    readonly baseDir?: string
  }): Promise<WorkspaceBindingEntryV1> {
    await this.checkPathPermission({
      action: "fs.read.outside-userdata",
      actor: input.actor,
      resource: input.workspacePath,
      projectId: input.projectId,
      connectorId: input.connectorId,
      feishuAction: "workspace_bind_path",
      channelKey: input.channelKey,
    })
    if (!await isDirectory(input.workspacePath)) {
      throw new Error("工作区不存在。")
    }
    return this.workspaceBindings.bind({
      projectId: input.scope === "project" ? input.projectId : undefined,
      scope: input.scope,
      platform: "feishu",
      channelKey: input.channelKey,
      channelName: input.channelName,
      workspacePath: input.workspacePath,
      baseDir: input.baseDir,
      boundBy: input.actor.id,
    })
  }

  private async cloneAndBindWorkspace(input: {
    readonly projectId: string
    readonly connectorId: string
    readonly actor: ActorIdentity
    readonly scope: WorkspaceBindingScope
    readonly channelKey: string
    readonly channelName?: string
    readonly repoUrl: string
    readonly cloneTo: string
    readonly baseDir: string
  }): Promise<WorkspaceBindingEntryV1> {
    if (await isDirectory(input.cloneTo)) {
      return this.workspaceBindings.bind({
        projectId: input.scope === "project" ? input.projectId : undefined,
        scope: input.scope,
        platform: "feishu",
        channelKey: input.channelKey,
        channelName: input.channelName,
        workspacePath: input.cloneTo,
        baseDir: input.baseDir,
        boundBy: input.actor.id,
      })
    }
    await this.checkPathPermission({
      action: "network.connect",
      actor: input.actor,
      resource: input.repoUrl,
      projectId: input.projectId,
      connectorId: input.connectorId,
      feishuAction: "workspace_clone_network",
      channelKey: input.channelKey,
    })
    await this.checkPathPermission({
      action: "fs.write",
      actor: input.actor,
      resource: input.cloneTo,
      projectId: input.projectId,
      connectorId: input.connectorId,
      feishuAction: "workspace_clone_write",
      channelKey: input.channelKey,
    })
    await this.gitClone({
      repoUrl: input.repoUrl,
      destination: input.cloneTo,
      baseDir: input.baseDir,
      actor: input.actor,
      projectId: input.projectId,
      connectorId: input.connectorId,
    })
    return this.workspaceBindings.bind({
      projectId: input.scope === "project" ? input.projectId : undefined,
      scope: input.scope,
      platform: "feishu",
      channelKey: input.channelKey,
      channelName: input.channelName,
      workspacePath: input.cloneTo,
      baseDir: input.baseDir,
      boundBy: input.actor.id,
    })
  }

  private async gitClone(input: {
    readonly repoUrl: string
    readonly destination: string
    readonly baseDir: string
    readonly actor: ActorIdentity
    readonly projectId: string
    readonly connectorId: string
  }): Promise<void> {
    if (this.deps.gitClone) {
      await this.deps.gitClone(input)
      return
    }
    if (!this.deps.permissionGuard || !this.deps.auditSink) {
      throw new Error("Git 初始化不可用。")
    }
    const result = await createControlledProcessRunner({
      permissionGuard: this.deps.permissionGuard,
      auditSink: this.deps.auditSink,
    }).run({
      action: "shell.exec",
      actor: input.actor,
      command: "git",
      args: ["clone", input.repoUrl, input.destination],
      cwd: input.baseDir,
      timeoutMs: 10 * 60 * 1000,
      output: { stdout: "buffer", stderr: "buffer" },
      metadata: {
        projectId: input.projectId,
        connectorId: input.connectorId,
        feishuAction: "workspace_clone",
      },
    })
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.error || "git clone failed")
    }
  }

  async handleCardAction(event: FeishuCardActionEvent): Promise<FeishuCardActionResponse> {
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
      return permissionHandledCard("无权处理此请求")
    }
    const { agent } = await this.resolveProjectAgent(projectId)
    try {
      await agent.respondPermission({
        requestId,
        behavior,
        actor: { kind: "user", id: `feishu:${operatorOpenId}` },
      })
    } catch (error) {
      if (isPermissionNotPendingError(error)) {
        this.recordAudit("failed", projectId, connectorId, "card_action", error, {
          requestId,
          behavior,
          operatorOpenId,
          reason: "permission_not_pending",
        })
        return permissionHandledCard("请求已处理或已过期")
      }
      throw error
    }
    this.recordAudit("allowed", projectId, connectorId, "card_action", undefined, {
      requestId,
      behavior,
      operatorOpenId,
    })
    return permissionHandledCard(behavior === "allow" ? "已允许" : "已拒绝")
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

  private async checkPathPermission(input: {
    readonly action: PermissionAction
    readonly actor: ActorIdentity
    readonly resource: string
    readonly projectId: string
    readonly connectorId: string
    readonly feishuAction: string
    readonly channelKey?: string
  }): Promise<void> {
    const permission = await this.deps.permissionGuard?.check({
      action: input.action,
      actor: input.actor,
      resource: input.resource,
      context: {
        projectId: input.projectId,
        connectorId: input.connectorId,
        feishuAction: input.feishuAction,
        channelKey: input.channelKey,
      },
    })
    if (permission && !permission.allowed) {
      this.deps.auditSink?.record({
        action: input.action,
        actor: input.actor,
        resource: input.resource,
        outcome: "denied",
        metadata: {
          projectId: input.projectId,
          connectorId: input.connectorId,
          feishuAction: input.feishuAction,
          channelKey: input.channelKey,
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      throw new Error(permission.reason)
    }
    this.deps.auditSink?.record({
      action: input.action,
      actor: input.actor,
      resource: input.resource,
      outcome: "allowed",
      metadata: {
        projectId: input.projectId,
        connectorId: input.connectorId,
        feishuAction: input.feishuAction,
        channelKey: input.channelKey,
      },
    })
  }

  private installWorkspaceReaper(
    connectorId: string,
    projectId: string,
    rawConfig: ConnectorWorkspaceConfigV1 | undefined,
  ): void {
    this.clearWorkspaceReaper(connectorId)
    const config = normalizeWorkspaceConfig(rawConfig)
    if (!config.enabled) return
    const idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_WORKSPACE_IDLE_TIMEOUT_MS
    const timer = setInterval(() => {
      void this.resolveProjectAgent(projectId)
        .then(({ agent }) => agent.reapIdleWorkspaceRuntimes(idleTimeoutMs))
        .catch((error) => {
          this.deps.logger?.warn("Failed to reap Feishu workspace runtime.", {
            error: error instanceof Error ? error.message : String(error),
            projectId,
            connectorId,
          })
        })
    }, Math.min(idleTimeoutMs, 60_000))
    this.workspaceReapers.set(connectorId, timer)
  }

  private clearWorkspaceReaper(connectorId: string): void {
    const timer = this.workspaceReapers.get(connectorId)
    if (!timer) return
    clearInterval(timer)
    this.workspaceReapers.delete(connectorId)
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
    const permissionAction: PermissionAction = action === "message" || action === "card_action"
      ? "agent.spawn"
      : action.startsWith("workspace")
        ? "fs.write"
        : "network.connect"
    this.deps.auditSink?.record({
      action: permissionAction,
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

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function rawFeishuEventLogContext(
  projectId: string,
  connectorId: string,
  event: FeishuMessageEvent,
): Record<string, unknown> {
  return {
    projectId,
    connectorId,
    platform: "feishu",
    messageId: event.message.message_id,
    chatId: event.message.chat_id,
    chatType: event.message.chat_type,
    messageType: event.message.message_type,
    rootId: event.message.root_id,
    threadId: event.message.thread_id,
    userId: event.sender.sender_id?.open_id,
  }
}

function feishuMessageLogContext(
  projectId: string,
  connectorId: string,
  message: AgentMessage,
): Record<string, unknown> {
  const replyCtx = recordValue(message.replyCtx)
  return {
    projectId,
    connectorId,
    platform: message.platform,
    sessionKey: message.sessionKey,
    channelKey: message.channelKey,
    channelName: message.channelName,
    chatId: stringValue(replyCtx.chatId),
    chatType: message.chatType ?? stringValue(replyCtx.chatType),
    messageId: message.messageId,
    rootId: stringValue(replyCtx.rootId),
    threadId: stringValue(replyCtx.threadId),
    userId: message.userId,
    workspaceKey: message.workspaceKey,
    replyInThread: typeof replyCtx.replyInThread === "boolean" ? replyCtx.replyInThread : undefined,
    contentLength: message.content.length,
    attachmentCount: message.attachments?.length ?? 0,
  }
}

function permissionHandledCard(content: string): FeishuCardActionResponse {
  return {
    config: { wide_screen_mode: true },
    header: {
      template: "orange",
      title: { tag: "plain_text", content: "权限确认" },
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "plain_text",
          content,
        },
      },
    ],
  }
}

function isPermissionNotPendingError(error: unknown): boolean {
  return error instanceof Error && /Permission request ".+" is not pending/.test(error.message)
}

const DEFAULT_WORKSPACE_IDLE_TIMEOUT_MS = 15 * 60 * 1000

interface WorkspaceConfigLike {
  readonly enabled?: boolean
  readonly baseDir?: string
  readonly autoBindByChannelName?: boolean
  readonly idleTimeoutMs?: number
}

function normalizeWorkspaceConfig(
  input: WorkspaceConfigLike | undefined,
): FeishuWorkspaceConfig {
  return {
    enabled: input?.enabled === true,
    baseDir: stringValue(input?.baseDir),
    autoBindByChannelName: input?.autoBindByChannelName ?? true,
    idleTimeoutMs: positiveNumber(input?.idleTimeoutMs),
  }
}

function parseWorkspaceCommand(content: string): { readonly args: readonly string[] } | null {
  const trimmed = content.trim()
  const match = /^(\/workspace|\/ws)(?:\s+(.+))?$/i.exec(trimmed)
  if (!match) return null
  const args = (match[2] ?? "").trim()
  return { args: args ? args.split(/\s+/) : [] }
}

function parseRelayCommand(content: string): { readonly args: readonly string[] } | null {
  const trimmed = content.trim()
  const match = /^\/relay(?:\s+(.+))?$/i.exec(trimmed)
  if (!match) return null
  const args = (match[1] ?? "").trim()
  return { args: args ? args.split(/\s+/) : [] }
}

function isAutomationCommand(content: string): boolean {
  return /^\/relay(?:\s|$)/i.test(content.trim())
}

function formatBindingList(
  bindings: readonly WorkspaceBindingEntryV1[],
  scope: WorkspaceBindingScope,
): string {
  if (bindings.length === 0) return scope === "shared" ? "shared 绑定为空。" : "项目绑定为空。"
  return bindings
    .map((binding) => `${binding.channelName ?? binding.channelKey} -> ${binding.workspacePath}`)
    .join("\n")
}

function initFlowKey(projectId: string, channelKey: string): string {
  return `${projectId}:${channelKey}`
}

function workspaceKeyForPath(workspacePath: string): string {
  const hash = createHash("sha256").update(workspacePath).digest("hex").slice(0, 16)
  return `workspace:${hash}`
}

function looksLikeGitUrl(value: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/)/.test(value.trim())
}

function extractRepoName(repoUrl: string): string {
  const withoutGit = repoUrl.trim().replace(/\.git$/, "")
  const last = withoutGit.split(/[/:]/).filter(Boolean).at(-1)
  return last || "workspace"
}

function resolveLocalPath(target: string, baseDir: string): string {
  const trimmed = target.trim()
  const expanded = expandHomePath(trimmed)
  if (path.isAbsolute(expanded)) return expanded
  const resolved = path.resolve(baseDir, expanded)
  const base = path.resolve(baseDir)
  const relative = path.relative(base, resolved)
  if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
    throw new Error("工作区路径不能离开 baseDir。")
  }
  return resolved
}

function expandHomePath(target: string): string {
  if (target === "~") return homedir()
  if (target.startsWith("~/") || target.startsWith("~\\")) {
    return path.join(homedir(), target.slice(2))
  }
  return target
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined
}
