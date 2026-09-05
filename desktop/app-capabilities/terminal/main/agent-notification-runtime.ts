export const TERMINAL_AGENT_HOOK_RUNTIME = String.raw`#!/usr/bin/env node
const http = require("node:http")

const [source, event] = process.argv.slice(2)
const url = process.env.SYNAPSE_TERMINAL_AGENT_EVENT_URL
const token = process.env.SYNAPSE_TERMINAL_AGENT_TOKEN
const sessionId = process.env.SYNAPSE_TERMINAL_SESSION_ID
let input = ""
let finished = false
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  if (input.length < 262144) input += chunk.slice(0, 262144 - input.length)
})
process.stdin.on("end", () => {
  let payload = {}
  try { payload = JSON.parse(input || "{}") } catch { payload = {} }
  const toolName = typeof payload.tool_name === "string"
    ? payload.tool_name
    : typeof payload.toolName === "string" ? payload.toolName : undefined
  const body = JSON.stringify({
    source,
    event,
    sessionId,
    toolName,
    notificationType: typeof payload.notification_type === "string" ? payload.notification_type : undefined,
    agentId: typeof payload.agent_id === "string" ? payload.agent_id : undefined,
    parentSessionId: typeof payload.parent_session_id === "string" ? payload.parent_session_id : undefined,
  })
  if (!url || !token || !sessionId) return finish()
  try {
    const target = new URL(url)
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 1500,
    }, (response) => {
      response.resume()
      response.on("end", finish)
    })
    request.on("timeout", () => request.destroy())
    request.on("error", finish)
    request.end(body)
  } catch { finish() }
})
process.stdin.resume()
function finish() {
  if (finished) return
  finished = true
  if (source === "codex") process.stdout.write("{}")
}
`

