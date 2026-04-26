import fs from "node:fs"
import path from "node:path"

export type HeartbeatConfig = {
  enabled: boolean
  intervalMins?: number
  onlyWhenIdle?: boolean
  sessionKey: string
  prompt?: string
  silent?: boolean
  timeoutMins?: number
}

export type HeartbeatStatus = {
  enabled: boolean
  paused: boolean
  intervalMins: number
  onlyWhenIdle: boolean
  sessionKey: string
  silent: boolean
  runCount: number
  errorCount: number
  skippedBusy: number
  lastRun: Date | null
  lastError: string
}

export type HeartbeatRunResult =
  | { status: "completed"; prompt: string; silent: boolean }
  | { status: "skipped_busy"; sessionKey: string }
  | { status: "not_found"; project: string }
  | { status: "failed"; error: string; prompt: string }
  | { status: "timed_out"; error: string; prompt: string }

export type HeartbeatStateSnapshot = {
  paused?: boolean
  runCount?: number
  errorCount?: number
  skippedBusy?: number
  lastRun?: Date | null
  lastError?: string
}

export type HeartbeatExecutor = (input: {
  project: string
  sessionKey: string
  prompt: string
  silent: boolean
}) => Promise<void>

type HeartbeatEntry = {
  project: string
  workDir: string
  config: Required<HeartbeatConfig>
  originalIntervalMins: number
  paused: boolean
  runCount: number
  errorCount: number
  skippedBusy: number
  lastRun: Date | null
  lastError: string
}

export const DEFAULT_HEARTBEAT_INTERVAL_MINS = 30
export const DEFAULT_HEARTBEAT_TIMEOUT_MINS = 30

export const DEFAULT_HEARTBEAT_PROMPT = `This is a periodic heartbeat check. Please briefly review:
- Any pending tasks or unfinished work
- Current project status
If nothing needs attention, respond briefly that all is well.`

export function readHeartbeatPrompt(workDir: string): string {
  if (!workDir) {
    return ""
  }

  for (const fileName of ["HEARTBEAT.md", "heartbeat.md"]) {
    const filePath = path.join(workDir, fileName)
    if (!fs.existsSync(filePath)) {
      continue
    }
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) {
      continue
    }
    const content = fs.readFileSync(filePath, "utf8").trim()
    if (content) {
      return content
    }
  }

  return ""
}

function normalizeHeartbeatConfig(input: HeartbeatConfig): Required<HeartbeatConfig> {
  return {
    enabled: input.enabled,
    intervalMins: input.intervalMins && input.intervalMins > 0 ? input.intervalMins : DEFAULT_HEARTBEAT_INTERVAL_MINS,
    onlyWhenIdle: input.onlyWhenIdle ?? true,
    sessionKey: input.sessionKey,
    prompt: input.prompt ?? "",
    silent: input.silent ?? true,
    timeoutMins: input.timeoutMins && input.timeoutMins > 0 ? input.timeoutMins : DEFAULT_HEARTBEAT_TIMEOUT_MINS,
  }
}

function cloneStatus(entry: HeartbeatEntry): HeartbeatStatus {
  return {
    enabled: entry.config.enabled,
    paused: entry.paused,
    intervalMins: entry.config.intervalMins,
    onlyWhenIdle: entry.config.onlyWhenIdle,
    sessionKey: entry.config.sessionKey,
    silent: entry.config.silent,
    runCount: entry.runCount,
    errorCount: entry.errorCount,
    skippedBusy: entry.skippedBusy,
    lastRun: entry.lastRun ? new Date(entry.lastRun.getTime()) : null,
    lastError: entry.lastError,
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`heartbeat timed out after ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export class AutomationHeartbeatService {
  private readonly entries = new Map<string, HeartbeatEntry>()
  private readonly executor: HeartbeatExecutor
  private readonly sessionBusy: (sessionKey: string) => boolean
  private readonly now: () => Date

  constructor(options: {
    executor?: HeartbeatExecutor
    sessionBusy?: (sessionKey: string) => boolean
    now?: () => Date
  } = {}) {
    this.executor = options.executor ?? (async () => undefined)
    this.sessionBusy = options.sessionBusy ?? (() => false)
    this.now = options.now ?? (() => new Date())
  }

  register(project: string, config: HeartbeatConfig, workDir = ""): boolean {
    const normalized = normalizeHeartbeatConfig(config)
    if (!normalized.enabled || !normalized.sessionKey) {
      return false
    }

    this.entries.set(project, {
      project,
      workDir,
      config: normalized,
      originalIntervalMins: normalized.intervalMins,
      paused: false,
      runCount: 0,
      errorCount: 0,
      skippedBusy: 0,
      lastRun: null,
      lastError: "",
    })
    return true
  }

  restore(project: string, config: HeartbeatConfig, state: HeartbeatStateSnapshot = {}, workDir = ""): boolean {
    if (!this.register(project, config, workDir)) {
      return false
    }

    const entry = this.entries.get(project)
    if (!entry) {
      return false
    }
    entry.paused = state.paused ?? false
    entry.runCount = state.runCount ?? 0
    entry.errorCount = state.errorCount ?? 0
    entry.skippedBusy = state.skippedBusy ?? 0
    entry.lastRun = state.lastRun ? new Date(state.lastRun.getTime()) : null
    entry.lastError = state.lastError ?? ""
    return true
  }

  unregister(project: string): boolean {
    return this.entries.delete(project)
  }

  status(project: string): HeartbeatStatus | null {
    const entry = this.entries.get(project)
    return entry ? cloneStatus(entry) : null
  }

  pause(project: string): boolean {
    const entry = this.entries.get(project)
    if (!entry) {
      return false
    }
    entry.paused = true
    return true
  }

  resume(project: string): boolean {
    const entry = this.entries.get(project)
    if (!entry) {
      return false
    }
    entry.paused = false
    return true
  }

  setInterval(project: string, intervalMins: number): boolean {
    const entry = this.entries.get(project)
    if (!entry || intervalMins <= 0) {
      return false
    }
    entry.config.intervalMins = intervalMins
    return true
  }

  resetInterval(project: string): boolean {
    const entry = this.entries.get(project)
    if (!entry) {
      return false
    }
    entry.config.intervalMins = entry.originalIntervalMins
    return true
  }

  async triggerNow(project: string): Promise<HeartbeatRunResult> {
    const entry = this.entries.get(project)
    if (!entry) {
      return { status: "not_found", project }
    }
    return this.execute(entry)
  }

  private async execute(entry: HeartbeatEntry): Promise<HeartbeatRunResult> {
    const { config } = entry
    if (config.onlyWhenIdle && this.sessionBusy(config.sessionKey)) {
      entry.skippedBusy += 1
      return { status: "skipped_busy", sessionKey: config.sessionKey }
    }

    const prompt = config.prompt || readHeartbeatPrompt(entry.workDir) || DEFAULT_HEARTBEAT_PROMPT
    const timeoutMs = config.timeoutMins * 60 * 1000

    try {
      await withTimeout(
        this.executor({
          project: entry.project,
          sessionKey: config.sessionKey,
          prompt,
          silent: config.silent,
        }),
        timeoutMs,
      )
      entry.runCount += 1
      entry.lastRun = this.now()
      entry.lastError = ""
      return { status: "completed", prompt, silent: config.silent }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      entry.runCount += 1
      entry.errorCount += 1
      entry.lastRun = this.now()
      entry.lastError = message
      return message.startsWith("heartbeat timed out")
        ? { status: "timed_out", error: message, prompt }
        : { status: "failed", error: message, prompt }
    }
  }
}
