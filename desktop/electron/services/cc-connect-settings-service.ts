import { DEFAULT_CC_CONNECT_SETTINGS } from "../../src/constants/defaults"
import type {
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
  now?: () => Date
}

const SECRET_KEY_PATTERN = /(?:api[_-]?key|token|secret|password)/i
const LANGUAGE_OPTIONS = new Set(["en", "zh", "zh-TW", "ja", "es"])
const ATTACHMENT_OPTIONS = new Set(["", "on", "off"])
const LOG_LEVEL_OPTIONS = new Set(["debug", "info", "warn", "error"])

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
  private readonly now: () => Date

  constructor(options: CcConnectSettingsServiceOptions = {}) {
    this.config = options.config ?? null
    this.now = options.now ?? (() => new Date())
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
