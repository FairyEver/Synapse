import { stat } from "node:fs/promises"
import path from "node:path"

import type { DataRepository } from "../../runtime/data-repo"
import type { ProjectContainerRegistry } from "../../runtime/project-container"
import type { ControlledProcessRunner } from "../../runtime/process"
import type { StructuredLogger } from "../../runtime/service-registry"
import {
  AgentRuntimeService,
  AGENT_RUNTIME_SERVICE_ID,
  type AgentMessage,
} from "../agent-runtime"
import type { FeishuConnectorService } from "../connectors"
import { reconstructFeishuReplyContext } from "../connectors"
import type { ProcessIsolationResolver } from "../execution-isolation"
import type { ReplyTarget } from "../reply-target"
import type { SideChannelService } from "../side-channel"
import { WorkspaceBindingRepository, isDirectory, normalizeWorkspacePath } from "../workspaces"
import type { HeartbeatRecord, ScheduledJobRecord, ScheduledJobRunResult } from "./types"

const DEFAULT_TIMEOUT_MINS = 30
const MAX_REPLY_CHARS = 3000

export interface SchedulerProjectSummary {
  readonly projectId: string
  readonly name?: string
  readonly workspacePath?: string
}

export interface CronExecutionServiceDeps {
  readonly projectContainers: ProjectContainerRegistry
  readonly dataRepository: DataRepository
  readonly processRunner: ControlledProcessRunner
  readonly executionIsolation?: ProcessIsolationResolver
  readonly sideChannel: SideChannelService
  readonly feishuConnector: FeishuConnectorService
  readonly listProjects: () => Promise<readonly SchedulerProjectSummary[]>
  readonly workspaceBindings?: WorkspaceBindingRepository
  readonly logger?: StructuredLogger
  readonly now?: () => Date
}

export class CronExecutionService {
  private readonly deps: CronExecutionServiceDeps
  private readonly workspaceBindings: WorkspaceBindingRepository

  constructor(deps: CronExecutionServiceDeps) {
    this.deps = deps
    this.workspaceBindings = deps.workspaceBindings ?? new WorkspaceBindingRepository({
      bindings: deps.dataRepository.namespace("workspace.bindings"),
    })
  }

  async executeJob(job: ScheduledJobRecord): Promise<ScheduledJobRunResult> {
    if (!job.enabled) return { status: "skipped", error: "job is disabled" }
    try {
      const context = await this.resolveContext(job)
      await this.deps.feishuConnector.assertReplyTargetAvailable(context.target)
      if (!job.mute && !job.silent) {
        await this.sendStatus(context.target, `定时任务已开始：${jobName(job)}`)
      }
      if (job.kind === "exec") {
        return await this.executeShellJob(job, context)
      }
      return await this.executePromptJob(job, context)
    } catch (error) {
      const message = errorMessage(error)
      if (!job.mute) {
        await this.trySendFailure(job, message)
      }
      return { status: "failed", error: message }
    }
  }

  async executeHeartbeat(entry: HeartbeatRecord): Promise<ScheduledJobRunResult> {
    if (!entry.enabled || entry.paused) return { status: "skipped", error: "heartbeat is paused" }
    try {
      const context = await this.resolveContext(entry)
      await this.deps.feishuConnector.assertReplyTargetAvailable(context.target)
      if (!entry.mute && !entry.silent) {
        await this.sendStatus(context.target, "Heartbeat 已开始")
      }
      const result = await this.executePrompt({
        projectId: entry.projectId,
        connectorId: entry.connectorId,
        sessionKey: entry.sessionKey,
        channelKey: entry.channelKey,
        workspaceKey: context.workspaceKey,
        workspacePath: context.workspacePath,
        replyCtx: context.target.replyCtx,
        content: entry.prompt,
        userId: "heartbeat",
        userName: "heartbeat",
        modeOverride: undefined,
        mute: entry.mute,
        sideSessionName: `Heartbeat ${this.isoNow()}`,
        sessionMode: "reuse",
      })
      if (result.error) {
        if (!entry.mute) await this.sendStatus(context.target, `Heartbeat 失败：${truncate(result.error)}`)
        return { status: "failed", error: result.error }
      }
      if (!entry.mute && !result.resultText.trim()) {
        await this.sendStatus(context.target, "Heartbeat 完成")
      }
      return { status: "success" }
    } catch (error) {
      const message = errorMessage(error)
      if (!entry.mute) {
        await this.trySendFailure(entry, message)
      }
      return { status: "failed", error: message }
    }
  }

