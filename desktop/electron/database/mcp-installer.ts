import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { homedir } from "node:os"
import { randomUUID } from "node:crypto"
import { shell } from "electron"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { createMainLogger } from "../services/log-store"
import { errorLogMeta } from "../services/error-sanitize"
import { mcpDefinitions } from "../services/definitions/generated/main-registry"
import type { SynapseMcpDefinition } from "../../src/definitions/types"
import { SYNAPSE_MCP_LEGACY_SERVER_NAMES, SYNAPSE_MCP_SERVER_NAME } from "../../database/shared/server-identity"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import { sanitizeDatabaseLogPath } from "./logging"

const logger = createMainLogger("database.mcp-installer")

type McpTarget = string
type McpRegistrationMode = "http" | "stdio" | null
type McpStatus = Record<McpTarget, boolean>
type McpRegistrationSecurity = {
  actor: ActorIdentity
  source: string
  permissionGuard?: PermissionGuard
  auditSink?: AuditSink
}
type McpWriteAudit = {
  action: "fs.write"
  actor: ActorIdentity
  resource: string
  metadata: Record<string, unknown>
}
type McpServerInfo = {
  target: McpTarget
  settingsPath: string
  settingsFileExists: boolean
  registered: boolean
  mode: McpRegistrationMode
  url: string | null
  readError?: string
}

const MCP_DEFINITIONS = mcpDefinitions
const MCP_TARGETS: McpTarget[] = MCP_DEFINITIONS.map((definition) => definition.target)
const CLAUDE_TARGET = "claude"
const CLAUDE_SETTINGS_PERMISSION_FILES = [
  [".claude", "settings.json"],
  [".claude", "settings.local.json"],
] as const

function getMcpDefinition(target: McpTarget): SynapseMcpDefinition | null {
  return MCP_DEFINITIONS.find((definition) => definition.target === target) ?? null
}

function requireMcpDefinition(target: McpTarget): SynapseMcpDefinition {
  const definition = getMcpDefinition(target)

  if (!definition) {
    throw new Error(`未知 MCP 目标：${target}`)
  }

  return definition
}

function getSettingsPath(definition: SynapseMcpDefinition): string {
  return path.join(homedir(), ...definition.settingsPathSegments)
}

function usesJsonSettings(definition: SynapseMcpDefinition): boolean {
  return definition.settingsFormat === "json-mcp-servers"
}

function usesCodexTomlSettings(definition: SynapseMcpDefinition): boolean {
  return definition.settingsFormat === "codex-toml"
}

function usesHermesYamlSettings(definition: SynapseMcpDefinition): boolean {
  return definition.settingsFormat === "hermes-yaml"
}

function getTargetSettingsPath(target: McpTarget): string {
  return getSettingsPath(requireMcpDefinition(target))
}

