import { app } from "electron"
import crypto from "node:crypto"
import path from "node:path"
import type {
  SynapseHeartbeatDraft,
  SynapseHeartbeatIntervalPayload,
  SynapseHeartbeatListResult,
  SynapseHeartbeatMutationPayload,
  SynapseHeartbeatRunResult,
  SynapseHeartbeatStatus,
  SynapseHook,
  SynapseHookDeletePayload,
  SynapseHookDraft,
  SynapseHookEventType,
  SynapseHookListPayload,
  SynapseHookListResult,
  SynapseHookTestPayload,
  SynapseHookTestResult,
  SynapseHookUpdatePayload,
} from "../../src/types/automation"
import type { SynapseProjectConfig } from "../../src/types/config"
import { JsonNamespace } from "../runtime/data-repo/backends/json"
import {
  AutomationHeartbeatService,
  DEFAULT_HEARTBEAT_INTERVAL_MINS,
  DEFAULT_HEARTBEAT_TIMEOUT_MINS,
  type HeartbeatConfig,
} from "./automation-heartbeat-service"
import {
  AutomationHookManager,
  validateHookConfig,
  type AutomationHookConfig,
  type HookRunResult,
} from "./automation-hooks-service"

type HeartbeatSnapshot = {
  project: string
  workDir: string
  config: Required<HeartbeatConfig>
  paused: boolean
  runCount: number
  errorCount: number
  skippedBusy: number
  lastRun: string | null
  lastError: string
}

type HookSnapshot = {
  id: string
  project: string
  config: Required<AutomationHookConfig>
  createdAt: string
  lastRun: string | null
  lastError: string
  lastResult: string
}

type AutomationRuntimeSnapshot = {
  schemaVersion: 1
  heartbeats: HeartbeatSnapshot[]
  hooks: HookSnapshot[]
}

type AutomationRuntimeNamespace = Pick<JsonNamespace<AutomationRuntimeSnapshot>, "getSingleton" | "setSingleton">

type AutomationRuntimeStoreServiceOptions = {
  namespace?: AutomationRuntimeNamespace | null
  now?: () => Date
  heartbeat?: AutomationHeartbeatService
}

const AUTOMATION_RUNTIME_NAMESPACE = "automation.runtime"
const AUTOMATION_RUNTIME_SCHEMA_VERSION = 1

function defaultSnapshot(): AutomationRuntimeSnapshot {
  return { schemaVersion: 1, heartbeats: [], hooks: [] }
}

function isSnapshot(value: unknown): value is AutomationRuntimeSnapshot {
  return typeof value === "object"
    && value !== null
    && (value as AutomationRuntimeSnapshot).schemaVersion === 1
    && Array.isArray((value as AutomationRuntimeSnapshot).heartbeats)
    && Array.isArray((value as AutomationRuntimeSnapshot).hooks)
}

function createNamespace(): JsonNamespace<AutomationRuntimeSnapshot> {
  const userDataPath = app.getPath("userData")
  const dataV1Path = path.join(userDataPath, "data-v1")
  const filePath = path.join(dataV1Path, `${AUTOMATION_RUNTIME_NAMESPACE}.json`)

  return new JsonNamespace({
    name: AUTOMATION_RUNTIME_NAMESPACE,
    schemaVersion: AUTOMATION_RUNTIME_SCHEMA_VERSION,
    backend: "json",
    filePath,
    defaults: defaultSnapshot,
    validate: isSnapshot,
  })
}

function projectName(project: SynapseProjectConfig): string {
  return project.name.trim() || project.id
}

function requireProject(projects: readonly SynapseProjectConfig[], projectNameOrId: string): SynapseProjectConfig {
  const project = projects.find((item) => item.id === projectNameOrId || projectName(item) === projectNameOrId)
  if (!project) {
    throw new Error("project not found")
  }
  return project
}

function defaultSessionKey(project: SynapseProjectConfig): string {
  return `bridge:web-admin:${projectName(project)}`
}

function defaultWorkDir(project: SynapseProjectConfig): string {
  return project.workDirOverride || project.workDir || project.baseDir || project.path || ""
}