  async replyTargetFor(item: AutomationTargetInput): Promise<ReplyTarget> {
    const replyCtx = recordValue(item.replyCtx)
      ?? reconstructFeishuReplyContext({
        projectId: item.projectId,
        connectorId: item.connectorId,
        sessionKey: item.sessionKey,
      }) ?? undefined
    if (!replyCtx) {
      throw new Error("Feishu reply target is missing reply context")
    }
    return {
      projectId: item.projectId,
      sessionKey: item.sessionKey,
      transport: {
        kind: "feishu",
        connectorId: item.connectorId,
      },
      replyCtx,
      metadata: {
        channelKey: item.channelKey,
        workspaceKey: item.workspaceKey,
        workspacePath: item.workspacePath,
      },
    }
  }

  private async executePromptJob(
    job: ScheduledJobRecord,
    context: ResolvedExecutionContext,
  ): Promise<ScheduledJobRunResult> {
    const result = await this.executePrompt({
      projectId: job.projectId,
      connectorId: job.connectorId,
      sessionKey: job.sessionKey,
      channelKey: job.channelKey,
      workspaceKey: context.workspaceKey,
      workspacePath: context.workspacePath,
      replyCtx: context.target.replyCtx,
      content: job.prompt ?? "",
      userId: "cron",
      userName: "cron",
      modeOverride: job.modeOverride,
      mute: job.mute,
      sideSessionName: `Cron ${job.id} ${this.isoNow()}`,
      sessionMode: job.sessionMode,
    })
    if (result.error) {
      if (!job.mute) await this.sendStatus(context.target, `定时任务失败：${truncate(result.error)}`)
      return { status: "failed", error: result.error }
    }
    if (!job.mute && !result.resultText.trim()) {
      await this.sendStatus(context.target, `定时任务完成：${jobName(job)}`)
    }
    return { status: "success" }
  }

  private async executePrompt(input: PromptExecutionInput) {
    const project = await this.resolveProject(input.projectId)
    const container = await this.deps.projectContainers.open(input.projectId, {
      name: project.name,
      workspacePath: project.workspacePath,
    })
    const agent = container.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID)
    const replyCtx = input.mute
      ? { ...(recordValue(input.replyCtx) ?? {}), muted: true }
      : input.replyCtx
    const message: AgentMessage = {
      projectId: input.projectId,
      sessionKey: input.sessionKey,
      channelKey: input.channelKey,
      platform: "feishu",
      userId: input.userId,
      userName: input.userName,
      content: input.content,
      replyCtx,
      modeOverride: input.modeOverride,
      workspaceKey: input.workspaceKey,
      workspacePath: input.workspacePath,
      createdAt: this.isoNow(),
    }
    const restoreTarget = await this.replyTargetFor(input)
    try {
      if (input.sessionMode === "new_per_run") {
        return await agent.sendNewSession(message, input.sideSessionName)
      }
      return await agent.send(message)
    } finally {
      if (input.mute) this.deps.sideChannel.rememberReplyTarget(restoreTarget)
    }
  }

  private async executeShellJob(
    job: ScheduledJobRecord,
    context: ResolvedExecutionContext,
  ): Promise<ScheduledJobRunResult> {
    const shell = process.platform === "win32"
      ? { command: "cmd.exe", args: ["/d", "/s", "/c", job.exec ?? ""] }
      : { command: "/bin/sh", args: ["-lc", job.exec ?? ""] }
    const timeoutMs = timeoutMinsToMs(job.timeoutMins)
    const env = this.deps.sideChannel.getAgentEnv(job.projectId, job.sessionKey)
    const result = await this.deps.processRunner.run({
      actor: { kind: "agent", id: "scheduler" },
      action: "shell.exec",
      command: shell.command,
      args: shell.args,
      cwd: context.workDir,
      env,
      envAllowlist: env ? Object.keys(env) : undefined,
      isolation: await this.deps.executionIsolation?.resolveProcessIsolation(
        job.projectId,
        Object.keys(env ?? {}),
      ),
      timeoutMs,
      output: {
        stdout: "buffer",
        stderr: "buffer",
        maxBufferBytes: 1024 * 1024,
      },
      metadata: {
        source: "scheduler",
        projectId: job.projectId,
        sessionKey: job.sessionKey,
        jobId: job.id,
      },
    })
    const output = formatShellOutput(result.stdout, result.stderr)
    if (result.timedOut) {
      if (!job.mute) {
        await this.sendStatus(context.target, `定时任务超时：${job.timeoutMins ?? DEFAULT_TIMEOUT_MINS} 分钟`)
      }
      return { status: "timeout", error: "shell command timed out" }
    }
    if (result.exitCode !== 0 || result.error) {
      const message = result.error ?? `shell command exited with ${String(result.exitCode)}`
      if (!job.mute) {
        await this.sendStatus(context.target, `定时任务失败：${truncate(output || message)}`)
      }
      return { status: "failed", error: message }
    }
    if (!job.mute) {
      await this.sendStatus(context.target, output ? truncate(output) : `定时任务完成：${jobName(job)}`)
    }
    return { status: "success" }
  }

  private async resolveContext(item: AutomationTargetInput): Promise<ResolvedExecutionContext> {
    const project = await this.resolveProject(item.projectId)
    const target = await this.replyTargetFor(item)
    const resolved = await this.resolveWorkDir(item, project.workspacePath)
    return {
      target,
      project,
      workspaceKey: resolved.workspaceKey ?? item.workspaceKey,
      workspacePath: resolved.workspacePath ?? item.workspacePath,
      workDir: resolved.workDir,
    }
  }

  private async resolveWorkDir(
    item: AutomationTargetInput,
    projectWorkspacePath: string | undefined,
  ): Promise<ResolvedWorkDir> {
    if ("workDir" in item && item.workDir) {
      return {
        workDir: await requireDirectory(item.workDir),
        workspacePath: item.workspacePath,
        workspaceKey: item.workspaceKey,
      }
    }
    if (item.workspacePath) {
      const workspacePath = await requireDirectory(item.workspacePath)
      return {
        workDir: workspacePath,
        workspacePath,
        workspaceKey: item.workspaceKey ?? workspaceKeyForPath(workspacePath),
      }
    }
    if (item.channelKey) {
      const binding = await this.workspaceBindings.lookupEffective(item.projectId, item.channelKey)
      if (binding) {
        const workspacePath = await requireDirectory(binding.binding.workspacePath)
        return {
          workDir: workspacePath,
          workspacePath,
          workspaceKey: workspaceKeyForPath(workspacePath),
        }
      }
    }
    if (projectWorkspacePath && await pathExistsAsDirectory(projectWorkspacePath)) {
      const normalized = await normalizeWorkspacePath(projectWorkspacePath)
      return { workDir: normalized }
    }
    throw new Error("Project workspace path is required")
  }

  private async resolveProject(projectId: string): Promise<SchedulerProjectSummary> {
    const project = (await this.deps.listProjects()).find((item) => item.projectId === projectId)
    if (!project) throw new Error(`Project "${projectId}" was not found`)
    return project
  }

  private async trySendFailure(item: AutomationTargetInput, error: string): Promise<void> {
    try {
      const target = await this.replyTargetFor(item)
      await this.sendStatus(target, `定时任务失败：${truncate(error)}`)
    } catch (sendError) {
      this.deps.logger?.warn("Failed to send scheduler failure message.", {
        error: errorMessage(sendError),
        projectId: item.projectId,
        sessionKey: item.sessionKey,
      })
    }
  }

  private sendStatus(target: ReplyTarget, content: string): Promise<void> {
    return this.deps.feishuConnector.sendAutomationMessage(target, content)
  }

  private isoNow(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}

