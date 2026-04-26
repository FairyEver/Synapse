import type { StructuredLogger } from "../../runtime/service-registry"
import type {
  SideChannelCronAddContext,
  SideChannelCronAddResult,
  SideChannelService,
} from "../side-channel"
import { parseScheduleArgs, parseSlashCommand } from "./command-utils"
import { nextCronRun } from "./cron-expression"
import type { CronExecutionService } from "./execution-service"
import type { ScheduledJobRepository } from "./scheduled-job-repository"
import type {
  FeishuAutomationCommandContext,
  ScheduledJobCreateInput,
  ScheduledJobRecord,
  ScheduledJobUpdateInput,
} from "./types"

export interface SchedulerServiceDeps {
  readonly repository: ScheduledJobRepository
  readonly execution: CronExecutionService
  readonly sideChannel?: SideChannelService
  readonly logger?: StructuredLogger
  readonly now?: () => Date
}

export class SchedulerService {
  private readonly deps: SchedulerServiceDeps
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private unregisterCronAdd: (() => void) | undefined
  private started = false

  constructor(deps: SchedulerServiceDeps) {
    this.deps = deps
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.unregisterCronAdd = this.deps.sideChannel?.registerCronAddHandler((context) =>
      this.handleSideChannelCronAdd(context))
    const jobs = await this.deps.repository.listAll()
    for (const job of jobs) {
      if (job.enabled) await this.schedule(job.id)
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.unregisterCronAdd?.()
    this.unregisterCronAdd = undefined
    this.started = false
  }

  async create(input: ScheduledJobCreateInput): Promise<ScheduledJobRecord> {
    const job = await this.deps.repository.create(input)
    if (this.started && job.enabled) await this.schedule(job.id)
    return job
  }

  async update(id: string, patch: ScheduledJobUpdateInput): Promise<ScheduledJobRecord> {
    this.cancel(id)
    const job = await this.deps.repository.update(id, patch)
    if (this.started && job.enabled) await this.schedule(job.id)
    return job
  }

  async delete(id: string): Promise<boolean> {
    this.cancel(id)
    return this.deps.repository.delete(id)
  }

  async setEnabled(id: string, enabled: boolean): Promise<ScheduledJobRecord> {
    this.cancel(id)
    const job = await this.deps.repository.setEnabled(id, enabled)
    if (this.started && job.enabled) await this.schedule(job.id)
    return job
  }

  async setMuted(id: string, mute: boolean): Promise<ScheduledJobRecord> {
    return this.deps.repository.setMuted(id, mute)
  }

  async runNow(id: string): Promise<ScheduledJobRecord | null> {
    const job = await this.deps.repository.get(id)
    if (!job) return null
    const result = await this.deps.execution.executeJob(job)
    return this.deps.repository.markRun(id, result)
  }

  get(id: string): Promise<ScheduledJobRecord | null> {
    return this.deps.repository.get(id)
  }

  listByProject(projectId: string): Promise<ScheduledJobRecord[]> {
    return this.deps.repository.listByProject(projectId)
  }

  listBySession(projectId: string, sessionKey: string): Promise<ScheduledJobRecord[]> {
    return this.deps.repository.listBySession(projectId, sessionKey)
  }

  async handleFeishuCommand(ctx: FeishuAutomationCommandContext): Promise<boolean> {
    const args = parseSlashCommand(ctx.message.content, "cron")
    if (!args) return false
    const [subCommand = "help", ...rest] = args
    switch (subCommand) {
      case "help":
        await ctx.reply("用法：/cron add <cron> <prompt>，/cron list，/cron enable|disable|delete <id>")
        return true
      case "add": {
        const parsed = parseScheduleArgs(rest)
        if (!parsed?.body) {
          await ctx.reply("用法：/cron add \"*/30 * * * *\" <prompt>")
          return true
        }
        const job = await this.create({
          projectId: ctx.projectId,
          platform: "feishu",
          connectorId: ctx.connectorId,
          sessionKey: ctx.message.sessionKey,
          channelKey: ctx.message.channelKey,
          channelName: ctx.message.channelName,
          workspaceKey: ctx.message.workspaceKey,
          workspacePath: ctx.message.workspacePath,
          replyCtx: recordValue(ctx.message.replyCtx),
          kind: "prompt",
          cronExpr: parsed.cronExpr,
          prompt: parsed.body,
          description: shortDescription(parsed.body),
          createdBy: ctx.message.userId,
        })
        await ctx.reply(`已创建定时任务：${job.id}`)
        return true
      }
      case "addexec": {
        if (!ctx.isAdmin) {
          await ctx.reply("当前飞书用户无权创建命令任务。")
          return true
        }
        const parsed = parseScheduleArgs(rest)
        if (!parsed?.body) {
          await ctx.reply("用法：/cron addexec \"0 9 * * *\" <command>")
          return true
        }
        const job = await this.create({
          projectId: ctx.projectId,
          platform: "feishu",
          connectorId: ctx.connectorId,
          sessionKey: ctx.message.sessionKey,
          channelKey: ctx.message.channelKey,
          channelName: ctx.message.channelName,
          workspaceKey: ctx.message.workspaceKey,
          workspacePath: ctx.message.workspacePath,
          replyCtx: recordValue(ctx.message.replyCtx),
          kind: "exec",
          cronExpr: parsed.cronExpr,
          exec: parsed.body,
          description: shortDescription(parsed.body),
          createdBy: ctx.message.userId,
        })
        await ctx.reply(`已创建命令任务：${job.id}`)
        return true
      }
      case "list": {
        const jobs = await this.listBySession(ctx.projectId, ctx.message.sessionKey)
        await ctx.reply(formatJobList(jobs))
        return true
      }
      case "delete":
      case "del":
      case "rm":
      case "remove": {
        const id = rest[0]
        if (!id) {
          await ctx.reply("用法：/cron delete <id>")
          return true
        }
        const job = await this.get(id)
        if (!job || job.projectId !== ctx.projectId) {
          await ctx.reply("未找到定时任务。")
          return true
        }
        await this.delete(id)
        await ctx.reply("已删除。")
        return true
      }
      case "enable":
      case "disable": {
        const id = rest[0]
        if (!id) {
          await ctx.reply(`用法：/cron ${subCommand} <id>`)
          return true
        }
        const job = await this.get(id)
        if (!job || job.projectId !== ctx.projectId) {
          await ctx.reply("未找到定时任务。")
          return true
        }
        await this.setEnabled(id, subCommand === "enable")
        await ctx.reply(subCommand === "enable" ? "已启用。" : "已禁用。")
        return true
      }
      case "mute":
      case "unmute": {
        const id = rest[0]
        if (!id) {
          await ctx.reply(`用法：/cron ${subCommand} <id>`)
          return true
        }
        const job = await this.get(id)
        if (!job || job.projectId !== ctx.projectId) {
          await ctx.reply("未找到定时任务。")
          return true
        }
        await this.setMuted(id, subCommand === "mute")
        await ctx.reply(subCommand === "mute" ? "已静默。" : "已取消静默。")
        return true
      }
      case "run": {
        const id = rest[0]
        if (!id) {
          await ctx.reply("用法：/cron run <id>")
          return true
        }
        const job = await this.runNow(id)
        await ctx.reply(job ? "已触发。" : "未找到定时任务。")
        return true
      }
      default:
        await ctx.reply("用法：/cron add|addexec|list|delete|enable|disable|mute|unmute")
        return true
    }
  }

  private async schedule(id: string): Promise<void> {
    this.cancel(id)
    const job = await this.deps.repository.get(id)
    if (!job?.enabled) return
    const nextRunAt = nextCronRun(job.cronExpr, this.now())
    await this.deps.repository.markScheduled(id, nextRunAt.toISOString())
    const delayMs = Math.max(0, nextRunAt.getTime() - this.now().getTime())
    const jobId = id
    const timer = setTimeout(() => {
      void this.runScheduled(jobId)
    }, delayMs)
    this.timers.set(id, timer)
  }

  private async handleSideChannelCronAdd(
    context: SideChannelCronAddContext,
  ): Promise<SideChannelCronAddResult> {
    const request = context.request
    const cronExpr = request.cronExpr ?? request.cron_expr
    if (!cronExpr?.trim()) {
      throw new Error("cronExpr is required")
    }
    const prompt = request.prompt?.trim()
    const command = request.exec?.trim()
    const connectorId = context.target.transport.connectorId
      ?? stringValue(recordValue(context.target.replyCtx)?.connectorId)
    if (!connectorId) throw new Error("Feishu connectorId is required")
    const job = await this.create({
      projectId: context.projectId,
      platform: "feishu",
      connectorId,
      sessionKey: context.sessionKey,
      channelKey: stringValue(context.target.metadata?.channelKey),
      channelName: stringValue(context.target.metadata?.channelName),
      workspaceKey: stringValue(context.target.metadata?.workspaceKey),
      workspacePath: stringValue(context.target.metadata?.workspacePath),
      replyCtx: recordValue(context.target.replyCtx),
      kind: command ? "exec" : "prompt",
      cronExpr,
      prompt,
      exec: command,
      workDir: request.workDir ?? request.work_dir,
      description: request.description,
      silent: request.silent,
      mute: request.mute,
      sessionMode: request.sessionMode ?? request.session_mode,
      modeOverride: request.mode,
      timeoutMins: request.timeoutMins ?? request.timeout_mins,
      createdBy: "side-channel",
    })
    return {
      ok: true,
      projectId: job.projectId,
      sessionKey: job.sessionKey,
      jobId: job.id,
      nextRunAt: job.nextRunAt,
    }
  }

  private async runScheduled(id: string): Promise<void> {
    this.timers.delete(id)
    const job = await this.deps.repository.get(id)
    if (!job) return
    if (!job.enabled) {
      await this.deps.repository.markRun(id, { status: "skipped", error: "job is disabled" })
      return
    }
    await this.schedule(id)
    const latest = await this.deps.repository.get(id)
    if (!latest?.enabled) return
    const result = await this.deps.execution.executeJob(latest)
    await this.deps.repository.markRun(id, result)
    if (result.status !== "success") {
      this.deps.logger?.warn("Scheduled job failed.", {
        projectId: latest.projectId,
        jobId: id,
        status: result.status,
        error: result.error,
      })
    }
  }

  private cancel(id: string): void {
    const timer = this.timers.get(id)
    if (!timer) return
    clearTimeout(timer)
    this.timers.delete(id)
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }
}

function formatJobList(jobs: readonly ScheduledJobRecord[]): string {
  if (jobs.length === 0) return "暂无定时任务。"
  return jobs.map((job) => [
    job.id,
    job.enabled ? "enabled" : "disabled",
    job.mute ? "mute" : "unmute",
    job.nextRunAt ? `next=${job.nextRunAt}` : "next=-",
    job.description ?? job.kind,
  ].join(" | ")).join("\n")
}

function shortDescription(value: string): string {
  const trimmed = value.trim()
  return trimmed.length <= 40 ? trimmed : `${trimmed.slice(0, 40)}...`
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}
