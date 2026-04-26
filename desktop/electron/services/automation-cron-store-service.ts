import { app } from "electron"
import path from "node:path"
import type {
  SynapseCronDeletePayload,
  SynapseCronJob,
  SynapseCronJobDraft,
  SynapseCronListPayload,
  SynapseCronListResult,
  SynapseCronMutationResult,
  SynapseCronTogglePayload,
  SynapseCronUpdatePayload,
} from "../../src/types/automation"
import type { SynapseProjectConfig } from "../../src/types/config"
import { JsonNamespace } from "../runtime/data-repo/backends/json"
import {
  AutomationCronScheduler,
  cronExprToHuman,
  generateCronJobId,
  type AutomationCronJob,
  type AutomationCronJobInput,
} from "./automation-cron-service"

type CronJobSnapshot = Omit<AutomationCronJob, "createdAt" | "lastRun"> & {
  createdAt: string
  lastRun?: string | null
}

type AutomationCronSnapshot = {
  schemaVersion: 1
  jobs: CronJobSnapshot[]
}

type AutomationCronNamespace = Pick<JsonNamespace<AutomationCronSnapshot>, "getSingleton" | "setSingleton">

type AutomationCronStoreServiceOptions = {
  namespace?: AutomationCronNamespace | null
  now?: () => Date
  scheduler?: AutomationCronScheduler
}

const AUTOMATION_CRON_NAMESPACE = "automation.cron"
const AUTOMATION_CRON_SCHEMA_VERSION = 1

function defaultSnapshot(): AutomationCronSnapshot {
  return { schemaVersion: 1, jobs: [] }
}

function isSnapshot(value: unknown): value is AutomationCronSnapshot {
  return typeof value === "object"
    && value !== null
    && (value as AutomationCronSnapshot).schemaVersion === 1
    && Array.isArray((value as AutomationCronSnapshot).jobs)
}

function createNamespace(): JsonNamespace<AutomationCronSnapshot> {
  const userDataPath = app.getPath("userData")
  const dataV1Path = path.join(userDataPath, "data-v1")
  const filePath = path.join(dataV1Path, `${AUTOMATION_CRON_NAMESPACE}.json`)

  return new JsonNamespace({
    name: AUTOMATION_CRON_NAMESPACE,
    schemaVersion: AUTOMATION_CRON_SCHEMA_VERSION,
    backend: "json",
    filePath,
    defaults: defaultSnapshot,
    validate: isSnapshot,
  })
}

function toInput(snapshot: CronJobSnapshot): AutomationCronJobInput {
  return {
    ...snapshot,
    createdAt: new Date(snapshot.createdAt),
    lastRun: snapshot.lastRun ? new Date(snapshot.lastRun) : null,
  }
}