function assertSupportedSettingsFormat(definition: SynapseMcpDefinition): void {
  if (!usesJsonSettings(definition) && !usesCodexTomlSettings(definition) && !usesHermesYamlSettings(definition)) {
    throw new Error(`不支持的 MCP 设置格式：${definition.settingsFormat}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function ensureParentDirectory(settingsPath: string): void {
  const dir = path.dirname(settingsPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function writeSettingsFileSafely(settingsPath: string, content: string): void {
  ensureParentDirectory(settingsPath)
  const backupPath = backupExistingSettingsFile(settingsPath)
  const temporaryPath = path.join(
    path.dirname(settingsPath),
    `.${path.basename(settingsPath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    writeFileSync(temporaryPath, content, "utf-8")
    renameSync(temporaryPath, settingsPath)
    if (backupPath) {
      logger.info("MCP settings backup created before write.", {
        settingsPath: sanitizeDatabaseLogPath(settingsPath),
        backupPath: sanitizeDatabaseLogPath(backupPath),
      })
    }
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

function backupExistingSettingsFile(settingsPath: string): string | null {
  if (!existsSync(settingsPath)) return null
  const parsed = path.parse(settingsPath)
  const backupPath = path.join(
    parsed.dir,
    `${parsed.name}.synapse-backup-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}${parsed.ext}`,
  )
  copyFileSync(settingsPath, backupPath)
  return backupPath
}

function buildMcpWriteAudit(
  target: McpTarget,
  settingsPath: string,
  security: McpRegistrationSecurity | undefined,
  operation: "register" | "unregister",
): McpWriteAudit {
  return {
    action: "fs.write",
    actor: security?.actor ?? { kind: "system", id: "database-mcp" },
    resource: settingsPath,
    metadata: {
      source: security?.source ?? "database.mcp.register",
      operation,
      target,
      settingsPath,
      writesSecret: false,
    },
  }
}

async function authorizeMcpWrite(
  security: McpRegistrationSecurity | undefined,
  audit: McpWriteAudit,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const permission = await security?.permissionGuard?.check({
    action: audit.action,
    actor: audit.actor,
    resource: audit.resource,
    context: audit.metadata,
  })

  if (permission && !permission.allowed) {
    security?.auditSink?.record({
      action: audit.action,
      actor: audit.actor,
      resource: audit.resource,
      outcome: "denied",
      metadata: {
        ...audit.metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    return { allowed: false, reason: permission.reason }
  }

  return { allowed: true }
}

function recordMcpWriteAudit(
  security: McpRegistrationSecurity | undefined,
  audit: McpWriteAudit | null,
  outcome: "allowed" | "failed",
  error?: string,
): void {
  if (!audit || !security?.auditSink) return
  security.auditSink.record({
    action: audit.action,
    actor: audit.actor,
    resource: audit.resource,
    outcome,
    metadata: {
      ...audit.metadata,
      ...(error ? { error } : {}),
    },
  })
}

function readJsonSettings(settingsPath: string): Record<string, unknown> {
  if (!existsSync(settingsPath)) {
    return {}
  }

  let raw: string
  try {
    raw = readFileSync(settingsPath, "utf-8")
  } catch {
    return {}
  }

  if (!raw.trim()) {
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`配置文件 JSON 格式损坏：${settingsPath}`)
  }

  if (!isRecord(parsed)) {
    throw new Error("配置文件格式无效。")
  }

  return parsed
}

function getMcpUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`
}

function isValidMcpPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535
}

function detectJsonRegistration(settings: Record<string, unknown>): { registered: boolean; mode: McpRegistrationMode; url: string | null } {
  const servers = settings.mcpServers
  if (!isRecord(servers)) return { registered: false, mode: null, url: null }

  const server = servers[SYNAPSE_MCP_SERVER_NAME]
  if (!isRecord(server)) return { registered: false, mode: null, url: null }

  if (typeof server.url === "string" && server.url.startsWith("http://127.0.0.1:")) {
    return { registered: true, mode: "http", url: server.url }
  }

  if (server.command === "node" && isStringArray(server.args) && server.args.length === 1) {
    return { registered: true, mode: "stdio", url: null }
  }

  return { registered: false, mode: null, url: null }
}

function registerJsonMcp(settingsPath: string, mcpUrl: string): void {
  const settings = readJsonSettings(settingsPath)
  const servers = isRecord(settings.mcpServers) ? settings.mcpServers : {}

  servers[SYNAPSE_MCP_SERVER_NAME] = { type: "http", url: mcpUrl }
  settings.mcpServers = servers
  writeSettingsFileSafely(settingsPath, JSON.stringify(settings, null, 2))
}

function escapeTomlString(value: string): string {
  return JSON.stringify(value)
}

function getLineEnding(raw: string): string {
  return raw.includes("\r\n") ? "\r\n" : "\n"
}

function getCodexServerTableName(serverName: string): string {
  return `[mcp_servers.${serverName}]`
}

function getCodexServerSubtablePrefix(serverName: string): string {
  return `[mcp_servers.${serverName}.`
}

function isTomlTableHeader(line: string): boolean {
  return /^\[[^\]]+\]\s*$/.test(line.trim())
}

function findCodexServerSectionRange(lines: string[], serverName: string): { start: number; end: number } | null {
  const tableName = getCodexServerTableName(serverName)
  const subtablePrefix = getCodexServerSubtablePrefix(serverName)
  const start = lines.findIndex((line) => line.trim() === tableName)

  if (start < 0) {
    return null
  }

  let end = lines.length

  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    if (!isTomlTableHeader(trimmed)) {
      continue
    }

    if (trimmed === tableName || trimmed.startsWith(subtablePrefix)) {
      continue
    }

    end = index
    break
  }

  return { start, end }
}

function buildCodexServerBlock(mcpUrl: string, lineEnding: string): string {
  const lines = [
    getCodexServerTableName(SYNAPSE_MCP_SERVER_NAME),
    `url = ${escapeTomlString(mcpUrl)}`,
  ]
  return lines.join(lineEnding)
}

function upsertCodexServerConfig(raw: string, mcpUrl: string): string {
  const lineEnding = getLineEnding(raw)
  const block = buildCodexServerBlock(mcpUrl, lineEnding)
  const lines = raw.length > 0 ? raw.split(/\r?\n/) : []
  const existingRange = findCodexServerSectionRange(lines, SYNAPSE_MCP_SERVER_NAME)

  if (existingRange) {
    const nextLines = [
      ...lines.slice(0, existingRange.start),
      ...block.split(lineEnding),
      ...lines.slice(existingRange.end),
    ]
    return `${nextLines.join(lineEnding).replace(/[ \t]+$/gm, "").trimEnd()}${lineEnding}`
  }

  const trimmedRaw = raw.trimEnd()
  if (trimmedRaw.length === 0) {
    return `${block}${lineEnding}`
  }

  return `${trimmedRaw}${lineEnding}${lineEnding}${block}${lineEnding}`
}

function extractCodexServerSection(raw: string): string | null {
  const lines = raw.split(/\r?\n/)
  const range = findCodexServerSectionRange(lines, SYNAPSE_MCP_SERVER_NAME)

  if (!range) {
    return null
  }

  return lines.slice(range.start, range.end).join("\n")
}

function detectCodexRegistration(raw: string): { registered: boolean; mode: McpRegistrationMode; url: string | null } {
  const section = extractCodexServerSection(raw)
  if (!section) return { registered: false, mode: null, url: null }

  const urlMatch = section.match(/^\s*url\s*=\s*("(?:\\.|[^"])*")\s*$/m)
  if (urlMatch) {
    try {
      const url = JSON.parse(urlMatch[1]) as string
      if (url.startsWith("http://127.0.0.1:")) {
        return { registered: true, mode: "http", url }
      }
    } catch { /* URL parsing is best-effort */ }
  }

  const commandMatch = section.match(/^\s*command\s*=\s*("(?:\\.|[^"])*")\s*$/m)
  if (commandMatch) {
    return { registered: true, mode: "stdio", url: null }
  }

  return { registered: false, mode: null, url: null }
}

function registerCodexMcp(settingsPath: string, mcpUrl: string): void {
  const raw = existsSync(settingsPath) ? readFileSync(settingsPath, "utf-8") : ""
  const nextConfig = upsertCodexServerConfig(raw, mcpUrl)
  writeSettingsFileSafely(settingsPath, nextConfig)
}

function readHermesYamlSettings(settingsPath: string): Record<string, unknown> {
  if (!existsSync(settingsPath)) {
    return {}
  }

  let raw: string
  try {
    raw = readFileSync(settingsPath, "utf-8")
  } catch {
    return {}
  }

  if (!raw.trim()) {
    return {}
  }

  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch {
    throw new Error(`配置文件 YAML 格式损坏：${settingsPath}`)
  }

  if (!isRecord(parsed)) {
    throw new Error("配置文件格式无效。")
  }

  return parsed
}

function detectHermesYamlRegistration(raw: string): { registered: boolean; mode: McpRegistrationMode; url: string | null } {
  if (!raw.trim()) return { registered: false, mode: null, url: null }

  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch {
    return { registered: false, mode: null, url: null }
  }

  if (!isRecord(parsed)) return { registered: false, mode: null, url: null }

  const servers = parsed.mcp_servers
  if (!isRecord(servers)) return { registered: false, mode: null, url: null }

  const server = servers[SYNAPSE_MCP_SERVER_NAME]
  if (!isRecord(server)) return { registered: false, mode: null, url: null }

  if (typeof server.url === "string" && server.url.startsWith("http://127.0.0.1:")) {
    return { registered: true, mode: "http", url: server.url }
  }

  if (typeof server.command === "string") {
    return { registered: true, mode: "stdio", url: null }
  }

  return { registered: false, mode: null, url: null }
}

function registerHermesYamlMcp(settingsPath: string, mcpUrl: string): void {
  const settings = readHermesYamlSettings(settingsPath)
  const servers = isRecord(settings.mcp_servers) ? settings.mcp_servers : {}

  servers[SYNAPSE_MCP_SERVER_NAME] = { url: mcpUrl }
  settings.mcp_servers = servers

  writeSettingsFileSafely(settingsPath, stringifyYaml(settings, { lineWidth: 0 }))
}

function removeAuthorizationKeys(headers: Record<string, unknown>): boolean {
  let modified = false
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "authorization") {
      delete headers[key]
      modified = true
    }
  }
  return modified
}

function cleanupJsonStaticAuthorization(settingsPath: string): boolean {
  const settings = readJsonSettings(settingsPath)
  const servers = settings.mcpServers
  if (!isRecord(servers)) return false
  const server = servers[SYNAPSE_MCP_SERVER_NAME]
  if (!isRecord(server) || !isRecord(server.headers)) return false

  const modified = removeAuthorizationKeys(server.headers)
  if (!modified) return false
  if (Object.keys(server.headers).length === 0) {
    delete server.headers
  }
  writeSettingsFileSafely(settingsPath, JSON.stringify(settings, null, 2))
  return true
}

function cleanupCodexStaticAuthorization(settingsPath: string, mcpUrl: string): boolean {
  if (!existsSync(settingsPath)) return false
  const raw = readFileSync(settingsPath, "utf-8")
  const section = extractCodexServerSection(raw)
  if (!section || !/^\s*Authorization\s*=/im.test(section)) return false

  const nextConfig = upsertCodexServerConfig(raw, mcpUrl)
  if (nextConfig === raw) return false
  writeSettingsFileSafely(settingsPath, nextConfig)
  return true
}

function cleanupHermesStaticAuthorization(settingsPath: string): boolean {
  const settings = readHermesYamlSettings(settingsPath)
  const servers = settings.mcp_servers
  if (!isRecord(servers)) return false
  const server = servers[SYNAPSE_MCP_SERVER_NAME]
  if (!isRecord(server) || !isRecord(server.headers)) return false

  const modified = removeAuthorizationKeys(server.headers)
  if (!modified) return false
  if (Object.keys(server.headers).length === 0) {
    delete server.headers
  }
  writeSettingsFileSafely(settingsPath, stringifyYaml(settings, { lineWidth: 0 }))
  return true
}

async function cleanupStaticAuthorizationForTarget(
  definition: SynapseMcpDefinition,
  settingsPath: string,
  mcpUrl: string,
  security?: McpRegistrationSecurity,
): Promise<void> {
  const audit = buildMcpWriteAudit(definition.target, settingsPath, security, "register")
  const permission = await authorizeMcpWrite(security, audit)
  if (!permission.allowed) {
    logger.warn("MCP static Authorization cleanup denied.", { target: definition.target, reason: permission.reason })
    return
  }

  const modified = usesJsonSettings(definition)
    ? cleanupJsonStaticAuthorization(settingsPath)
    : usesHermesYamlSettings(definition)
      ? cleanupHermesStaticAuthorization(settingsPath)
      : cleanupCodexStaticAuthorization(settingsPath, mcpUrl)

  if (modified) {
    recordMcpWriteAudit(security, audit, "allowed")
    logger.info("MCP static Authorization header removed.", {
      target: definition.target,
      settingsPath: sanitizeDatabaseLogPath(settingsPath),
    })
  }
}

function removeHermesYamlMcp(settingsPath: string, serverName: string): boolean {
  if (!existsSync(settingsPath)) return false
  const settings = readHermesYamlSettings(settingsPath)
  const servers = settings.mcp_servers
  if (!isRecord(servers) || !(serverName in servers)) return false
  delete servers[serverName]
  settings.mcp_servers = servers
  writeSettingsFileSafely(settingsPath, stringifyYaml(settings, { lineWidth: 0 }))
  return true
}

async function registerMcp(
  target: McpTarget,
  mcpPort: number,
  security?: McpRegistrationSecurity,
): Promise<{ success: boolean; error?: string }> {
  let audit: McpWriteAudit | null = null
  try {
    const definition = requireMcpDefinition(target)
    assertSupportedSettingsFormat(definition)
    const settingsPath = getSettingsPath(definition)
    audit = buildMcpWriteAudit(target, settingsPath, security, "register")
    if (!isValidMcpPort(mcpPort)) {
      throw new Error("MCP HTTP 未运行")
    }
    const mcpUrl = getMcpUrl(mcpPort)
    const permission = await authorizeMcpWrite(security, audit)
    if (!permission.allowed) {
      return { success: false, error: permission.reason }
    }

    ensureParentDirectory(settingsPath)

    if (usesJsonSettings(definition)) {
      registerJsonMcp(settingsPath, mcpUrl)
    } else if (usesHermesYamlSettings(definition)) {
      registerHermesYamlMcp(settingsPath, mcpUrl)
    } else {
      registerCodexMcp(settingsPath, mcpUrl)
    }

    logger.info("MCP server registered.", {
      target,
      settingsPath: sanitizeDatabaseLogPath(settingsPath),
      mode: "http",
    })
    recordMcpWriteAudit(security, audit, "allowed")
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    recordMcpWriteAudit(security, audit, "failed", message)
    logger.error("MCP registration failed.", { target, ...errorLogMeta(error) })
    return { success: false, error: message }
  }
}

function removeJsonMcp(settingsPath: string, serverName: string): boolean {
  if (!existsSync(settingsPath)) return false
  const settings = readJsonSettings(settingsPath)
  const servers = settings.mcpServers
  if (!isRecord(servers) || !(serverName in servers)) return false
  delete servers[serverName]
  settings.mcpServers = servers
  writeSettingsFileSafely(settingsPath, JSON.stringify(settings, null, 2))
  return true
}

function isLegacyMcpPermission(value: string): boolean {
  return SYNAPSE_MCP_LEGACY_SERVER_NAMES.some((legacy) => value.startsWith(`mcp__${legacy}__`))
}

function removeLegacyClaudePermissionAllowlistEntries(settingsPath: string): boolean {
  if (!existsSync(settingsPath)) return false
  const settings = readJsonSettings(settingsPath)
  const permissions = settings.permissions
  if (!isRecord(permissions) || !Array.isArray(permissions.allow)) return false

  const nextAllow = permissions.allow.filter((item) =>
    typeof item !== "string" || !isLegacyMcpPermission(item)
  )
  if (nextAllow.length === permissions.allow.length) return false

  permissions.allow = nextAllow
  settings.permissions = permissions
  writeSettingsFileSafely(settingsPath, JSON.stringify(settings, null, 2))
  return true
}

function removeCodexMcp(settingsPath: string, serverName: string): boolean {
  if (!existsSync(settingsPath)) return false
  const raw = readFileSync(settingsPath, "utf-8")
  const lines = raw.length > 0 ? raw.split(/\r?\n/) : []
  const range = findCodexServerSectionRange(lines, serverName)
  if (!range) return false
  const lineEnding = getLineEnding(raw)
  const nextLines = [...lines.slice(0, range.start), ...lines.slice(range.end)]
  const next = `${nextLines.join(lineEnding).replace(/[ \t]+$/gm, "").trimEnd()}${lineEnding}`
  writeSettingsFileSafely(settingsPath, next)
  return true
}

async function unregisterMcp(
  target: McpTarget,
  serverName: string,
  security?: McpRegistrationSecurity,
): Promise<{ success: boolean; modified: boolean; error?: string }> {
  let audit: McpWriteAudit | null = null
  try {
    const definition = requireMcpDefinition(target)
    assertSupportedSettingsFormat(definition)
    const settingsPath = getSettingsPath(definition)
    audit = buildMcpWriteAudit(target, settingsPath, security, "unregister")
    const permission = await authorizeMcpWrite(security, audit)
    if (!permission.allowed) {
      return { success: false, modified: false, error: permission.reason }
    }
    const modified = usesCodexTomlSettings(definition)
      ? removeCodexMcp(settingsPath, serverName)
      : usesHermesYamlSettings(definition)
        ? removeHermesYamlMcp(settingsPath, serverName)
        : removeJsonMcp(settingsPath, serverName)
    if (modified) {
      recordMcpWriteAudit(security, audit, "allowed")
    }
    return { success: true, modified }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    recordMcpWriteAudit(security, audit, "failed", message)
    logger.warn("MCP unregister failed.", { target, name: serverName, ...errorLogMeta(error) })
    return { success: false, modified: false, error: message }
  }
}

function getMcpServers(): McpServerInfo[] {
  return MCP_DEFINITIONS.map((definition) => {
    const target = definition.target
    const settingsPath = getSettingsPath(definition)
    const settingsFileExists = existsSync(settingsPath)
    const base = { target, settingsPath, settingsFileExists, registered: false, mode: null as McpRegistrationMode, url: null as string | null }

    try {
      if (!settingsFileExists) return base

      let detection: { registered: boolean; mode: McpRegistrationMode; url: string | null }

      if (usesJsonSettings(definition)) {
        const settings = readJsonSettings(settingsPath)
        detection = detectJsonRegistration(settings)
      } else if (usesHermesYamlSettings(definition)) {
        const raw = readFileSync(settingsPath, "utf-8")
        detection = detectHermesYamlRegistration(raw)
      } else {
        const raw = readFileSync(settingsPath, "utf-8")
        detection = detectCodexRegistration(raw)
      }

      return { ...base, ...detection }
    } catch (error) {
      logger.warn("MCP settings read failed.", {
        target,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      })
      return { ...base, readError: "配置读取失败" }
    }
  })
}

function getMcpStatus(): McpStatus {
  return getMcpServers().reduce<McpStatus>(
    (result, server) => {
      result[server.target] = server.registered
      return result
    },
    {},
  )
}

async function openMcpSettings(target: McpTarget): Promise<{ success: boolean; error?: string }> {
  const settingsPath = getTargetSettingsPath(target)

  if (!existsSync(settingsPath)) {
    return { success: false, error: "配置文件不存在。" }
  }

  try {
    const error = await shell.openPath(settingsPath)
    if (error) {
      logger.error("MCP settings open failed.", { target, error, settingsPath })
      return { success: false, error }
    }

    logger.info("MCP settings opened.", { target, settingsPath })
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error("MCP settings open failed.", { target, error: message, settingsPath })
    return { success: false, error: message }
  }
}

async function cleanupLegacyMcpNamesForTarget(
  target: McpTarget,
  security?: McpRegistrationSecurity,
): Promise<void> {
  for (const legacy of SYNAPSE_MCP_LEGACY_SERVER_NAMES) {
    if (legacy === SYNAPSE_MCP_SERVER_NAME) continue
    const { success, modified } = await unregisterMcp(target, legacy, security)
    if (success && modified) {
      logger.info("Legacy MCP entry removed.", { target, name: legacy })
    }
  }
}

async function cleanupLegacyClaudePermissions(security?: McpRegistrationSecurity): Promise<void> {
  for (const segments of CLAUDE_SETTINGS_PERMISSION_FILES) {
    const settingsPath = path.join(homedir(), ...segments)
    if (!existsSync(settingsPath)) continue
    const audit = buildMcpWriteAudit(CLAUDE_TARGET, settingsPath, security, "unregister")
    const permission = await authorizeMcpWrite(security, audit)
    if (!permission.allowed) {
      logger.warn("Legacy Claude MCP permission cleanup denied.", {
        settingsPath: sanitizeDatabaseLogPath(settingsPath),
        reason: permission.reason,
      })
      continue
    }
    try {
      if (removeLegacyClaudePermissionAllowlistEntries(settingsPath)) {
        recordMcpWriteAudit(security, audit, "allowed")
        logger.info("Legacy Claude MCP permission allowlist entries removed.", {
          settingsPath: sanitizeDatabaseLogPath(settingsPath),
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      recordMcpWriteAudit(security, audit, "failed", message)
      logger.warn("Legacy Claude MCP permission cleanup failed.", {
        settingsPath: sanitizeDatabaseLogPath(settingsPath),
        ...errorLogMeta(error),
      })
    }
  }
}

async function autoRegisterMcp(mcpPort: number, security?: McpRegistrationSecurity): Promise<void> {
  logger.info("MCP auto-registration started.", { port: mcpPort, targets: MCP_TARGETS.map((d) => d) })
  const mcpUrl = getMcpUrl(mcpPort)

  for (const definition of MCP_DEFINITIONS) {
    const target = definition.target
    try {
      assertSupportedSettingsFormat(definition)
      const settingsPath = getSettingsPath(definition)
      const settingsDir = path.dirname(settingsPath)
      if (!existsSync(settingsDir)) {
        logger.info("MCP target skipped: settings directory not found.", {
          target,
          settingsDir: sanitizeDatabaseLogPath(settingsDir),
        })
        continue
      }

      const settingsFileExists = existsSync(settingsPath)
      let detection: { registered: boolean; mode: McpRegistrationMode; url: string | null } = { registered: false, mode: null, url: null }

      if (settingsFileExists) {
        if (usesJsonSettings(definition)) {
          detection = detectJsonRegistration(readJsonSettings(settingsPath))
        } else if (usesHermesYamlSettings(definition)) {
          detection = detectHermesYamlRegistration(readFileSync(settingsPath, "utf-8"))
        } else {
          detection = detectCodexRegistration(readFileSync(settingsPath, "utf-8"))
        }
      }

      if (detection.registered && detection.mode === "http" && detection.url === mcpUrl) {
        logger.info("MCP target already registered with correct URL.", {
          target,
          settingsPath: sanitizeDatabaseLogPath(settingsPath),
        })
        await cleanupStaticAuthorizationForTarget(definition, settingsPath, mcpUrl, security)
        await cleanupLegacyMcpNamesForTarget(target, security)
        if (target === CLAUDE_TARGET) await cleanupLegacyClaudePermissions(security)
        continue
      }

      const result = await registerMcp(target, mcpPort, security)
      if (result.success) {
        logger.info("MCP auto-registered.", {
          target,
          settingsPath: sanitizeDatabaseLogPath(settingsPath),
          previousMode: detection.mode,
          previousUrl: detection.url,
        })
        await cleanupLegacyMcpNamesForTarget(target, security)
        if (target === CLAUDE_TARGET) await cleanupLegacyClaudePermissions(security)
      } else {
        logger.warn("MCP auto-registration failed, preserving legacy entries.", {
          target,
          ...errorLogMeta(result.error),
        })
      }
    } catch (error) {
      logger.warn("MCP auto-registration failed (non-fatal).", { target, ...errorLogMeta(error) })
    }
  }
  logger.info("MCP auto-registration completed.")
}

export { autoRegisterMcp, registerMcp, getMcpServers, getMcpStatus, openMcpSettings }