interface ResolvedExecutionContext {
  readonly target: ReplyTarget
  readonly project: SchedulerProjectSummary
  readonly workspaceKey?: string
  readonly workspacePath?: string
  readonly workDir: string
}

interface ResolvedWorkDir {
  readonly workspaceKey?: string
  readonly workspacePath?: string
  readonly workDir: string
}

type AutomationTargetInput = Pick<
  ScheduledJobRecord | HeartbeatRecord,
  | "projectId"
  | "connectorId"
  | "sessionKey"
  | "channelKey"
  | "workspaceKey"
  | "workspacePath"
  | "replyCtx"
> & {
  readonly workDir?: string
}

interface PromptExecutionInput extends AutomationTargetInput {
  readonly content: string
  readonly userId: "cron" | "heartbeat"
  readonly userName: "cron" | "heartbeat"
  readonly modeOverride?: string
  readonly mute: boolean
  readonly sessionMode: "reuse" | "new_per_run"
  readonly sideSessionName: string
}

async function requireDirectory(targetPath: string): Promise<string> {
  const normalized = await normalizeWorkspacePath(targetPath)
  if (!await isDirectory(normalized)) {
    throw new Error(`目录不存在：${normalized}`)
  }
  return normalized
}

async function pathExistsAsDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isDirectory()
  } catch {
    return false
  }
}

function workspaceKeyForPath(workspacePath: string): string {
  return `workspace:${Buffer.from(path.resolve(workspacePath)).toString("base64url")}`
}

function timeoutMinsToMs(timeoutMins: number | undefined): number | undefined {
  if (timeoutMins === 0) return undefined
  return (timeoutMins ?? DEFAULT_TIMEOUT_MINS) * 60_000
}

function formatShellOutput(stdout: string | undefined, stderr: string | undefined): string {
  return [stdout?.trim(), stderr?.trim()].filter(Boolean).join("\n")
}

function truncate(value: string): string {
  if (value.length <= MAX_REPLY_CHARS) return value
  return `${value.slice(0, MAX_REPLY_CHARS)}\n...已截断`
}

function jobName(job: ScheduledJobRecord): string {
  return job.description?.trim() || job.id
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
