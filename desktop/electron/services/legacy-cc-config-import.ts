import path from "node:path"
import type {
  SynapseLegacyCcConfigImportPreview,
  SynapseLegacyCcProjectPreview,
  SynapseLegacyCcProviderPreview,
} from "../../src/types/config"

type LegacyImportOptions = {
  homeDir: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

type TomlRecord = Record<string, unknown>

const KNOWN_TOP_LEVEL_KEYS = new Set([
  "aliases",
  "attachment_send",
  "banned_words",
  "bridge",
  "commands",
  "cron",
  "data_dir",
  "display",
  "hooks",
  "idle_timeout_mins",
  "language",
  "log",
  "management",
  "outgoing_rate_limit",
  "provider_presets_url",
  "providers",
  "projects",
  "quiet",
  "rate_limit",
  "relay",
  "speech",
  "stream_preview",
  "tts",
  "webhook",
])

const DANGEROUS_RUN_AS_ENV = new Set([
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "SUDO_USER",
  "SUDO_COMMAND",
])

const RUN_AS_USER_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/

function isRecord(value: unknown): value is TomlRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function asRecords(value: unknown): TomlRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function getRecord(parent: TomlRecord, key: string): TomlRecord {
  const value = parent[key]
  return isRecord(value) ? value : {}
}

function getString(parent: TomlRecord, key: string): string | null {
  const value = parent[key]
  return typeof value === "string" ? value : null
}

function resolveEnv(value: unknown, env: NodeJS.ProcessEnv, warnings: string[]): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
      if (Object.prototype.hasOwnProperty.call(env, name)) {
        return env[name] ?? ""
      }
      warnings.push(`环境变量 ${name} 未设置，已按空字符串处理。`)
      return ""
    })
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveEnv(item, env, warnings))
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveEnv(item, env, warnings)]),
    )
  }

  return value
}

function getDefaultDataDir(homeDir: string): string {
  return homeDir ? path.join(homeDir, ".cc-connect") : ".cc-connect"
}

function normalizeAttachmentSend(value: unknown, errors: string[]): "on" | "off" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""

  if (normalized === "" || normalized === "on") {
    return "on"
  }

  if (normalized === "off") {
    return "off"
  }

  errors.push('config: attachment_send must be "on" or "off"')
  return "on"
}

function validateRunAsUser(
  prefix: string,
  name: string | null,
  platform: NodeJS.Platform,
): string | null {
  if (!name) {
    return null
  }

  if (platform === "win32") {
    return `config: ${prefix}.run_as_user is only supported on Linux/macOS`
  }

  if (name === "root" || name === "0") {
    return `config: ${prefix}.run_as_user must not be root`
  }

  if (!RUN_AS_USER_PATTERN.test(name)) {
    return `config: ${prefix}.run_as_user ${JSON.stringify(name)} contains invalid characters`
  }

  return null
}

function validateRunAsEnv(prefix: string, envNames: string[]): string[] {
  return envNames
    .filter((name) => DANGEROUS_RUN_AS_ENV.has(name.trim().toUpperCase()))
    .map((name) => `config: ${prefix}.run_as_env must not include dangerous variable ${JSON.stringify(name)}`)
}

function createProviderPreview(
  provider: TomlRecord,
  source: "global" | "project",
  projectName: string | null,
): SynapseLegacyCcProviderPreview {
  return {
    name: getString(provider, "name") ?? "",
    source,
    projectName,
    baseUrl: getString(provider, "base_url"),
    model: getString(provider, "model"),
    agentTypes: asStrings(provider.agent_types),
    hasApiKey: typeof provider.api_key === "string" && provider.api_key.length > 0,
  }
}

