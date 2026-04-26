import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { DEFAULT_CC_CONNECT_SETTINGS } from "../../src/constants/defaults"
import type {
  SynapseCcConnectDiagnostics,
  SynapseCcConnectRawConfigResult,
  SynapseCcConnectRestartPayload,
  SynapseCcConnectRestartResult,
  SynapseCcConnectSettings,
  SynapseCcConnectSettingsUpdate,
  SynapseCcConnectReloadResult,
  SynapseConfig,
} from "../../src/types/config"

type ConfigAccess = {
  load: () => Promise<SynapseConfig>
  update: (patch: { global: { ccConnect: SynapseCcConnectSettings } }) => Promise<SynapseConfig>
}

type CcConnectSettingsServiceOptions = {
  config?: ConfigAccess
  homeDir?: string
  now?: () => Date
  pathStatus?: (targetPath: string) => Promise<CcConnectPathStatus>
  platform?: string
  version?: string
}

type CcConnectPathStatus = "available" | "missing" | "blocked"

const SECRET_KEY_PATTERN = /(?:api[_-]?key|token|secret|password)/i
const LANGUAGE_OPTIONS = new Set(["en", "zh", "zh-TW", "ja", "es"])
const ATTACHMENT_OPTIONS = new Set(["", "on", "off"])
const LOG_LEVEL_OPTIONS = new Set(["debug", "info", "warn", "error"])
const BRIDGE_DEFAULT_PORT = 9810
const BRIDGE_DEFAULT_PATH = "/bridge/ws"
const WEBHOOK_DEFAULT_PORT = 9111
const WEBHOOK_DEFAULT_PATH = "/hook"
const MANAGEMENT_DEFAULT_PORT = 9820
const LOCAL_API_SOCKET = "run/api.sock"
const DAEMON_LOG_MAX_SIZE_MB = 10
const BRIDGE_CAPABILITIES = [
  "text",
  "card",
  "buttons",
  "typing",
  "update_message",
  "preview",
  "reconstruct_reply",
]
const WEBHOOK_FIELDS = [
  "event",
  "project",
  "session_key",
  "prompt",
  "exec",
  "work_dir",
  "silent",
  "payload",
]
const GUARDED_DAEMON_ACTIONS = ["install", "uninstall", "start", "stop", "restart", "logs -f"]
const GUARDED_UPDATE_ACTIONS = ["check update", "self update", "install source switch"]

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  )
}

async function defaultPathStatus(targetPath: string): Promise<CcConnectPathStatus> {
  try {
    await access(targetPath, constants.F_OK)
    return "available"
  } catch (error) {
    return isMissingPathError(error) ? "missing" : "blocked"
  }
}

function countChecks(checks: SynapseCcConnectDiagnostics["doctor"]["checks"]) {
  return checks.reduce<SynapseCcConnectDiagnostics["doctor"]["summary"]>((summary, check) => {
    summary[check.status] += 1
    return summary
  }, { pass: 0, warn: 0, fail: 0 })
}

function quoteToml(value: string): string {
  return JSON.stringify(value)
}

function boolToml(value: boolean): string {
  return value ? "true" : "false"
}

function normalizeNumber(value: unknown, fallback: number, min: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min
    ? Math.floor(value)
    : fallback
}

export function normalizeCcConnectSettings(
  current: SynapseCcConnectSettings,
  update: SynapseCcConnectSettingsUpdate,
): SynapseCcConnectSettings {
  const language = update.language ?? current.language
  const attachmentSend = update.attachmentSend ?? current.attachmentSend
  const logLevel = update.logLevel ?? current.logLevel

  return {
    language: LANGUAGE_OPTIONS.has(language) ? language : current.language,
    attachmentSend: ATTACHMENT_OPTIONS.has(attachmentSend) ? attachmentSend : current.attachmentSend,
    logLevel: LOG_LEVEL_OPTIONS.has(logLevel) ? logLevel : current.logLevel,
    idleTimeoutMins: normalizeNumber(update.idleTimeoutMins, current.idleTimeoutMins, 0),
    thinkingMessages: update.thinkingMessages ?? current.thinkingMessages,
    thinkingMaxLen: normalizeNumber(update.thinkingMaxLen, current.thinkingMaxLen, 0),
    toolMessages: update.toolMessages ?? current.toolMessages,
    toolMaxLen: normalizeNumber(update.toolMaxLen, current.toolMaxLen, 0),
    streamPreviewEnabled: update.streamPreviewEnabled ?? current.streamPreviewEnabled,
    streamPreviewIntervalMs: normalizeNumber(update.streamPreviewIntervalMs, current.streamPreviewIntervalMs, 100),
    rateLimitMaxMessages: normalizeNumber(update.rateLimitMaxMessages, current.rateLimitMaxMessages, 0),
    rateLimitWindowSecs: normalizeNumber(update.rateLimitWindowSecs, current.rateLimitWindowSecs, 1),
    lastReloadAt: current.lastReloadAt,
    lastRestartRequestedAt: current.lastRestartRequestedAt,
  }
}

