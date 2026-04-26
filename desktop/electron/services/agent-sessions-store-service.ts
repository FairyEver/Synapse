import { app } from "electron"
import path from "node:path"
import type {
  SynapseAgentSessionDetail,
  SynapseAgentSessionListResult,
  SynapseAgentSessionSummary,
  SynapseCreateAgentSessionPayload,
  SynapseGetAgentSessionPayload,
  SynapsePendingPermission,
  SynapseRespondPermissionPayload,
  SynapseRespondPermissionResult,
  SynapseSendAgentMessagePayload,
  SynapseSendAgentMessageResult,
  SynapseSwitchAgentSessionPayload,
} from "../../src/types/agent-session"
import type { SynapseProjectConfig } from "../../src/types/config"
import { JsonNamespace } from "../runtime/data-repo/backends/json"
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

function limitHistory<T>(history: readonly T[], limit: number | undefined): T[] {
  if (!limit || limit <= 0 || limit >= history.length) {
    return history.map((entry) => ({ ...entry }))
  }

  return history.slice(history.length - limit).map((entry) => ({ ...entry }))
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
