import { homedir } from "node:os"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  MCP_API_DEFAULT_TIMEOUT_MS,
  MCP_API_TEXT_EXTRACTION_TIMEOUT_MS,
} from "../../config"
import { isProcessAlive } from "./process-liveness"

type ServerInfo = {
  port: number
  token: string
  pid: number
  startedAt: string
}

type DatabaseApiClientSource = "mcp-stdio"

function getUserDataPath(): string {
  switch (process.platform) {
    case "darwin":
      return path.join(homedir(), "Library", "Application Support", "Synapse")
    case "win32":
      return path.join(process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "Synapse")
    default:
      return path.join(homedir(), ".config", "Synapse")
  }
}

function readServerInfo(): ServerInfo {
  const infoPath = path.join(getUserDataPath(), "data-server.json")
  try {
    const raw = readFileSync(infoPath, "utf-8")
    return JSON.parse(raw) as ServerInfo
  } catch {
    throw new Error("Synapse is not running or data-server.json not found.\nMake sure Synapse app is open.")
  }
}

const isAppRunning = isProcessAlive

async function apiCall(
  info: ServerInfo,
  action: string,
  params: Record<string, unknown> = {},
  source: DatabaseApiClientSource = "mcp-stdio",
): Promise<unknown> {
  const url = `http://127.0.0.1:${info.port}/api`
  const controller = new AbortController()
  const timeoutMs = action.startsWith("app.text_extractor.document.")
    ? MCP_API_TEXT_EXTRACTION_TIMEOUT_MS
    : MCP_API_DEFAULT_TIMEOUT_MS
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${info.token}`,
        "X-Synapse-Client": source,
      },
      body: JSON.stringify({ ...params, action }),
      signal: controller.signal,
    })
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`Request timed out (${timeoutMs / 1_000}s)`, { cause: error })
    }
    throw new Error(`Failed to connect to Synapse at 127.0.0.1:${info.port}: ${(error as Error).message}`, {
      cause: error,
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) {
    throw new Error(`Unexpected response type: ${contentType}`)
  }

  const data = await response.json() as { ok: boolean; data?: unknown; error?: string; total?: number; affected?: number }
  if (!data.ok) {
    throw new Error(data.error ?? "Unknown error")
  }
  return data
}

export { apiCall, getUserDataPath, isAppRunning, readServerInfo }
export type { DatabaseApiClientSource, ServerInfo }