export function redactTomlSecrets(toml: string): string {
  return toml
    .split("\n")
    .map((line) => {
      const match = line.match(/^(\s*([A-Za-z0-9_-]+)\s*=\s*)(".*"|'.*'|[^\s#]+)(.*)$/)
      if (!match || !SECRET_KEY_PATTERN.test(match[2] ?? "")) {
        return line
      }
      return `${match[1]}"***REDACTED***"${match[4] ?? ""}`
    })
    .join("\n")
}

export function ccConnectSettingsToToml(config: SynapseConfig): string {
  const settings = config.global.ccConnect ?? DEFAULT_CC_CONNECT_SETTINGS
  const lines = [
    `language = ${quoteToml(settings.language === "auto" ? "en" : settings.language)}`,
    `attachment_send = ${quoteToml(settings.attachmentSend)}`,
    `idle_timeout_mins = ${settings.idleTimeoutMins}`,
    "",
    "[log]",
    `level = ${quoteToml(settings.logLevel)}`,
    "",
    "[display]",
    `thinking_messages = ${boolToml(settings.thinkingMessages)}`,
    `thinking_max_len = ${settings.thinkingMaxLen}`,
    `tool_messages = ${boolToml(settings.toolMessages)}`,
    `tool_max_len = ${settings.toolMaxLen}`,
    "",
    "[stream_preview]",
    `enabled = ${boolToml(settings.streamPreviewEnabled)}`,
    `interval_ms = ${settings.streamPreviewIntervalMs}`,
    "",
    "[rate_limit]",
    `max_messages = ${settings.rateLimitMaxMessages}`,
    `window_secs = ${settings.rateLimitWindowSecs}`,
  ]

  for (const provider of config.global.providers) {
    lines.push(
      "",
      "[[providers]]",
      `name = ${quoteToml(provider.name)}`,
      `base_url = ${quoteToml(provider.baseUrl ?? "")}`,
      `model = ${quoteToml(provider.model ?? "")}`,
      `secret_ref = ${quoteToml(provider.secretRef ?? "")}`,
    )
  }

  for (const project of config.global.projects) {
    lines.push(
      "",
      "[[projects]]",
      `name = ${quoteToml(project.name || project.id)}`,
      "",
      "[projects.agent]",
      `type = ${quoteToml(project.agentType ?? "codex")}`,
      "",
      "[projects.agent.options]",
      `work_dir = ${quoteToml(project.workDirOverride || project.workDir || project.baseDir || project.path || "")}`,
      `mode = ${quoteToml(project.permissionMode ?? "default")}`,
    )
  }

  return redactTomlSecrets(`${lines.join("\n")}\n`)
}

export class CcConnectSettingsService {
  private readonly config: ConfigAccess | null
  private readonly homeDir: string
  private readonly now: () => Date
  private readonly pathStatus: (targetPath: string) => Promise<CcConnectPathStatus>
  private readonly platform: string
  private readonly version: string

  constructor(options: CcConnectSettingsServiceOptions = {}) {
    this.config = options.config ?? null
    this.homeDir = options.homeDir ?? homedir()
    this.now = options.now ?? (() => new Date())
    this.pathStatus = options.pathStatus ?? defaultPathStatus
    this.platform = options.platform ?? process.platform
    this.version = options.version ?? "3S"
  }

  private async configAccess(): Promise<ConfigAccess> {
    if (this.config) {
      return this.config
    }
    const { configStore } = await import("./config-store.js")
    return configStore
  }

  async getSettings(): Promise<SynapseCcConnectSettings> {
    const access = await this.configAccess()
    const config = await access.load()
    return config.global.ccConnect ?? DEFAULT_CC_CONNECT_SETTINGS
  }

  async updateSettings(update: SynapseCcConnectSettingsUpdate): Promise<SynapseCcConnectSettings> {
    const access = await this.configAccess()
    const currentConfig = await access.load()
    const current = currentConfig.global.ccConnect ?? DEFAULT_CC_CONNECT_SETTINGS
    const next = normalizeCcConnectSettings(current, update)
    const updatedConfig = await access.update({ global: { ccConnect: next } })
    return updatedConfig.global.ccConnect
  }

  async rawConfig(): Promise<SynapseCcConnectRawConfigResult> {
    const access = await this.configAccess()
    const config = await access.load()
    return {
      format: "toml",
      content: ccConnectSettingsToToml(config),
      redacted: true,
      source: "Synapse DataRepository",
    }
  }

  async diagnostics(): Promise<SynapseCcConnectDiagnostics> {
    const access = await this.configAccess()
    const config = await access.load()
    const dataDir = path.join(this.homeDir, ".cc-connect")
    const socketPath = path.join(dataDir, LOCAL_API_SOCKET)
    const logFile = path.join(dataDir, "logs", "cc-connect.log")
    const [dataDirStatus, socketStatus] = await Promise.all([
      this.pathStatus(dataDir),
      this.pathStatus(socketPath),
    ])
    const hasProjects = config.global.projects.length > 0
    const hasProviders = config.global.providers.length > 0
    const checks: SynapseCcConnectDiagnostics["doctor"]["checks"] = [
      {
        name: "Data directory",
        status: dataDirStatus === "available" ? "pass" : "warn",
        detail: dataDir,
      },
      {
        name: "Local API socket",
        status: socketStatus === "available" ? "pass" : "warn",
        detail: socketPath,
      },
      {
        name: "Projects",
        status: hasProjects ? "pass" : "warn",
        detail: hasProjects ? `${config.global.projects.length} configured` : "no project configured",
      },
      {
        name: "Providers",
        status: hasProviders ? "pass" : "warn",
        detail: hasProviders ? `${config.global.providers.length} configured` : "no provider configured",
      },
    ]

    return {
      bridge: {
        enabled: false,
        endpoint: `ws://127.0.0.1:${BRIDGE_DEFAULT_PORT}${BRIDGE_DEFAULT_PATH}`,
        tokenSet: false,
        capabilities: BRIDGE_CAPABILITIES,
        adapters: [],
      },
      webhook: {
        enabled: false,
        endpoint: `http://127.0.0.1:${WEBHOOK_DEFAULT_PORT}${WEBHOOK_DEFAULT_PATH}`,
        tokenSet: false,
        authMethods: ["Bearer", "X-Webhook-Token", "query token"],
        requestFields: WEBHOOK_FIELDS,
        validation: ["POST only", "session_key required", "prompt xor exec", "project required when ambiguous"],
      },
      localApi: {
        socketPath,
        status: socketStatus,
        permission: "0600",
        endpoints: [
          { label: "Send", value: "/send" },
          { label: "Sessions", value: "/sessions" },
          { label: "Cron", value: "/cron/*" },
          { label: "Relay", value: "/relay/*" },
        ],
      },
      managementApi: {
        enabled: false,
        endpoint: `http://127.0.0.1:${MANAGEMENT_DEFAULT_PORT}/api/v1`,
        tokenSet: false,
        endpoints: [
          { label: "Status", value: "/status" },
          { label: "Reload", value: "/reload" },
          { label: "Restart", value: "/restart" },
          { label: "Bridge adapters", value: "/bridge/adapters" },
        ],
      },
      daemon: {
        platform: this.platform,
        installed: dataDirStatus === "available",
        status: dataDirStatus === "available" ? "unknown" : "stopped",
        pid: null,
        workDir: dataDir,
        logFile,
        logMaxSizeMb: DAEMON_LOG_MAX_SIZE_MB,
        guardedActions: GUARDED_DAEMON_ACTIONS,
      },
      doctor: {
        checks,
        summary: countChecks(checks),
      },
      update: {
        currentVersion: this.version,
        installSource: "npm release asset",
        sources: ["GitHub", "Gitee"],
        guardedActions: GUARDED_UPDATE_ACTIONS,
      },
    }
  }

  async reload(): Promise<SynapseCcConnectReloadResult> {
    const access = await this.configAccess()
    const currentConfig = await access.load()
    const reloadedAt = this.now().toISOString()
    const next = {
      ...(currentConfig.global.ccConnect ?? DEFAULT_CC_CONNECT_SETTINGS),
      lastReloadAt: reloadedAt,
    }
    const updatedConfig = await access.update({ global: { ccConnect: next } })

    return {
      message: "config reloaded",
      projectsUpdated: updatedConfig.global.projects.map((project) => project.name || project.id),
      reloadedAt,
    }
  }

  async restart(input: SynapseCcConnectRestartPayload = {}): Promise<SynapseCcConnectRestartResult> {
    if (!input.confirmed) {
      return {
        status: "confirmation_required",
        message: "restart requires confirmation",
      }
    }

    const access = await this.configAccess()
    const currentConfig = await access.load()
    const requestedAt = this.now().toISOString()
    const next = {
      ...(currentConfig.global.ccConnect ?? DEFAULT_CC_CONNECT_SETTINGS),
      lastRestartRequestedAt: requestedAt,
    }
    await access.update({ global: { ccConnect: next } })

    return {
      status: "recorded",
      message: "restart requested",
      requestedAt,
      sessionKey: input.sessionKey?.trim() ?? "",
      platform: input.platform?.trim() ?? "",
    }
  }
}

export const ccConnectSettingsService = new CcConnectSettingsService()
