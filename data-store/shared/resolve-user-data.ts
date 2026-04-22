import { homedir } from "node:os"
import { readFileSync } from "node:fs"
import path from "node:path"

type ServerInfo = {
  port: number
  token: string
  pid: number
  startedAt: string
}

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

function isAppRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function apiCall(info: ServerInfo, action: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const url = `http://127.0.0.1:${info.port}/api`
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${info.token}`,
    },
    body: JSON.stringify({ action, ...params }),
  })

  const data = await response.json() as { ok: boolean; data?: unknown; error?: string; total?: number; affected?: number }
  if (!data.ok) {
    throw new Error(data.error ?? "Unknown error")
  }
  return data
}

export { apiCall, getUserDataPath, isAppRunning, readServerInfo }
export type { ServerInfo }
