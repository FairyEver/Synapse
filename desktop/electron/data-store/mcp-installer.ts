import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs"
import path from "node:path"
import { homedir } from "node:os"
import { app, shell } from "electron"
import { getMcpScriptPath } from "./cli-installer"
import { createMainLogger } from "../services/log-store"

const logger = createMainLogger("data-store.mcp-installer")

type McpTarget = "claude" | "codex"
type McpStatus = Record<McpTarget, boolean>
type McpServerInfo = {
  target: McpTarget
  settingsPath: string
  settingsFileExists: boolean
  registered: boolean
}

const MCP_TARGETS: McpTarget[] = ["claude", "codex"]
const SYNAPSE_DATA_SERVER_NAME = "synapse-data"

function getStableMcpScriptPath(): string {
  return path.join(app.getPath("userData"), "mcp", "index.js")
}

function deployMcpScript(): void {
  const source = getMcpScriptPath()
  const target = getStableMcpScriptPath()
  mkdirSync(path.dirname(target), { recursive: true })
  copyFileSync(source, target)
}

function getSettingsPath(target: McpTarget): string {
  const home = homedir()
  if (target === "claude") {
    return path.join(home, ".claude.json")
  }
  return path.join(home, ".codex", "config.toml")
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

function hasClaudeSynapseDataServer(settings: Record<string, unknown>, mcpScriptPath: string): boolean {
  const servers = settings.mcpServers
  if (!isRecord(servers)) {
    return false
  }

  const server = servers[SYNAPSE_DATA_SERVER_NAME]
  if (!isRecord(server)) {
    return false
  }

  return server.command === "node"
    && isStringArray(server.args)
    && server.args.length === 1
    && server.args[0] === mcpScriptPath
    && (server.type == null || server.type === "stdio")
}

function registerClaudeMcp(settingsPath: string, mcpScriptPath: string): void {
  const settings = readJsonSettings(settingsPath)
  const servers = isRecord(settings.mcpServers) ? settings.mcpServers : {}

  servers[SYNAPSE_DATA_SERVER_NAME] = {
    type: "stdio",
    command: "node",
    args: [mcpScriptPath],
    env: {},
  }

  settings.mcpServers = servers
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8")
}

function escapeTomlString(value: string): string {
  return JSON.stringify(value)
}

function getLineEnding(raw: string): string {
  return raw.includes("\r\n") ? "\r\n" : "\n"
}

function getCodexServerTableName(): string {
  return `[mcp_servers.${SYNAPSE_DATA_SERVER_NAME}]`
}

function getCodexServerSubtablePrefix(): string {
  return `[mcp_servers.${SYNAPSE_DATA_SERVER_NAME}.`
}

function isTomlTableHeader(line: string): boolean {
  return /^\[[^\]]+\]\s*$/.test(line.trim())
}

function findCodexServerSectionRange(lines: string[]): { start: number; end: number } | null {
  const tableName = getCodexServerTableName()
  const subtablePrefix = getCodexServerSubtablePrefix()
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

function buildCodexServerBlock(mcpScriptPath: string, lineEnding: string): string {
  return [
    getCodexServerTableName(),
    `command = ${escapeTomlString("node")}`,
    `args = [${escapeTomlString(mcpScriptPath)}]`,
  ].join(lineEnding)
}

function upsertCodexServerConfig(raw: string, mcpScriptPath: string): string {
  const lineEnding = getLineEnding(raw)
  const block = buildCodexServerBlock(mcpScriptPath, lineEnding)
  const lines = raw.length > 0 ? raw.split(/\r?\n/) : []
  const existingRange = findCodexServerSectionRange(lines)

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
  const range = findCodexServerSectionRange(lines)

  if (!range) {
    return null
  }

  return lines.slice(range.start, range.end).join("\n")
}

function parseTomlStringArray(value: string): string[] | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return null
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function hasCodexSynapseDataServer(raw: string, mcpScriptPath: string): boolean {
  const section = extractCodexServerSection(raw)
  if (!section) {
    return false
  }

  const commandMatch = section.match(/^\s*command\s*=\s*("(?:\\.|[^"])*")\s*$/m)
  const argsMatch = section.match(/^\s*args\s*=\s*(\[[^\n]*\])\s*$/m)

  if (!commandMatch || !argsMatch) {
    return false
  }

  try {
    const command = JSON.parse(commandMatch[1])
    const args = parseTomlStringArray(argsMatch[1])

    return command === "node"
      && args != null
      && args.length === 1
      && args[0] === mcpScriptPath
  } catch {
    return false
  }
}

function registerCodexMcp(settingsPath: string, mcpScriptPath: string): void {
  const raw = existsSync(settingsPath) ? readFileSync(settingsPath, "utf-8") : ""
  const nextConfig = upsertCodexServerConfig(raw, mcpScriptPath)
  writeFileSync(settingsPath, nextConfig, "utf-8")
}

function registerMcp(target: McpTarget): { success: boolean; error?: string } {
  const settingsPath = getSettingsPath(target)
  const mcpScriptPath = getStableMcpScriptPath()

  try {
    deployMcpScript()
    ensureParentDirectory(settingsPath)

    if (target === "claude") {
      registerClaudeMcp(settingsPath, mcpScriptPath)
    } else {
      registerCodexMcp(settingsPath, mcpScriptPath)
    }

    logger.info("MCP server registered.", { target, settingsPath })
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error("MCP registration failed.", { target, error: message })
    return { success: false, error: message }
  }
}

function getMcpServers(): McpServerInfo[] {
  const mcpScriptPath = getStableMcpScriptPath()

  return MCP_TARGETS.map((target) => {
    const settingsPath = getSettingsPath(target)
    const settingsFileExists = existsSync(settingsPath)
    let registered = false

    try {
      if (!settingsFileExists) {
        return {
          target,
          settingsPath,
          settingsFileExists,
          registered,
        }
      }

      if (target === "claude") {
        const settings = readJsonSettings(settingsPath)
        registered = hasClaudeSynapseDataServer(settings, mcpScriptPath)
      } else {
        const raw = readFileSync(settingsPath, "utf-8")
        registered = hasCodexSynapseDataServer(raw, mcpScriptPath)
      }
    } catch {
      registered = false
    }

    return {
      target,
      settingsPath,
      settingsFileExists,
      registered,
    }
  })
}

function getMcpStatus(): McpStatus {
  return getMcpServers().reduce<McpStatus>(
    (result, server) => {
      result[server.target] = server.registered
      return result
    },
    { claude: false, codex: false },
  )
}

async function openMcpSettings(target: McpTarget): Promise<{ success: boolean; error?: string }> {
  const settingsPath = getSettingsPath(target)

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

export { registerMcp, getMcpServers, getMcpStatus, openMcpSettings }
