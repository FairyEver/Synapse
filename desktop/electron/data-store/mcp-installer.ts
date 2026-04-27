import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { homedir } from "node:os"
import { shell } from "electron"
import { createMainLogger } from "../services/log-store"
import { mcpDefinitions } from "../services/definitions/generated/main-registry"
import type { SynapseMcpDefinition } from "../../src/definitions/types"
import { SYNAPSE_DATA_SERVER_NAME, SYNAPSE_DATA_LEGACY_SERVER_NAMES } from "../../data-store/shared/server-identity"

const logger = createMainLogger("data-store.mcp-installer")

type McpTarget = string
type McpRegistrationMode = "http" | "stdio" | null
type McpStatus = Record<McpTarget, boolean>
type McpServerInfo = {
  target: McpTarget
  settingsPath: string
  settingsFileExists: boolean
  registered: boolean
  mode: McpRegistrationMode
  url: string | null
}

const MCP_DEFINITIONS = mcpDefinitions
const MCP_TARGETS: McpTarget[] = MCP_DEFINITIONS.map((definition) => definition.target)

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

function getTargetSettingsPath(target: McpTarget): string {
  return getSettingsPath(requireMcpDefinition(target))
}

function assertSupportedSettingsFormat(definition: SynapseMcpDefinition): void {
  if (!usesJsonSettings(definition) && !usesCodexTomlSettings(definition)) {
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

function detectJsonRegistration(settings: Record<string, unknown>): { registered: boolean; mode: McpRegistrationMode; url: string | null } {
  const servers = settings.mcpServers
  if (!isRecord(servers)) return { registered: false, mode: null, url: null }

  const server = servers[SYNAPSE_DATA_SERVER_NAME]
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

  servers[SYNAPSE_DATA_SERVER_NAME] = { url: mcpUrl }
  settings.mcpServers = servers
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8")
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
  return [
    getCodexServerTableName(SYNAPSE_DATA_SERVER_NAME),
    `url = ${escapeTomlString(mcpUrl)}`,
  ].join(lineEnding)
}

function upsertCodexServerConfig(raw: string, mcpUrl: string): string {
  const lineEnding = getLineEnding(raw)
  const block = buildCodexServerBlock(mcpUrl, lineEnding)
  const lines = raw.length > 0 ? raw.split(/\r?\n/) : []
  const existingRange = findCodexServerSectionRange(lines, SYNAPSE_DATA_SERVER_NAME)

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
  const range = findCodexServerSectionRange(lines, SYNAPSE_DATA_SERVER_NAME)

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
    } catch { /* ignore */ }
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
  writeFileSync(settingsPath, nextConfig, "utf-8")
}

function registerMcp(target: McpTarget, mcpPort: number): { success: boolean; error?: string } {
  try {
    const definition = requireMcpDefinition(target)
    assertSupportedSettingsFormat(definition)
    const settingsPath = getSettingsPath(definition)
    const mcpUrl = getMcpUrl(mcpPort)

    ensureParentDirectory(settingsPath)

    if (usesJsonSettings(definition)) {
      registerJsonMcp(settingsPath, mcpUrl)
    } else {
      registerCodexMcp(settingsPath, mcpUrl)
    }

    logger.info("MCP server registered.", { target, settingsPath, mode: "http" })
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error("MCP registration failed.", { target, error: message })
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
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8")
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
  writeFileSync(settingsPath, next, "utf-8")
  return true
}

function unregisterMcp(target: McpTarget, serverName: string): { success: boolean; modified: boolean; error?: string } {
  try {
    const definition = requireMcpDefinition(target)
    assertSupportedSettingsFormat(definition)
    const settingsPath = getSettingsPath(definition)
    const modified = usesCodexTomlSettings(definition)
      ? removeCodexMcp(settingsPath, serverName)
      : removeJsonMcp(settingsPath, serverName)
    return { success: true, modified }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn("MCP unregister failed.", { target, name: serverName, error: message })
    return { success: false, modified: false, error: message }
  }
}

function cleanupLegacyMcpNames(): void {
  if (SYNAPSE_DATA_LEGACY_SERVER_NAMES.length === 0) return
  for (const legacy of SYNAPSE_DATA_LEGACY_SERVER_NAMES) {
    if (legacy === SYNAPSE_DATA_SERVER_NAME) continue
    for (const target of MCP_TARGETS) {
      const { success, modified } = unregisterMcp(target, legacy)
      if (success && modified) {
        logger.info("Legacy MCP entry removed.", { target, name: legacy })
      }
    }
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
      } else {
        const raw = readFileSync(settingsPath, "utf-8")
        detection = detectCodexRegistration(raw)
      }

      return { ...base, ...detection }
    } catch {
      return base
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

function autoRegisterMcp(mcpPort: number): void {
  cleanupLegacyMcpNames()
  const mcpUrl = getMcpUrl(mcpPort)

  for (const definition of MCP_DEFINITIONS) {
    const target = definition.target
    try {
      assertSupportedSettingsFormat(definition)
      const settingsPath = getSettingsPath(definition)
      const settingsDir = path.dirname(settingsPath)
      if (!existsSync(settingsDir)) continue

      const settingsFileExists = existsSync(settingsPath)
      let detection: { registered: boolean; mode: McpRegistrationMode; url: string | null } = { registered: false, mode: null, url: null }

      if (settingsFileExists) {
        if (usesJsonSettings(definition)) {
          detection = detectJsonRegistration(readJsonSettings(settingsPath))
        } else {
          detection = detectCodexRegistration(readFileSync(settingsPath, "utf-8"))
        }
      }

      if (detection.registered && detection.mode === "http" && detection.url === mcpUrl) continue

      registerMcp(target, mcpPort)
      logger.info("MCP auto-registered.", { target, previousMode: detection.mode })
    } catch (error) {
      logger.warn("MCP auto-registration failed (non-fatal).", { target, error: error instanceof Error ? error.message : String(error) })
    }
  }
}

export { autoRegisterMcp, registerMcp, getMcpServers, getMcpStatus, openMcpSettings }