export const TERMINAL_AGENT_WRAPPER_RUNTIME = String.raw`#!/usr/bin/env node
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawn } = require("node:child_process")

const provider = process.argv[2]
const originalArgs = process.argv.slice(3)
const shimDir = process.env.SYNAPSE_TERMINAL_AGENT_SHIM_DIR || ""
const disabled = process.env.SYNAPSE_AGENT_NOTIFICATIONS_DISABLED === "1"
  || process.env.SYNAPSE_TERMINAL_AGENT_WRAPPER_ACTIVE === "1"
const real = resolveExecutable(provider)
if (!real) {
  process.stderr.write("Synapse: " + provider + " was not found outside the notification shim.\n")
  process.exit(127)
}

if (disabled || !startsSession(provider, originalArgs)) launch(real, originalArgs)
else if (provider === "codex") launch(real, codexArgs(originalArgs))
else launchClaude(real, originalArgs)

function resolveExecutable(command) {
  const delimiter = process.platform === "win32" ? ";" : ":"
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";")
    : [""]
  const sources = [process.env.SYNAPSE_TERMINAL_AGENT_ORIGINAL_PATH || "", process.env.PATH || ""]
  const seen = new Set()
  for (const source of sources) for (const directory of source.split(delimiter)) {
    if (!directory || samePath(directory, shimDir) || seen.has(directory)) continue
    seen.add(directory)
    for (const extension of extensions) {
      const candidate = path.join(directory, command + extension.toLowerCase())
      if (isFile(candidate)) return candidate
      const upperCandidate = path.join(directory, command + extension.toUpperCase())
      if (isFile(upperCandidate)) return upperCandidate
    }
  }
  return null
}

function isFile(candidate) {
  try { return fs.statSync(candidate).isFile() } catch { return false }
}

function samePath(left, right) {
  if (!left || !right) return false
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right
}

function startsSession(kind, args) {
  if (kind === "claude") {
    return !args.some((arg) => ["--help", "-h", "--version", "-v"].includes(arg))
  }
  if (args.length === 0) return true
  const nonSession = new Set(["review", "login", "logout", "mcp", "plugin", "mcp-server", "app-server", "completion", "update", "doctor", "sandbox", "debug", "apply", "archive", "delete", "unarchive", "cloud", "features", "help"])
  const consumes = new Set(["-c", "--config", "-m", "--model", "-p", "--profile", "-C", "--cd", "--remote", "-a", "--ask-for-approval", "-s", "--sandbox", "--output-last-message", "--enable", "--disable"])
  let skip = false
  for (const arg of args) {
    if (skip) { skip = false; continue }
    if (["--help", "-h", "--version", "-V"].includes(arg)) return false
    if (arg.startsWith("-")) { if (!arg.includes("=") && consumes.has(arg)) skip = true; continue }
    return !nonSession.has(arg)
  }
  return true
}

function hookCommand(kind, event) {
  const node = process.env.SYNAPSE_TERMINAL_AGENT_NODE
  const helper = process.env.SYNAPSE_TERMINAL_AGENT_HOOK
  return [node, helper, kind, event].map(quoteShell).join(" ")
}

function quoteShell(value) {
  if (process.platform === "win32") return '"' + String(value).replace(/"/g, '""') + '"'
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

function codexArgs(args) {
  const events = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "Stop", "Interrupt", "SessionEnd"]
  const injected = ["--enable", "hooks"]
  for (const event of events) {
    const command = JSON.stringify(hookCommand("codex", event))
    injected.push("-c", "hooks." + event + "=[{ hooks = [{ type = \"command\", command = " + command + ", timeout = 5, async = true }] }]")
  }
  return injected.concat(args)
}

function launchClaude(realPath, args) {
  const events = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "Notification", "Stop", "SessionEnd", "SubagentStop"]
  const managed = { __synapse: { managed: "terminal-agent-notifications", version: 1 }, hooks: {} }
  for (const event of events) managed.hooks[event] = [{ matcher: "", hooks: [{ type: "command", command: hookCommand("claude", event), timeout: 5, async: true }] }]
  const filtered = []
  const settings = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--settings" && index + 1 < args.length) settings.push(args[++index])
    else if (arg.startsWith("--settings=")) settings.push(arg.slice(11))
    else filtered.push(arg)
  }
  try {
    let merged = {}
    for (const value of settings) merged = deepMerge(merged, loadSettings(value))
    merged = deepMerge(merged, managed)
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-claude-hooks-"))
    const file = path.join(directory, "settings.json")
    fs.writeFileSync(file, JSON.stringify(merged), { mode: 0o600 })
    launch(realPath, ["--settings", file].concat(filtered), () => fs.rmSync(directory, { recursive: true, force: true }))
  } catch (error) {
    process.stderr.write("Synapse: Claude notification hooks were skipped because settings could not be merged.\n")
    launch(realPath, args)
  }
}

function loadSettings(value) {
  const trimmed = String(value).trim()
  if (trimmed.startsWith("{")) return JSON.parse(trimmed)
  const file = trimmed.startsWith("~/") ? path.join(os.homedir(), trimmed.slice(2)) : trimmed
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function deepMerge(base, overlay) {
  if (Array.isArray(base) && Array.isArray(overlay)) return base.concat(overlay)
  if (base && overlay && typeof base === "object" && typeof overlay === "object" && !Array.isArray(base) && !Array.isArray(overlay)) {
    const result = { ...base }
    for (const [key, value] of Object.entries(overlay)) result[key] = key in result ? deepMerge(result[key], value) : value
    return result
  }
  return overlay
}

function launch(realPath, args, cleanup) {
  const child = spawn(realPath, args, {
    stdio: "inherit",
    env: { ...process.env, SYNAPSE_TERMINAL_AGENT_WRAPPER_ACTIVE: "1" },
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(realPath),
  })
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => {
    try { child.kill(signal) } catch { return }
  })
  child.on("error", (error) => {
    cleanup?.()
    process.stderr.write("Synapse: unable to launch " + provider + ": " + error.message + "\n")
    process.exitCode = 126
  })
  child.on("exit", (code, signal) => {
    cleanup?.()
    if (signal) {
      try { process.kill(process.pid, signal) } catch { process.exit(1) }
    } else process.exit(code == null ? 1 : code)
  })
}
`

export function createTerminalAgentUnixShim(provider: "codex" | "claude"): string {
  return `#!/bin/sh\nexec "$SYNAPSE_TERMINAL_AGENT_NODE" "$SYNAPSE_TERMINAL_AGENT_WRAPPER" ${provider} "$@"\n`
}

export function createTerminalAgentWindowsShim(provider: "codex" | "claude"): string {
  return `@echo off\r\n"%SYNAPSE_TERMINAL_AGENT_NODE%" "%SYNAPSE_TERMINAL_AGENT_WRAPPER%" ${provider} %*\r\n`
}