function toSnapshot(job: AutomationCronJob): CronJobSnapshot {
  return {
    ...job,
    createdAt: job.createdAt.toISOString(),
    lastRun: job.lastRun ? job.lastRun.toISOString() : null,
  }
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

function normalizeDraft(
  draft: SynapseCronJobDraft,
  projects: readonly SynapseProjectConfig[],
  now: Date,
): AutomationCronJobInput {
  const project = requireProject(projects, draft.project)
  return {
    id: generateCronJobId(),
    project: projectName(project),
    sessionKey: draft.sessionKey.trim() || defaultSessionKey(project),
    cronExpr: draft.cronExpr.trim(),
    prompt: draft.prompt.trim(),
    exec: draft.exec.trim(),
    workDir: draft.workDir?.trim() ?? "",
    description: draft.description?.trim() ?? "",
    enabled: draft.enabled ?? true,
    silent: draft.silent ?? false,
    mute: draft.mute ?? false,
    sessionMode: draft.sessionMode ?? "",
    mode: draft.mode ?? "",
    timeoutMins: draft.timeoutMins ?? null,
    createdAt: now,
  }
}

function mergePatch(job: AutomationCronJob, patch: Partial<SynapseCronJobDraft>): AutomationCronJobInput {
  return {
    id: job.id,
    project: patch.project ?? job.project,
    sessionKey: patch.sessionKey ?? job.sessionKey,
    cronExpr: patch.cronExpr ?? job.cronExpr,
    prompt: patch.prompt ?? job.prompt,
    exec: patch.exec ?? job.exec,
    workDir: patch.workDir ?? job.workDir,
    description: patch.description ?? job.description,
    enabled: patch.enabled ?? job.enabled,
    silent: patch.silent ?? job.silent ?? false,
    mute: patch.mute ?? job.mute ?? false,
    sessionMode: patch.sessionMode ?? job.sessionMode,
    mode: patch.mode ?? job.mode,
    timeoutMins: patch.timeoutMins ?? job.timeoutMins ?? null,
    createdAt: job.createdAt,
    lastRun: job.lastRun ?? null,
    lastError: job.lastError ?? "",
  }
}

function permissionRequired(input: Pick<SynapseCronJobDraft, "exec" | "permissionDecision">): SynapseCronMutationResult | null {
  if (!input.exec?.trim()) {
    return null
  }
  if (input.permissionDecision === "deny") {
    return { status: "denied", job: null, error: null }
  }
  if (input.permissionDecision !== "allow") {
    return { status: "permission_required", job: null, error: null }
  }
  return null
}

export class AutomationCronStoreService {
  private readonly namespace: AutomationCronNamespace | null
  private readonly now: () => Date
  private readonly scheduler: AutomationCronScheduler
  private initialized = false

  constructor(options: AutomationCronStoreServiceOptions = {}) {
    this.namespace = options.namespace === undefined ? createNamespace() : options.namespace
    this.now = options.now ?? (() => new Date())
    this.scheduler = options.scheduler ?? new AutomationCronScheduler()
  }

  async list(input: SynapseCronListPayload = {}): Promise<SynapseCronListResult> {
    await this.initialize()
    const jobs = input.project?.trim()
      ? this.scheduler.getStore().listByProject(input.project.trim())
      : this.scheduler.getStore().list()

    return {
      jobs: jobs
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .map((job) => this.toView(job)),
    }
  }

  async create(
    projects: readonly SynapseProjectConfig[],
    draft: SynapseCronJobDraft,
  ): Promise<SynapseCronMutationResult> {
    await this.initialize()
    const gate = permissionRequired(draft)
    if (gate) {
      return gate
    }

    const job = this.scheduler.addJob(normalizeDraft(draft, projects, this.now()))
    await this.save()
    return { status: "ok", job: this.toView(job), error: null }
  }

  async update(input: SynapseCronUpdatePayload): Promise<SynapseCronMutationResult> {
    await this.initialize()
    const existing = this.scheduler.getStore().get(input.id)
    if (!existing) {
      throw new Error("cron job not found")
    }

    const nextExec = input.patch.exec ?? existing.exec
    const gate = permissionRequired({ exec: nextExec, permissionDecision: input.patch.permissionDecision })
    if (gate) {
      return gate
    }

    const updated = this.scheduler.replaceJob(input.id, mergePatch(existing, input.patch))
    await this.save()
    return { status: "ok", job: this.toView(updated), error: null }
  }

  async toggle(input: SynapseCronTogglePayload): Promise<SynapseCronJob> {
    await this.initialize()
    if (input.enabled) {
      this.scheduler.enableJob(input.id)
    } else {
      this.scheduler.disableJob(input.id)
    }
    await this.save()
    const job = this.scheduler.getStore().get(input.id)
    if (!job) {
      throw new Error("cron job not found")
    }
    return this.toView(job)
  }

  async delete(input: SynapseCronDeletePayload): Promise<{ status: "ok" }> {
    await this.initialize()
    if (!this.scheduler.removeJob(input.id)) {
      throw new Error("cron job not found")
    }
    await this.save()
    return { status: "ok" }
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    const snapshot = this.namespace ? await this.namespace.getSingleton() : null
    for (const job of snapshot?.jobs ?? []) {
      this.scheduler.addJob(toInput(job))
    }
    this.initialized = true
  }

  private async save(): Promise<void> {
    if (!this.namespace) {
      return
    }

    await this.namespace.setSingleton({
      schemaVersion: 1,
      jobs: this.scheduler.getStore().list().map(toSnapshot),
    })
  }

  private toView(job: AutomationCronJob): SynapseCronJob {
    let nextRunAt: string | null = null
    if (job.enabled) {
      nextRunAt = this.scheduler.nextRun(job.id, this.now())?.toISOString() ?? null
    }

    return {
      id: job.id,
      project: job.project,
      sessionKey: job.sessionKey,
      cronExpr: job.cronExpr,
      prompt: job.prompt,
      exec: job.exec,
      workDir: job.workDir,
      description: job.description,
      enabled: job.enabled,
      silent: Boolean(job.silent),
      mute: Boolean(job.mute),
      sessionMode: job.sessionMode,
      mode: job.mode,
      timeoutMins: job.timeoutMins ?? null,
      createdAt: job.createdAt.toISOString(),
      lastRun: job.lastRun ? job.lastRun.toISOString() : null,
      lastError: job.lastError ?? "",
      nextRunAt,
      scheduleText: cronExprToHuman(job.cronExpr, "zh"),
      requiresPermission: Boolean(job.exec.trim()),
    }
  }
}
