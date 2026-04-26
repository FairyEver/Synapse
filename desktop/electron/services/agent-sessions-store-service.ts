import { app } from "electron"
import path from "node:path"
import type {
  SynapseAgentSessionDetail,
  SynapseAgentSessionListResult,
  SynapseAgentSessionSummary,
  SynapseCommandCatalogItem,
  SynapseCommandExecutionResult,
  SynapseCreateAgentSessionPayload,
  SynapseExecuteCommandPayload,
  SynapseGetAgentSessionPayload,
  SynapseListCommandsPayload,
  SynapseListCommandsResult,
  SynapsePendingPermission,
  SynapseRespondPermissionPayload,
  SynapseRespondPermissionResult,
  SynapseSendAgentMessagePayload,
  SynapseSendAgentMessageResult,
  SynapseSwitchAgentSessionPayload,
} from "../../src/types/agent-session"
import type { SynapseProjectConfig } from "../../src/types/config"
import type { SynapseProviderEntry } from "../../src/types/provider"
import { JsonNamespace } from "../runtime/data-repo/backends/json"
import {
  CC_BUILTIN_COMMANDS,
  isCommandDisabled,
  resolveDisabledCommands,
} from "./access-policy-service"
import {
  AgentEngineService,
  type AgentEngineTurnResult,
} from "./agent-engine-service"
import {
  AgentSessionsRepository,
  type SessionsSnapshot,
} from "./sessions-repository-service"
import { SessionEventLog, type SynapseAgentEvent } from "./session-event-service"

type AgentSessionsStoreSnapshot = {
  schemaVersion: 1
  projects: Record<string, SessionsSnapshot>
}

type AgentSessionsStoreNamespace = Pick<JsonNamespace<AgentSessionsStoreSnapshot>, "getSingleton" | "setSingleton">

type AgentSessionsStoreServiceOptions = {
  namespace?: AgentSessionsStoreNamespace | null
  now?: () => Date
}

type SendMessageOptions = {
  events?: SynapseAgentEvent[]
  eventGapsMs?: number[]
  idleTimeoutMs?: number
  engine?: AgentEngineService
}

type PendingPermissionRecord = {
  projectId: string
  sessionId: string
}

const AGENT_SESSIONS_NAMESPACE = "agent.sessions"
const AGENT_SESSIONS_SCHEMA_VERSION = 1
const DEFAULT_HISTORY_LIMIT = 200
const HIGH_RISK_COMMANDS = new Set(["shell", "show", "dir", "restart", "upgrade", "web", "diff"])

type CommandDefinition = {
  id: string
  command: string
  aliases: string[]
  title: string
  description: string
  group: SynapseCommandCatalogItem["group"]
  highRisk?: boolean
  argsMode?: SynapseCommandCatalogItem["argsMode"]
}