function createProjectPreview(
  project: TomlRecord,
  index: number,
  errors: string[],
  platform: NodeJS.Platform,
): SynapseLegacyCcProjectPreview {
  const prefix = `projects[${index}]`
  const name = getString(project, "name") ?? ""
  const agent = getRecord(project, "agent")
  const agentOptions = getRecord(agent, "options")
  const platforms = asRecords(project.platforms)
  const mode = getString(project, "mode")
  const baseDir = getString(project, "base_dir")
  const workDir = getString(agentOptions, "work_dir") ?? getString(project, "work_dir")
  const runAsUser = getString(project, "run_as_user")
  const runAsEnv = asStrings(project.run_as_env)
  const issues: string[] = []

  if (!name) {
    errors.push(`config: ${prefix}.name is required`)
  }

  if (!getString(agent, "type")) {
    errors.push(`config: ${prefix}.agent.type is required`)
  }

  if (platforms.length === 0) {
    errors.push(`config: ${prefix} needs at least one [[projects.platforms]]`)
  }

  platforms.forEach((platformConfig, platformIndex) => {
    if (!getString(platformConfig, "type")) {
      errors.push(`config: ${prefix}.platforms[${platformIndex}].type is required`)
    }
  })

  if (mode === "multi-workspace") {
    if (!baseDir) {
      errors.push(`project ${JSON.stringify(name)}: multi-workspace mode requires base_dir`)
    }
    if (workDir) {
      errors.push(`project ${JSON.stringify(name)}: multi-workspace mode conflicts with agent work_dir`)
    }
  }

  const runAsUserIssue = validateRunAsUser(prefix, runAsUser, platform)
  if (runAsUserIssue) {
    issues.push(runAsUserIssue)
    errors.push(runAsUserIssue)
  }

  for (const issue of validateRunAsEnv(prefix, runAsEnv)) {
    issues.push(issue)
    errors.push(issue)
  }

  return {
    name,
    mode,
    workDir,
    baseDir,
    agentType: getString(agent, "type"),
    providerRefs: asStrings(agent.provider_refs),
    activeProvider: getString(agentOptions, "provider"),
    platformTypes: platforms.map((platformConfig) => getString(platformConfig, "type") ?? ""),
    runAsUser,
    runAsEnv,
    issues,
  }
}

export async function previewLegacyCcConfigImport(
  toml: string,
  options: LegacyImportOptions,
): Promise<SynapseLegacyCcConfigImportPreview> {
  const warnings: string[] = []
  const errors: string[] = []
  let parsed: TomlRecord

  try {
    const { parse } = await import("smol-toml")
    const raw = parse(toml)
    parsed = isRecord(raw)
      ? resolveEnv(raw, options.env ?? process.env, warnings) as TomlRecord
      : {}
  } catch (error) {
    const message = error instanceof Error ? error.message : "TOML 解析失败。"
    errors.push(`parse config: ${message}`)
    parsed = {}
  }

  const log = getRecord(parsed, "log")
  const projects = asRecords(parsed.projects)
  const platform = options.platform ?? process.platform
  const projectPreviews = projects.map((project, index) =>
    createProjectPreview(project, index, errors, platform)
  )
  const projectProviders = projects.flatMap((project, index) => {
    const projectName = projectPreviews[index]?.name || null
    const agent = getRecord(project, "agent")
    return asRecords(agent.providers).map((provider) =>
      createProviderPreview(provider, "project", projectName)
    )
  })
  const globalProviders = asRecords(parsed.providers).map((provider) =>
    createProviderPreview(provider, "global", null)
  )

  if (projects.length === 0 && errors.length === 0) {
    errors.push("config: at least one [[projects]] entry is required")
  }

  const dataDir = getString(parsed, "data_dir") ?? getDefaultDataDir(options.homeDir)
  const language = getString(parsed, "language")
  const attachmentSend = normalizeAttachmentSend(parsed.attachment_send, errors)
  const logLevel = getString(log, "level") ?? "info"
  const ignoredTopLevelKeys = Object.keys(parsed)
    .filter((key) => !KNOWN_TOP_LEVEL_KEYS.has(key))
    .sort()

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    ignoredTopLevelKeys,
    global: {
      dataDir,
      language,
      attachmentSend,
      logLevel,
    },
    projects: projectPreviews,
    providers: [...globalProviders, ...projectProviders],
  }
}
