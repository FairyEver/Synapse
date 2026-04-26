import type { StructuredLogger } from "../../runtime/service-registry"
import { parseSlashCommand } from "./command-utils"
import type { CronExecutionService } from "./execution-service"
import type { HeartbeatRepository } from "./heartbeat-repository"
import type {
  FeishuAutomationCommandContext,
  HeartbeatCreateInput,
  HeartbeatRecord,
  HeartbeatUpdateInput,
} from "./types"

export interface HeartbeatServiceDeps {
  readonly repository: HeartbeatRepository
  readonly execution: CronExecutionService
  readonly logger?: StructuredLogger
  readonly now?: () => Date
}

export class HeartbeatService {
  private readonly deps: HeartbeatServiceDeps
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private started = false

  constructor(deps: HeartbeatServiceDeps) {
    this.deps = deps
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    const entries = await this.deps.repository.listAll()
    for (const entry of entries) {
      if (entry.enabled && !entry.paused) await this.schedule(entry.id)
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.started = false
  }

  async upsert(input: HeartbeatCreateInput): Promise<HeartbeatRecord> {
    const entry = await this.deps.repository.upsert(input)
    this.cancel(entry.id)
    if (this.started && entry.enabled && !entry.paused) await this.schedule(entry.id)
    return entry
  }

  async update(id: string, patch: HeartbeatUpdateInput): Promise<HeartbeatRecord> {
    this.cancel(id)
    const entry = await this.deps.repository.update(id, patch)
    if (this.started && entry.enabled && !entry.paused) await this.schedule(entry.id)
    return entry
  }

  async delete(id: string): Promise<boolean> {
    this.cancel(id)
    return this.deps.repository.delete(id)
  }

  async pause(id: string): Promise<HeartbeatRecord> {
    return this.update(id, { paused: true })
  }

  async resume(id: string): Promise<HeartbeatRecord> {
    return this.update(id, { enabled: true, paused: false })
  }

  async runNow(id: string): Promise<HeartbeatRecord | null> {
    const entry = await this.deps.repository.get(id)
    if (!entry) return null
    const result = await this.deps.execution.executeHeartbeat(entry)
    return this.deps.repository.markRun(id, result)
  }

  get(id: string): Promise<HeartbeatRecord | null> {
    return this.deps.repository.get(id)
  }

  listByProject(projectId: string): Promise<HeartbeatRecord[]> {
    return this.deps.repository.listByProject(projectId)
  }

  listAll(): Promise<HeartbeatRecord[]> {
    return this.deps.repository.listAll()
  }

  findBySession(projectId: string, sessionKey: string): Promise<HeartbeatRecord | null> {
    return this.deps.repository.findBySession(projectId, sessionKey)
  }

  async handleFeishuCommand(ctx: FeishuAutomationCommandContext): Promise<boolean> {
    const args = parseSlashCommand(ctx.message.content, "heartbeat")
    if (!args) return false
    const [subCommand = "status", ...rest] = args
    const existing = await this.findBySession(ctx.projectId, ctx.message.sessionKey)
    switch (subCommand) {
      case "help":
        await ctx.reply("用法：/heartbeat status|pause|resume|run")
        return true
      case "status":
        await ctx.reply(existing ? formatHeartbeat(existing) : "Heartbeat 未配置。")
        return true
      case "pause":
        if (!existing) {
          await ctx.reply("Heartbeat 未配置。")
          return true
        }
        await this.pause(existing.id)
        await ctx.reply("已暂停。")
        return true
      case "resume": {
        const interval = Number(rest[0] ?? existing?.intervalMins ?? 60)
        if (!Number.isInteger(interval) || interval < 1) {
          await ctx.reply("用法：/heartbeat resume [interval_mins]")
          return true
        }
        const entry = existing
          ? await this.resume(existing.id)
          : await this.upsert({
            projectId: ctx.projectId,
            platform: "feishu",
            connectorId: ctx.connectorId,
            sessionKey: ctx.message.sessionKey,
            channelKey: ctx.message.channelKey,
            workspaceKey: ctx.message.workspaceKey,
            workspacePath: ctx.message.workspacePath,
            replyCtx: recordValue(ctx.message.replyCtx),
            intervalMins: interval,
          })
        await ctx.reply(`Heartbeat 已启用：${entry.intervalMins} 分钟`)
        return true
      }
      case "run": {
        const entry = existing
          ?? await this.upsert({
            projectId: ctx.projectId,
            platform: "feishu",
            connectorId: ctx.connectorId,
            sessionKey: ctx.message.sessionKey,
            channelKey: ctx.message.channelKey,
            workspaceKey: ctx.message.workspaceKey,
            workspacePath: ctx.message.workspacePath,
            replyCtx: recordValue(ctx.message.replyCtx),
            intervalMins: 60,
          })
        await this.runNow(entry.id)
        await ctx.reply("已触发。")
        return true
      }
      default:
        await ctx.reply("用法：/heartbeat status|pause|resume|run")
        return true
    }
  }

  private async schedule(id: string): Promise<void> {
    this.cancel(id)
    const entry = await this.deps.repository.get(id)
    if (!entry?.enabled || entry.paused) return
    const nextRunAt = new Date(this.now().getTime() + entry.intervalMins * 60_000)
    await this.deps.repository.markScheduled(id, nextRunAt.toISOString())
    const timer = setTimeout(() => {
      void this.runScheduled(id)
    }, Math.max(0, nextRunAt.getTime() - this.now().getTime()))
    this.timers.set(id, timer)
  }

  private async runScheduled(id: string): Promise<void> {
    this.timers.delete(id)
    const entry = await this.deps.repository.get(id)
    if (!entry) return
    if (!entry.enabled || entry.paused) {
      await this.deps.repository.markRun(id, { status: "skipped", error: "heartbeat is paused" })
      return
    }
    await this.schedule(id)
    const latest = await this.deps.repository.get(id)
    if (!latest?.enabled || latest.paused) return
    const result = await this.deps.execution.executeHeartbeat(latest)
    await this.deps.repository.markRun(id, result)
    if (result.status !== "success") {
      this.deps.logger?.warn("Heartbeat failed.", {
        projectId: latest.projectId,
        heartbeatId: id,
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

function formatHeartbeat(entry: HeartbeatRecord): string {
  const status = entry.paused || !entry.enabled ? "paused" : "enabled"
  const next = entry.nextRunAt ?? "-"
  return `${status} | interval=${entry.intervalMins} | next=${next}`
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