const COMMAND_DEFINITIONS: CommandDefinition[] = [
  { id: "new", command: "/new", aliases: [], title: "新会话", description: "创建当前项目的新会话。", group: "session" },
  { id: "list", command: "/list", aliases: ["/sessions"], title: "会话列表", description: "查看当前项目会话。", group: "session" },
  { id: "switch", command: "/switch", aliases: [], title: "切换会话", description: "切换到指定会话。", group: "session", argsMode: "text" },
  { id: "current", command: "/current", aliases: [], title: "当前会话", description: "查看当前会话信息。", group: "session" },
  { id: "history", command: "/history", aliases: [], title: "历史", description: "查看会话历史摘要。", group: "session" },
  { id: "stop", command: "/stop", aliases: [], title: "停止", description: "停止当前运行任务。", group: "session" },
  { id: "model", command: "/model", aliases: [], title: "模型", description: "查看当前模型。", group: "settings" },
  { id: "reasoning", command: "/reasoning", aliases: ["/effort"], title: "推理强度", description: "查看当前推理设置。", group: "settings" },
  { id: "mode", command: "/mode", aliases: [], title: "模式", description: "查看当前项目模式。", group: "settings" },
  { id: "lang", command: "/lang", aliases: [], title: "语言", description: "查看当前语言。", group: "settings" },
  { id: "provider", command: "/provider", aliases: [], title: "服务商", description: "查看当前服务商。", group: "settings" },
  { id: "cron", command: "/cron", aliases: [], title: "Cron", description: "查看定时任务入口。", group: "settings" },
  { id: "heartbeat", command: "/heartbeat", aliases: ["/hb"], title: "Heartbeat", description: "查看心跳配置。", group: "settings" },
  { id: "status", command: "/status", aliases: [], title: "状态", description: "查看当前项目和会话状态。", group: "info" },
  { id: "help", command: "/help", aliases: [], title: "帮助", description: "查看命令帮助。", group: "info" },
  { id: "version", command: "/version", aliases: [], title: "版本", description: "查看运行时版本。", group: "info" },
  { id: "commands", command: "/commands", aliases: ["/command", "/cmd"], title: "命令", description: "查看可用命令。", group: "info" },
  { id: "skills", command: "/skills", aliases: ["/skill"], title: "Skills", description: "查看技能入口。", group: "info" },
  { id: "doctor", command: "/doctor", aliases: [], title: "诊断", description: "查看诊断入口。", group: "info" },
  { id: "config", command: "/config", aliases: [], title: "配置", description: "查看配置入口。", group: "advanced" },
  { id: "alias", command: "/alias", aliases: [], title: "别名", description: "查看别名入口。", group: "advanced" },
  { id: "dir", command: "/dir", aliases: ["/cd", "/chdir", "/workdir"], title: "工作目录", description: "查看或切换工作目录。", group: "advanced", highRisk: true, argsMode: "text" },
  { id: "shell", command: "/shell", aliases: ["/sh", "/exec", "/run"], title: "Shell", description: "执行 shell 命令。", group: "advanced", highRisk: true, argsMode: "text" },
  { id: "show", command: "/show", aliases: [], title: "打开文件", description: "打开本地文件。", group: "advanced", highRisk: true, argsMode: "text" },
  { id: "upgrade", command: "/upgrade", aliases: ["/update"], title: "升级", description: "执行升级。", group: "advanced", highRisk: true },
  { id: "restart", command: "/restart", aliases: [], title: "重启", description: "重启运行时。", group: "advanced", highRisk: true },
  { id: "web", command: "/web", aliases: [], title: "Web", description: "打开 Web 入口。", group: "advanced", highRisk: true, argsMode: "text" },
  { id: "diff", command: "/diff", aliases: [], title: "Diff", description: "查看变更 diff。", group: "advanced", highRisk: true },
]

function createDefaultStoreSnapshot(): AgentSessionsStoreSnapshot {
  return {
    schemaVersion: 1,
    projects: {},
  }
}

function isStoreSnapshot(value: unknown): value is AgentSessionsStoreSnapshot {
  return typeof value === "object"
    && value !== null
    && (value as AgentSessionsStoreSnapshot).schemaVersion === 1
    && typeof (value as AgentSessionsStoreSnapshot).projects === "object"
    && (value as AgentSessionsStoreSnapshot).projects !== null
}

function createNamespace(): JsonNamespace<AgentSessionsStoreSnapshot> {
  const userDataPath = app.getPath("userData")
  const dataV1Path = path.join(userDataPath, "data-v1")
  const filePath = path.join(dataV1Path, `${AGENT_SESSIONS_NAMESPACE}.json`)

  return new JsonNamespace({
    name: AGENT_SESSIONS_NAMESPACE,
    schemaVersion: AGENT_SESSIONS_SCHEMA_VERSION,
    backend: "json",
    filePath,
    defaults: createDefaultStoreSnapshot,
    validate: isStoreSnapshot,
  })
}

function normalizeProjectName(project: SynapseProjectConfig): string {
  return project.name.trim() || project.id
}

