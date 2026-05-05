import os from "node:os"
import path from "node:path"
import type { ClientDef, PathRoot } from "./parsers/types"

export const CLIENT_DEFS: ClientDef[] = [
  { id: "opencode", name: "OpenCode", root: "xdgData", relativePath: "opencode/storage/message", filePattern: "*.json", parseLocal: true },
  { id: "claude", name: "Claude Code", root: "home", relativePath: ".claude/projects", filePattern: "*.jsonl", parseLocal: true },
  { id: "codex", name: "Codex", root: "envVar", envVar: "CODEX_HOME", fallbackRelative: ".codex", relativePath: "sessions", filePattern: "*.jsonl", parseLocal: true },
  { id: "cursor", name: "Cursor", root: "home", relativePath: ".config/tokscale/cursor-cache", filePattern: "usage*.csv", parseLocal: false },
  { id: "gemini", name: "Gemini", root: "home", relativePath: ".gemini/tmp", filePattern: "*.json|*.jsonl", parseLocal: true },
  { id: "amp", name: "Amp", root: "xdgData", relativePath: "amp/threads", filePattern: "T-*.json", parseLocal: true },
  { id: "droid", name: "Droid", root: "home", relativePath: ".factory/sessions", filePattern: "*.settings.json", parseLocal: true },
  { id: "openclaw", name: "OpenClaw", root: "home", relativePath: ".openclaw/agents", filePattern: "*.jsonl*", parseLocal: true },
  { id: "pi", name: "Pi", root: "home", relativePath: ".pi/agent/sessions", filePattern: "*.jsonl", parseLocal: true },
  { id: "kimi", name: "Kimi", root: "home", relativePath: ".kimi/sessions", filePattern: "wire.jsonl", parseLocal: true },
  { id: "qwen", name: "Qwen", root: "home", relativePath: ".qwen/projects", filePattern: "*.jsonl", parseLocal: true },
  { id: "roocode", name: "Roo Code", root: "home", relativePath: ".config/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks", filePattern: "ui_messages.json", parseLocal: true },
  { id: "kilocode", name: "Kilo Code", root: "home", relativePath: ".config/Code/User/globalStorage/kilocode.kilo-code/tasks", filePattern: "ui_messages.json", parseLocal: true },
  { id: "mux", name: "Mux", root: "home", relativePath: ".mux/sessions", filePattern: "session-usage.json", parseLocal: true },
  { id: "kilo", name: "Kilo", root: "xdgData", relativePath: "kilo/kilo.db", filePattern: "kilo.db", parseLocal: true },
  { id: "crush", name: "Crush", root: "xdgData", relativePath: "crush/projects.json", filePattern: "projects.json", parseLocal: true },
  { id: "hermes", name: "Hermes", root: "envVar", envVar: "HERMES_HOME", fallbackRelative: ".hermes", relativePath: "state.db", filePattern: "state.db", parseLocal: true },
  { id: "copilot", name: "Copilot", root: "home", relativePath: ".copilot/otel", filePattern: "*.jsonl", parseLocal: true },
  { id: "goose", name: "Goose", root: "xdgData", relativePath: "goose/sessions/sessions.db", filePattern: "sessions.db", parseLocal: true },
  { id: "codebuff", name: "Codebuff", root: "envVar", envVar: "CODEBUFF_DATA_DIR", fallbackRelative: ".config/manicode", relativePath: "projects", filePattern: "chat-messages.json", parseLocal: true },
  { id: "antigravity", name: "Antigravity", root: "config", relativePath: "antigravity-cache/sessions", filePattern: "*.jsonl", parseLocal: true },
  { id: "synthetic", name: "Synthetic", root: "xdgData", relativePath: "octofriend/sqlite.db", filePattern: "sqlite.db", parseLocal: true },
]

export function resolvePathRoot(root: PathRoot, def: ClientDef): string {
  const home = os.homedir()
  switch (root) {
    case "home":
      return home
    case "xdgData":
      return process.env.XDG_DATA_HOME || path.join(home, ".local", "share")
    case "config":
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "tokscale")
    case "envVar": {
      if (def.envVar && process.env[def.envVar]) return process.env[def.envVar]!
      return path.join(home, def.fallbackRelative || "")
    }
  }
}

export function resolveClientBasePath(def: ClientDef): string {
  return path.join(resolvePathRoot(def.root, def), def.relativePath)
}

export function getExtraScanPaths(def: ClientDef): string[] {
  const home = os.homedir()
  const extras: string[] = []
  switch (def.id) {
    case "codex": {
      const codexHome = process.env.CODEX_HOME || path.join(home, ".codex")
      extras.push(path.join(codexHome, "archived_sessions"))
      // Headless capture paths
      const configRoot = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
      extras.push(path.join(configRoot, "tokscale", "headless", "codex"))
      if (process.platform === "darwin") {
        extras.push(path.join(home, "Library", "Application Support", "tokscale", "headless", "codex"))
      }
      break
    }
    case "openclaw":
      extras.push(
        path.join(home, ".clawdbot", "agents"),
        path.join(home, ".moltbot", "agents"),
        path.join(home, ".moldbot", "agents"),
      )
      break
    case "pi":
      extras.push(path.join(home, ".omp", "agent", "sessions"))
      break
    case "roocode":
      extras.push(path.join(home, ".vscode-server", "data", "User", "globalStorage", "rooveterinaryinc.roo-cline", "tasks"))
      break
    case "kilocode":
      extras.push(path.join(home, ".vscode-server", "data", "User", "globalStorage", "kilocode.kilo-code", "tasks"))
      break
    case "copilot": {
      const otelPath = process.env.COPILOT_OTEL_FILE_EXPORTER_PATH
      if (otelPath) extras.push(path.dirname(otelPath))
      break
    }
    case "codebuff": {
      const base = process.env.CODEBUFF_DATA_DIR || path.join(home, ".config", "manicode")
      extras.push(
        path.join(path.dirname(base), "manicode-dev", "projects"),
        path.join(path.dirname(base), "manicode-staging", "projects"),
      )
      break
    }
    case "goose": {
      const gooseRoot = process.env.GOOSE_PATH_ROOT
      if (gooseRoot) {
        extras.push(path.join(gooseRoot.trim(), "data", "sessions"))
      }
      if (process.platform === "darwin") {
        extras.push(path.join(home, "Library", "Application Support", "goose", "sessions"))
        extras.push(path.join(home, "Library", "Application Support", "Block", "goose", "sessions"))
      }
      extras.push(path.join(home, ".local", "share", "Block", "goose", "sessions"))
      break
    }
  }
  return extras
}