function normalizeHeartbeatDraft(
  projects: readonly SynapseProjectConfig[],
  draft: SynapseHeartbeatDraft,
  existing?: HeartbeatSnapshot,
): HeartbeatSnapshot {
  const project = requireProject(projects, draft.project)
  const existingConfig = existing?.config
  const intervalMins = draft.intervalMins ?? existingConfig?.intervalMins ?? project.heartbeat?.intervalMins ?? DEFAULT_HEARTBEAT_INTERVAL_MINS
  const timeoutMins = draft.timeoutMins ?? existingConfig?.timeoutMins ?? DEFAULT_HEARTBEAT_TIMEOUT_MINS
  if (intervalMins < 1) {
    throw new Error("interval_mins must be at least 1")
  }
  if (timeoutMins < 1) {
    throw new Error("timeout_mins must be at least 1")
  }

  return {
    project: projectName(project),
    workDir: draft.workDir?.trim() ?? existing?.workDir ?? defaultWorkDir(project),
    config: {
      enabled: draft.enabled ?? existingConfig?.enabled ?? project.heartbeat?.enabled ?? true,
      intervalMins,
      onlyWhenIdle: draft.onlyWhenIdle ?? existingConfig?.onlyWhenIdle ?? true,
      sessionKey: draft.sessionKey?.trim() || existingConfig?.sessionKey || project.heartbeat?.sessionKey || defaultSessionKey(project),
      prompt: draft.prompt?.trim() ?? existingConfig?.prompt ?? "",
      silent: draft.silent ?? existingConfig?.silent ?? true,
      timeoutMins,
    },
    paused: existing?.paused ?? project.heartbeat?.paused ?? false,
    runCount: existing?.runCount ?? 0,
    errorCount: existing?.errorCount ?? 0,
    skippedBusy: existing?.skippedBusy ?? 0,
    lastRun: existing?.lastRun ?? project.heartbeat?.lastRunAt ?? null,
    lastError: existing?.lastError ?? project.heartbeat?.lastError ?? "",
  }
}

function normalizeHookConfig(draft: SynapseHookDraft): Required<AutomationHookConfig> {
  const config: Required<AutomationHookConfig> = {
    event: draft.event,
    type: draft.type,
    command: draft.command?.trim() ?? "",
    url: draft.url?.trim() ?? "",
    timeout: draft.timeout && draft.timeout > 0 ? draft.timeout : 0,
    async: draft.async ?? true,
  }
  validateHookConfig(config)
  return config
}

function resultSummary(results: readonly HookRunResult[]): string {
  return results.map((result) => {
    if (result.status === "permission_required") return "permission_required"
    if (result.status === "delivered") return `delivered:${result.statusCode}`
    if (result.status === "queued") return "queued"
    return `failed:${result.error}`
  }).join(", ")
}

function resultError(results: readonly HookRunResult[]): string {
  const failed = results.find((result) => result.status === "failed")
  return failed?.status === "failed" ? failed.error : ""
}

export class AutomationRuntimeStoreService {
  private readonly namespace: AutomationRuntimeNamespace | null
  private readonly now: () => Date
  private readonly heartbeat: AutomationHeartbeatService
  private snapshot: AutomationRuntimeSnapshot = defaultSnapshot()
  private initialized = false

  constructor(options: AutomationRuntimeStoreServiceOptions = {}) {
    this.namespace = options.namespace === undefined ? createNamespace() : options.namespace
    this.now = options.now ?? (() => new Date())
    this.heartbeat = options.heartbeat ?? new AutomationHeartbeatService({ now: this.now })
  }

  async listHeartbeat(projects: readonly SynapseProjectConfig[]): Promise<SynapseHeartbeatListResult> {
    await this.initialize(projects)
    return {
      heartbeats: this.snapshot.heartbeats
        .slice()
        .sort((left, right) => left.project.localeCompare(right.project))
        .map((entry) => this.toHeartbeatView(entry)),
    }
  }

  async upsertHeartbeat(
    projects: readonly SynapseProjectConfig[],
    draft: SynapseHeartbeatDraft,
  ): Promise<SynapseHeartbeatStatus> {
    await this.initialize(projects)
    const index = this.snapshot.heartbeats.findIndex((entry) => entry.project === draft.project)
    const existing = index >= 0 ? this.snapshot.heartbeats[index] : undefined
    const entry = normalizeHeartbeatDraft(projects, draft, existing)
    if (index >= 0) {
      this.snapshot.heartbeats[index] = entry
    } else {
      this.snapshot.heartbeats.push(entry)
    }
    this.restoreHeartbeat(entry)
    await this.save()
    return this.toHeartbeatView(entry)
  }