function findProject(projects: readonly SynapseProjectConfig[], projectId: string): SynapseProjectConfig | null {
  return projects.find((project) => project.id === projectId || normalizeProjectName(project) === projectId) ?? null
}

function platformFromSessionKey(sessionKey: string): string {
  const separatorIndex = sessionKey.indexOf(":")
  return separatorIndex >= 0 ? sessionKey.slice(0, separatorIndex) : sessionKey
}

function truncateLastMessage(content: string): string {
  return content.length > 200 ? content.slice(0, 200) : content
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function limitHistory<T>(history: readonly T[], limit: number | undefined): T[] {
  if (!limit || limit <= 0 || limit >= history.length) {
    return history.map((entry) => ({ ...entry }))
  }

  return history.slice(history.length - limit).map((entry) => ({ ...entry }))
}

function commandName(input: string): string {
  const [name = ""] = input.trim().split(/\s+/u)
  return name.replace(/^\/+/, "").toLowerCase()
}

function commandArgs(input: string): string {
  const trimmed = input.trim()
  const firstSpace = trimmed.search(/\s/u)
  return firstSpace >= 0 ? trimmed.slice(firstSpace + 1).trim() : ""
}

function commandNames(definition: CommandDefinition): string[] {
  return [definition.command, ...definition.aliases].map((name) => name.replace(/^\/+/, "").toLowerCase())
}

function resolveCommand(input: string): CommandDefinition | null {
  const name = commandName(input)
  if (!name) {
    return null
  }

  const exact = COMMAND_DEFINITIONS.find((definition) => commandNames(definition).includes(name))
  if (exact) {
    return exact
  }

  let matched: CommandDefinition | null = null
  for (const definition of COMMAND_DEFINITIONS) {
    if (!commandNames(definition).some((candidate) => candidate.startsWith(name))) {
      continue
    }
    if (matched && matched.id !== definition.id) {
      return null
    }
    matched = definition
  }

  return matched
}

function isHighRiskCommand(definition: CommandDefinition): boolean {
  return Boolean(definition.highRisk) || HIGH_RISK_COMMANDS.has(definition.id)
}

function providerName(provider: SynapseProviderEntry): string {
  return provider.name.trim() || provider.id
}

function findProvider(
  project: SynapseProjectConfig,
  globalProviders: readonly SynapseProviderEntry[],
): SynapseProviderEntry | null {
  const activeProvider = project.activeProvider?.trim()
  const inlineProviders = project.providers ?? []
  const candidates = [...inlineProviders, ...globalProviders]

  if (activeProvider) {
    return candidates.find((provider) =>
      provider.id === activeProvider || providerName(provider).toLowerCase() === activeProvider.toLowerCase(),
    ) ?? null
  }

  const firstRef = project.providerRefs?.[0]
  if (firstRef) {
    return candidates.find((provider) =>
      provider.id === firstRef || providerName(provider).toLowerCase() === firstRef.toLowerCase(),
    ) ?? null
  }

  return inlineProviders[0] ?? null
}

function commandResult(input: {
  status?: SynapseCommandExecutionResult["status"]
  command: string
  title: string
  content: string
  format?: SynapseCommandExecutionResult["format"]
  error?: string | null
  session?: SynapseAgentSessionDetail | null
  requiresPermission?: boolean
}): SynapseCommandExecutionResult {
  return {
    status: input.status ?? "completed",
    command: input.command,
    title: input.title,
    content: input.content,
    format: input.format ?? "markdown",
    error: input.error ?? null,
    session: input.session ?? null,
    requiresPermission: input.requiresPermission ?? false,
  }
}

export class AgentSessionsStoreService {
  private readonly namespace: AgentSessionsStoreNamespace | null
  private readonly now: () => Date
  private readonly repositories = new Map<string, AgentSessionsRepository>()
  private readonly eventLogs = new Map<string, SessionEventLog>()
  private readonly pendingPermissions = new Map<string, PendingPermissionRecord>()
  private initialized = false

  constructor(options: AgentSessionsStoreServiceOptions = {}) {
    this.namespace = options.namespace === undefined ? createNamespace() : options.namespace
    this.now = options.now ?? (() => new Date())
  }

  async list(projects: readonly SynapseProjectConfig[]): Promise<SynapseAgentSessionListResult> {
    await this.initialize()

    const sessions = projects.flatMap((project) => this.listProjectSessions(project))
      .sort((left, right) => (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt))

    return {
      sessions,
      activeKeys: {},
    }
  }

  async getDetail(
    projects: readonly SynapseProjectConfig[],
    input: SynapseGetAgentSessionPayload,
  ): Promise<SynapseAgentSessionDetail> {
    await this.initialize()

    const project = this.requireProject(projects, input.projectId)
    const repository = this.ensureRepository(project.id)
    const session = repository.findById(input.sessionId)
    if (!session) {
      throw new Error("session not found")
    }

    const summary = this.toSummary(project, repository.snapshot(), session.id)
    const historyLimit = input.historyLimit ?? DEFAULT_HISTORY_LIMIT

    return {
      ...summary,
      agentSessionId: session.agentSessionId,
      history: limitHistory(session.history, historyLimit),
    }
  }

  async createSession(
    projects: readonly SynapseProjectConfig[],
    input: SynapseCreateAgentSessionPayload,
  ): Promise<SynapseAgentSessionDetail> {
    await this.initialize()

    const project = this.requireProject(projects, input.projectId)
    const sessionKey = input.sessionKey.trim()
    if (!sessionKey) {
      throw new Error("session_key is required")
    }

    const repository = this.ensureRepository(project.id)
    const session = repository.newSession(sessionKey, input.name?.trim() || "default")
    await this.save()

    return this.getDetail(projects, {
      projectId: project.id,
      sessionId: session.id,
      historyLimit: DEFAULT_HISTORY_LIMIT,
    })
  }

  async switchSession(
    projects: readonly SynapseProjectConfig[],
    input: SynapseSwitchAgentSessionPayload,
  ): Promise<SynapseAgentSessionDetail> {
    await this.initialize()

    const project = this.requireProject(projects, input.projectId)
    const sessionKey = input.sessionKey.trim()
    if (!sessionKey) {
      throw new Error("session_key is required")
    }

    const repository = this.ensureRepository(project.id)
    const session = repository.switchSession(sessionKey, input.sessionId)
    await this.save()

    return this.getDetail(projects, {
      projectId: project.id,
      sessionId: session.id,
      historyLimit: DEFAULT_HISTORY_LIMIT,
    })
  }

  async listCommands(
    projects: readonly SynapseProjectConfig[],
    input: SynapseListCommandsPayload,
  ): Promise<SynapseListCommandsResult> {
    await this.initialize()

    const project = this.requireProject(projects, input.projectId)
    const disabledCommands = resolveDisabledCommands(project.disabledCommands, CC_BUILTIN_COMMANDS)

    return {
      commands: COMMAND_DEFINITIONS.map((definition) => ({
        id: definition.id,
        command: definition.command,
        aliases: definition.aliases,
        title: definition.title,
        description: definition.description,
        group: definition.group,
        source: "builtin",
        disabled: isCommandDisabled(definition.command, disabledCommands, CC_BUILTIN_COMMANDS),
        highRisk: isHighRiskCommand(definition),
        argsMode: definition.argsMode ?? "none",
      })),
    }
  }

  async executeCommand(
    projects: readonly SynapseProjectConfig[],
    input: SynapseExecuteCommandPayload,
    globalProviders: readonly SynapseProviderEntry[] = [],
  ): Promise<SynapseCommandExecutionResult> {
    await this.initialize()

    const project = this.requireProject(projects, input.projectId)
    const repository = this.ensureRepository(project.id)
    const session = repository.findById(input.sessionId)
    if (!session) {
      throw new Error("session not found")
    }

    const rawCommand = input.command.trim()
    if (!rawCommand) {
      throw new Error("command is required")
    }

    const definition = resolveCommand(rawCommand)
    if (!definition) {
      return commandResult({
        status: "error",
        command: rawCommand,
        title: rawCommand,
        content: "未知命令。",
        error: "unknown command",
      })
    }

    const disabledCommands = resolveDisabledCommands(project.disabledCommands, CC_BUILTIN_COMMANDS)
    if (isCommandDisabled(definition.command, disabledCommands, CC_BUILTIN_COMMANDS)) {
      return commandResult({
        status: "error",
        command: definition.command,
        title: definition.title,
        content: "命令已禁用。",
        error: "command disabled",
      })
    }

    if (isHighRiskCommand(definition)) {
      if (input.permissionDecision === "deny") {
        return commandResult({
          status: "denied",
          command: definition.command,
          title: definition.title,
          content: "已拒绝。",
          format: "text",
        })
      }
      if (input.permissionDecision !== "allow") {
        return commandResult({
          status: "permission_required",
          command: definition.command,
          title: definition.title,
          content: "需要确认后执行。",
          format: "text",
          requiresPermission: true,
        })
      }

      return commandResult({
        status: "error",
        command: definition.command,
        title: definition.title,
        content: "未执行：运行时未连接。",
        error: "runtime not connected",
      })
    }

    const detail = await this.getDetail(projects, {
      projectId: project.id,
      sessionId: session.id,
      historyLimit: DEFAULT_HISTORY_LIMIT,
    })

    switch (definition.id) {
      case "new": {
        const name = commandArgs(rawCommand) || "default"
        const sessionKey = input.sessionKey?.trim()
          || this.sessionKeyForSessionId(repository.snapshot(), session.id)
          || defaultSessionKey(normalizeProjectName(project))
        const created = await this.createSession(projects, {
          projectId: project.id,
          sessionKey,
          name,
        })
        return commandResult({
          command: definition.command,
          title: definition.title,
          content: `已创建会话：${created.name}`,
          format: "text",
          session: created,
        })
      }
      case "list":
        return commandResult({
          command: definition.command,
          title: definition.title,
          content: this.renderSessionList(project, repository.snapshot()),
        })
      case "current":
        return commandResult({
          command: definition.command,
          title: definition.title,
          content: this.renderCurrentSession(detail),
        })
      case "history":
        return commandResult({
          command: definition.command,
          title: definition.title,
          content: this.renderHistory(detail),
        })
      case "status":
        return commandResult({
          command: definition.command,
          title: definition.title,
          content: this.renderStatus(project, detail),
        })
      case "model":
        return commandResult({
          command: definition.command,
          title: definition.title,
          content: this.renderModel(project, globalProviders),
        })
      case "provider":
        return commandResult({
          command: definition.command,
          title: definition.title,
          content: this.renderProvider(project, globalProviders),
        })
      case "commands":
      case "help":
        return commandResult({
          command: definition.command,
          title: definition.title,
          content: this.renderCommands(project),
        })
      case "cron":
        return commandResult({
          command: definition.command,
          title: definition.title,
          content: "进入自动化 > 定时任务。",
          format: "text",
        })
      case "heartbeat":
        return commandResult({
          command: definition.command,
          title: definition.title,
          content: this.renderHeartbeat(project),
        })
      case "skills":
        return commandResult({
          command: definition.command,
          title: definition.title,
          content: "Skills UI 将在后续批次接入。",
          format: "text",
        })
      default:
        return commandResult({
          command: definition.command,
          title: definition.title,
          content: "当前命令尚未接入。",
          format: "text",
        })
    }
  }

  async sendMessage(
    projects: readonly SynapseProjectConfig[],
    input: SynapseSendAgentMessagePayload,
    options: SendMessageOptions = {},
  ): Promise<SynapseSendAgentMessageResult> {
    await this.initialize()

    const project = this.requireProject(projects, input.projectId)
    const message = input.message.trim()
    if (!message) {
      throw new Error("message is required")
    }

    const repository = this.ensureRepository(project.id)
    const session = repository.findById(input.sessionId)
    if (!session) {
      throw new Error("session not found")
    }

    const sessionKey = input.sessionKey?.trim()
      || this.sessionKeyForSessionId(repository.snapshot(), session.id)
      || defaultSessionKey(normalizeProjectName(project))

    const eventLog = this.eventLogForSession(session.id)
    const engine = options.engine ?? new AgentEngineService({ now: this.now, eventLog })
    const result = engine.processTurn({
      sessionId: session.id,
      sessionKey,
      prompt: message,
      events: options.events ?? [{ type: "error", error: "agent runtime is not connected" }],
      eventGapsMs: options.eventGapsMs,
      idleTimeoutMs: options.idleTimeoutMs,
      repository,
      now: this.now,
    })

    this.applyEngineSessionId(repository, session.id, result)
    const pendingPermission = this.toPendingPermission(result.pendingPermission)
    if (pendingPermission) {
      this.pendingPermissions.set(
        this.permissionKey(project.id, session.id, pendingPermission.requestId),
        { projectId: project.id, sessionId: session.id },
      )
    } else {
      this.clearPendingPermissions(project.id, session.id)
    }
    await this.save()

    const detail = await this.getDetail(projects, {
      projectId: project.id,
      sessionId: session.id,
      historyLimit: DEFAULT_HISTORY_LIMIT,
    })

    return {
      status: result.status,
      response: result.response,
      error: result.error,
      session: detail,
      events: result.records,
      pendingPermission,
    }
  }

  async respondPermission(
    projects: readonly SynapseProjectConfig[],
    input: SynapseRespondPermissionPayload,
  ): Promise<SynapseRespondPermissionResult> {
    await this.initialize()

    const project = this.requireProject(projects, input.projectId)
    const repository = this.ensureRepository(project.id)
    const session = repository.findById(input.sessionId)
    if (!session) {
      throw new Error("session not found")
    }

    const requestId = input.requestId.trim()
    if (!requestId) {
      throw new Error("permission request is required")
    }
    if (input.decision !== "allow" && input.decision !== "deny") {
      throw new Error("permission decision is required")
    }

    const key = this.permissionKey(project.id, session.id, requestId)
    const pending = this.pendingPermissions.get(key)
    if (!pending) {
      throw new Error("permission request not found")
    }

    const permissionEvent: SynapseAgentEvent = {
      type: "permission_response",
      requestId,
      permissionDecision: input.decision,
    }
    if (input.decision === "deny") {
      permissionEvent.permissionMessage = input.message?.trim()
        || "The user denied this tool use. Stop and wait for the user's instructions."
    }

    const event = this.eventLogForSession(session.id).append(session.id, permissionEvent)
    this.pendingPermissions.delete(key)

    return {
      status: input.decision === "allow" ? "accepted" : "denied",
      event,
      pendingPermission: null,
    }
  }

  async appendHistoryForTest(projectId: string, sessionKey: string, role: string, content: string): Promise<void> {
    await this.initialize()
    const repository = this.ensureRepository(projectId)
    const session = repository.getOrCreateActive(sessionKey)
    repository.appendHistory(session.id, { role, content })
    await this.save()
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    const snapshot = this.namespace ? await this.namespace.getSingleton() : null
    for (const [projectId, projectSnapshot] of Object.entries(snapshot?.projects ?? {})) {
      this.repositories.set(projectId, new AgentSessionsRepository({
        now: this.now,
        snapshot: projectSnapshot,
      }))
    }
    this.initialized = true
  }

  private ensureRepository(projectId: string): AgentSessionsRepository {
    const existing = this.repositories.get(projectId)
    if (existing) {
      return existing
    }

    const repository = new AgentSessionsRepository({ now: this.now })
    this.repositories.set(projectId, repository)
    return repository
  }

  private async save(): Promise<void> {
    if (!this.namespace) {
      return
    }

    await this.namespace.setSingleton({
      schemaVersion: 1,
      projects: Object.fromEntries(
        Array.from(this.repositories.entries()).map(([projectId, repository]) => [
          projectId,
          repository.snapshot(),
        ]),
      ),
    })
  }

  private requireProject(projects: readonly SynapseProjectConfig[], projectId: string): SynapseProjectConfig {
    const project = findProject(projects, projectId)
    if (!project) {
      throw new Error("project not found")
    }

    return project
  }

  private listProjectSessions(project: SynapseProjectConfig): SynapseAgentSessionSummary[] {
    const repository = this.ensureRepository(project.id)
    const snapshot = repository.snapshot()

    return Object.keys(snapshot.sessions).map((sessionId) => this.toSummary(project, snapshot, sessionId))
  }

  private toSummary(
    project: SynapseProjectConfig,
    snapshot: SessionsSnapshot,
    sessionId: string,
  ): SynapseAgentSessionSummary {
    const session = snapshot.sessions[sessionId]
    if (!session) {
      throw new Error("session not found")
    }

    const sessionKey = Object.entries(snapshot.userSessions)
      .find(([, sessionIds]) => sessionIds.includes(sessionId))?.[0] ?? ""
    const active = Object.values(snapshot.activeSession).includes(sessionId)
    const meta = sessionKey ? snapshot.userMeta?.[sessionKey] : undefined
    const last = session.history[session.history.length - 1]

    return {
      id: session.id,
      projectId: project.id,
      projectName: normalizeProjectName(project),
      sessionKey,
      name: session.name,
      platform: sessionKey ? platformFromSessionKey(sessionKey) : "",
      agentType: session.agentType || project.agentType || "",
      active,
      live: false,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      historyCount: session.history.length,
      lastMessage: last
        ? {
            role: last.role,
            content: truncateLastMessage(last.content),
            timestamp: last.timestamp,
          }
        : null,
      ...(meta?.userName ? { userName: meta.userName } : undefined),
      ...(meta?.chatName ? { chatName: meta.chatName } : undefined),
    }
  }

  private renderSessionList(project: SynapseProjectConfig, snapshot: SessionsSnapshot): string {
    const summaries = Object.keys(snapshot.sessions)
      .map((sessionId) => this.toSummary(project, snapshot, sessionId))
      .sort((left, right) => (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt))

    if (summaries.length === 0) {
      return "暂无会话。"
    }

    return summaries
      .map((session) => `- ${session.active ? "*" : "-"} ${session.name} (${shortId(session.id)}) · ${session.historyCount}`)
      .join("\n")
  }

  private renderCurrentSession(detail: SynapseAgentSessionDetail): string {
    return [
      `- 项目：${detail.projectName}`,
      `- 会话：${detail.name} (${shortId(detail.id)})`,
      `- Session Key：${detail.sessionKey || "-"}`,
      `- Agent：${detail.agentType || "-"}`,
      `- 消息：${detail.historyCount}`,
    ].join("\n")
  }

  private renderHistory(detail: SynapseAgentSessionDetail): string {
    if (detail.history.length === 0) {
      return "暂无消息。"
    }

    return detail.history
      .slice(-10)
      .map((entry) => `- ${entry.role}: ${truncateLastMessage(entry.content.replace(/\s+/gu, " "))}`)
      .join("\n")
  }

  private renderStatus(project: SynapseProjectConfig, detail: SynapseAgentSessionDetail): string {
    return [
      `- 项目：${normalizeProjectName(project)}`,
      `- 路径：${project.path || "-"}`,
      `- 会话：${detail.name} (${shortId(detail.id)})`,
      `- Agent：${detail.agentType || project.agentType || "-"}`,
      `- 权限：${project.permissionMode || "-"}`,
      `- 禁用命令：${project.disabledCommands?.length ? project.disabledCommands.join(", ") : "-"}`,
    ].join("\n")
  }

  private renderModel(project: SynapseProjectConfig, globalProviders: readonly SynapseProviderEntry[]): string {
    const provider = findProvider(project, globalProviders)
    if (!provider) {
      return "未绑定服务商。"
    }

    return [
      `- 服务商：${providerName(provider)}`,
      `- 模型：${provider.model || "-"}`,
      `- Thinking：${provider.thinking || "-"}`,
    ].join("\n")
  }

  private renderProvider(project: SynapseProjectConfig, globalProviders: readonly SynapseProviderEntry[]): string {
    const provider = findProvider(project, globalProviders)
    if (!provider) {
      return "未绑定服务商。"
    }

    return [
      `- 名称：${providerName(provider)}`,
      `- 范围：${provider.scope}`,
      `- Base URL：${provider.baseUrl || "-"}`,
      `- Agent Types：${provider.agentTypes?.length ? provider.agentTypes.join(", ") : "-"}`,
    ].join("\n")
  }

  private renderCommands(project: SynapseProjectConfig): string {
    const disabledCommands = resolveDisabledCommands(project.disabledCommands, CC_BUILTIN_COMMANDS)
    return COMMAND_DEFINITIONS
      .filter((definition) => !isCommandDisabled(definition.command, disabledCommands, CC_BUILTIN_COMMANDS))
      .map((definition) => `- ${definition.command} · ${definition.title}`)
      .join("\n")
  }

  private renderHeartbeat(project: SynapseProjectConfig): string {
    const heartbeat = project.heartbeat
    if (!heartbeat) {
      return "未配置 Heartbeat。"
    }

    return [
      `- 状态：${heartbeat.enabled ? "启用" : "停用"}`,
      `- 暂停：${heartbeat.paused ? "是" : "否"}`,
      `- 间隔：${heartbeat.intervalMins ?? "-"} 分钟`,
      `- Session Key：${heartbeat.sessionKey || "-"}`,
      `- 上次运行：${heartbeat.lastRunAt || "-"}`,
      `- 错误：${heartbeat.lastError || "-"}`,
    ].join("\n")
  }

  private sessionKeyForSessionId(snapshot: SessionsSnapshot, sessionId: string): string {
    return Object.entries(snapshot.userSessions)
      .find(([, sessionIds]) => sessionIds.includes(sessionId))?.[0] ?? ""
  }

  private applyEngineSessionId(
    repository: AgentSessionsRepository,
    sessionId: string,
    result: AgentEngineTurnResult,
  ): void {
    if (result.agentSessionId) {
      repository.setAgentSessionId(sessionId, result.agentSessionId)
    }
  }

  private eventLogForSession(sessionId: string): SessionEventLog {
    const existing = this.eventLogs.get(sessionId)
    if (existing) {
      return existing
    }

    const eventLog = new SessionEventLog({ now: this.now })
    this.eventLogs.set(sessionId, eventLog)
    return eventLog
  }

  private toPendingPermission(event: SynapseAgentEvent | null): SynapsePendingPermission | null {
    if (!event || event.type !== "permission_request") {
      return null
    }

    const requestId = event.requestId?.trim()
    if (!requestId) {
      return null
    }

    return {
      requestId,
      toolName: event.toolName ?? "",
      toolInput: event.toolInput ?? "",
      toolInputRaw: event.toolInputRaw ?? {},
      questions: event.questions ?? [],
    }
  }

  private permissionKey(projectId: string, sessionId: string, requestId: string): string {
    return `${projectId}:${sessionId}:${requestId}`
  }

  private clearPendingPermissions(projectId: string, sessionId: string): void {
    for (const [key, pending] of this.pendingPermissions.entries()) {
      if (pending.projectId === projectId && pending.sessionId === sessionId) {
        this.pendingPermissions.delete(key)
      }
    }
  }
}

function defaultSessionKey(projectName: string): string {
  return `bridge:web-admin:${projectName}`
}
