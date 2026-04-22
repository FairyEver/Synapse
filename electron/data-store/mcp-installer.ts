import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { homedir } from "node:os"
import { getMcpScriptPath } from "./cli-installer"
import { createMainLogger } from "../services/log-store"

const logger = createMainLogger("data-store.mcp-installer")

type McpTarget = "claude" | "codex"

function getSettingsPath(target: McpTarget): string {
  const home = homedir()
  if (target === "claude") {
    return path.join(home, ".claude", "settings.json")
  }
  return path.join(home, ".codex", "settings.json")
}

function registerMcp(target: McpTarget): { success: boolean; error?: string } {
  const settingsPath = getSettingsPath(target)
  const mcpScriptPath = getMcpScriptPath()

  try {
    let settings: Record<string, unknown> = {}

    if (existsSync(settingsPath)) {
      const raw = readFileSync(settingsPath, "utf-8")
      settings = JSON.parse(raw)
    } else {
      const dir = path.dirname(settingsPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }

    if (!settings.mcpServers || typeof settings.mcpServers !== "object") {
      settings.mcpServers = {}
    }

    const servers = settings.mcpServers as Record<string, unknown>
    servers["synapse-data"] = {
      command: "node",
      args: [mcpScriptPath],
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8")
    logger.info("MCP server registered.", { target, settingsPath })
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error("MCP registration failed.", { target, error: message })
    return { success: false, error: message }
  }
}

function getMcpStatus(): { claude: boolean; codex: boolean } {
  const result = { claude: false, codex: false }

  for (const target of ["claude", "codex"] as McpTarget[]) {
    const settingsPath = getSettingsPath(target)
    try {
      if (!existsSync(settingsPath)) continue
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"))
      const servers = settings?.mcpServers
      if (servers && typeof servers === "object" && "synapse-data" in servers) {
        result[target] = true
      }
    } catch { /* ignore */ }
  }

  return result
}

export { registerMcp, getMcpStatus }