  async pauseHeartbeat(input: SynapseHeartbeatMutationPayload): Promise<SynapseHeartbeatStatus> {
    await this.initialize()
    const entry = this.requireHeartbeat(input.project)
    entry.paused = true
    this.heartbeat.pause(entry.project)
    await this.save()
    return this.toHeartbeatView(entry)
  }

  async resumeHeartbeat(input: SynapseHeartbeatMutationPayload): Promise<SynapseHeartbeatStatus> {
    await this.initialize()
    const entry = this.requireHeartbeat(input.project)
    entry.paused = false
    this.heartbeat.resume(entry.project)
    await this.save()
    return this.toHeartbeatView(entry)
  }

  async setHeartbeatInterval(input: SynapseHeartbeatIntervalPayload): Promise<SynapseHeartbeatStatus> {
    await this.initialize()
    if (input.intervalMins < 1) {
      throw new Error("interval_mins must be at least 1")
    }
    const entry = this.requireHeartbeat(input.project)
    entry.config.intervalMins = input.intervalMins
    this.restoreHeartbeat(entry)
    await this.save()
    return this.toHeartbeatView(entry)
  }

  async triggerHeartbeat(input: SynapseHeartbeatMutationPayload): Promise<SynapseHeartbeatRunResult> {
    await this.initialize()
    const entry = this.requireHeartbeat(input.project)
    if (!entry.config.enabled) {
      return { status: "not_found", project: entry.project }
    }
    this.restoreHeartbeat(entry)
    const result = await this.heartbeat.triggerNow(entry.project)
    this.updateHeartbeatState(entry)
    await this.save()
    return result
  }

  async listHooks(input: SynapseHookListPayload = {}): Promise<SynapseHookListResult> {
    await this.initialize()
    const hooks = input.project?.trim()
      ? this.snapshot.hooks.filter((hook) => hook.project === input.project?.trim())
      : this.snapshot.hooks
    return {
      hooks: hooks
        .slice()
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(toHookView),
    }
  }

  async createHook(
    projects: readonly SynapseProjectConfig[],
    draft: SynapseHookDraft,
  ): Promise<SynapseHook> {
    await this.initialize()
    const project = requireProject(projects, draft.project)
    const hook: HookSnapshot = {
      id: `hook-${crypto.randomUUID()}`,
      project: projectName(project),
      config: normalizeHookConfig(draft),
      createdAt: this.now().toISOString(),
      lastRun: null,
      lastError: "",
      lastResult: "",
    }
    this.snapshot.hooks.push(hook)
    await this.save()
    return toHookView(hook)
  }

  async updateHook(input: SynapseHookUpdatePayload): Promise<SynapseHook> {
    await this.initialize()
    const hook = this.requireHook(input.id)
    hook.config = normalizeHookConfig({
      project: hook.project,
      event: input.patch.event ?? (hook.config.event as SynapseHookDraft["event"]),
      type: input.patch.type ?? (hook.config.type as SynapseHookDraft["type"]),
      command: input.patch.command ?? hook.config.command,
      url: input.patch.url ?? hook.config.url,
      timeout: input.patch.timeout ?? hook.config.timeout,
      async: input.patch.async ?? hook.config.async,
    })
    await this.save()
    return toHookView(hook)
  }

  async deleteHook(input: SynapseHookDeletePayload): Promise<{ status: "ok" }> {
    await this.initialize()
    const before = this.snapshot.hooks.length
    this.snapshot.hooks = this.snapshot.hooks.filter((hook) => hook.id !== input.id)
    if (this.snapshot.hooks.length === before) {
      throw new Error("hook not found")
    }
    await this.save()
    return { status: "ok" }
  }

  async testHook(input: SynapseHookTestPayload): Promise<SynapseHookTestResult> {
    await this.initialize()
    const hook = this.requireHook(input.id)
    const event: SynapseHookEventType = input.event ?? (hook.config.event === "*" ? "message.received" : hook.config.event as SynapseHookEventType)
    const manager = new AutomationHookManager(hook.project, [{ ...hook.config, async: false }], { now: this.now })
    const results = await manager.emit({ event })
    hook.lastRun = this.now().toISOString()
    hook.lastResult = resultSummary(results)
    hook.lastError = resultError(results)
    await this.save()
    return { results: results as SynapseHookTestResult["results"] }
  }

  private async initialize(projects: readonly SynapseProjectConfig[] = []): Promise<void> {
    if (!this.initialized) {
      this.snapshot = this.namespace ? await this.namespace.getSingleton() ?? defaultSnapshot() : defaultSnapshot()
      for (const entry of this.snapshot.heartbeats) {
        this.restoreHeartbeat(entry)
      }
      this.initialized = true
    }

    let changed = false
    for (const project of projects) {
      if (!project.heartbeat || this.snapshot.heartbeats.some((entry) => entry.project === projectName(project))) {
        continue
      }
      const entry = normalizeHeartbeatDraft(projects, { project: projectName(project) })
      this.snapshot.heartbeats.push(entry)
      this.restoreHeartbeat(entry)
      changed = true
    }
    if (changed) {
      await this.save()
    }
  }

  private restoreHeartbeat(entry: HeartbeatSnapshot): void {
    if (!entry.config.enabled || !entry.config.sessionKey) {
      this.heartbeat.unregister(entry.project)
      return
    }
    this.heartbeat.restore(entry.project, entry.config, {
      paused: entry.paused,
      runCount: entry.runCount,
      errorCount: entry.errorCount,
      skippedBusy: entry.skippedBusy,
      lastRun: entry.lastRun ? new Date(entry.lastRun) : null,
      lastError: entry.lastError,
    }, entry.workDir)
  }

  private updateHeartbeatState(entry: HeartbeatSnapshot): void {
    const status = this.heartbeat.status(entry.project)
    if (!status) {
      return
    }
    entry.paused = status.paused
    entry.runCount = status.runCount
    entry.errorCount = status.errorCount
    entry.skippedBusy = status.skippedBusy
    entry.lastRun = status.lastRun ? status.lastRun.toISOString() : null
    entry.lastError = status.lastError
  }

  private requireHeartbeat(project: string): HeartbeatSnapshot {
    const entry = this.snapshot.heartbeats.find((item) => item.project === project)
    if (!entry) {
      throw new Error("heartbeat not found")
    }
    return entry
  }

  private requireHook(id: string): HookSnapshot {
    const hook = this.snapshot.hooks.find((item) => item.id === id)
    if (!hook) {
      throw new Error("hook not found")
    }
    return hook
  }

  private async save(): Promise<void> {
    if (!this.namespace) {
      return
    }
    await this.namespace.setSingleton(this.snapshot)
  }

  private toHeartbeatView(entry: HeartbeatSnapshot): SynapseHeartbeatStatus {
    const status = this.heartbeat.status(entry.project)
    return {
      project: entry.project,
      enabled: entry.config.enabled,
      paused: status?.paused ?? entry.paused,
      intervalMins: status?.intervalMins ?? entry.config.intervalMins,
      onlyWhenIdle: status?.onlyWhenIdle ?? entry.config.onlyWhenIdle,
      sessionKey: status?.sessionKey ?? entry.config.sessionKey,
      prompt: entry.config.prompt,
      silent: status?.silent ?? entry.config.silent,
      timeoutMins: entry.config.timeoutMins,
      workDir: entry.workDir,
      runCount: status?.runCount ?? entry.runCount,
      errorCount: status?.errorCount ?? entry.errorCount,
      skippedBusy: status?.skippedBusy ?? entry.skippedBusy,
      lastRun: status?.lastRun ? status.lastRun.toISOString() : entry.lastRun,
      lastError: status?.lastError ?? entry.lastError,
    }
  }
}

function toHookView(hook: HookSnapshot): SynapseHook {
  return {
    id: hook.id,
    project: hook.project,
    event: hook.config.event as SynapseHook["event"],
    type: hook.config.type as SynapseHook["type"],
    command: hook.config.command,
    url: hook.config.url,
    timeout: hook.config.timeout > 0 ? hook.config.timeout : null,
    async: hook.config.async,
    createdAt: hook.createdAt,
    lastRun: hook.lastRun,
    lastError: hook.lastError,
    lastResult: hook.lastResult,
  }
}
