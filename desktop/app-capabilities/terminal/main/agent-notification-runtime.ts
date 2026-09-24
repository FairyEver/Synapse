/**
 * Claude Code 的 Hook 事件表。
 *
 * 有两个写入方，两边必须一模一样：用户手敲 `claude` 时 wrapper 把这段合并进用户自己的
 * `--settings`；Synapse 自己拉起 Claude Code 时（⌘-点击、新建对话、手机端）launcher 把同一份
 * 写进它自己生成的 settings。定义只留这一处，wrapper 的源码由它插值生成。
 */
export const CLAUDE_AGENT_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "Notification",
  "Stop",
  "SessionEnd",
  "SubagentStop",
] as const

/** 写在 settings 里的身份标记，用来认出哪一段 hooks 是 Synapse 写的。 */
export const CLAUDE_AGENT_MANAGED_MARKER = {
  managed: "terminal-agent-notifications",
  version: 1,
} as const

/**
 * 与 wrapper 里的 `quoteShell` 逐字对应。
 *
 * 两份实现是重复的（wrapper 是独立脚本，import 不进来），所以有一条测试直接把 wrapper 合并出来
 * 的 hooks 和这里构造的比对 —— 谁先漂移谁的用例就红。
 */
function quoteShellArgument(value: string): string {
  if (process.platform === "win32") return `"${value.replace(/"/g, '""')}"`
  return `'${value.replace(/'/g, "'\\''")}'`
}

/** wrapper 的 `hookCommand("claude", event)` 在 TS 侧的对应物。 */
export function claudeHookCommand(nodePath: string, hookPath: string, event: string): string {
  return [nodePath, hookPath, "claude", event].map((value) => quoteShellArgument(value)).join(" ")
}

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
    agentSessionId: typeof payload.session_id === "string" ? payload.session_id : undefined,
    transcriptPath: typeof payload.transcript_path === "string" ? payload.transcript_path : undefined,
    agentPid: Number.parseInt(process.env.SYNAPSE_TERMINAL_AGENT_AGENT_PID || "", 10) || undefined,
    backgroundTaskCount: Array.isArray(payload.background_tasks) ? payload.background_tasks.length : undefined,
    sessionCronCount: Array.isArray(payload.session_crons) ? payload.session_crons.length : undefined,
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

if (provider !== "claude" || disabled || !startsSession(originalArgs)) launch(real, originalArgs)
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

function startsSession(args) {
  return !args.some((arg) => ["--help", "-h", "--version", "-v"].includes(arg))
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

function launchClaude(realPath, args) {
  const events = ${JSON.stringify(CLAUDE_AGENT_HOOK_EVENTS)}
  const managed = { __synapse: ${JSON.stringify(CLAUDE_AGENT_MANAGED_MARKER)}, hooks: {} }
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

function reportAgentProcessStarted(pid) {
  const node = process.env.SYNAPSE_TERMINAL_AGENT_NODE
  const helper = process.env.SYNAPSE_TERMINAL_AGENT_HOOK
  if (!node || !helper) return
  try {
    const reporter = spawn(node, [helper, provider, "AgentProcessStart"], {
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
      env: { ...process.env, SYNAPSE_TERMINAL_AGENT_AGENT_PID: String(pid) },
    })
    reporter.on("error", () => {})
    reporter.unref()
  } catch {
    // 报不上就算了，只是少一条「这一任进程是谁」的线索；状态兜底另有进程存活探测。
  }
}

function launch(realPath, args, cleanup) {
  const child = spawn(realPath, args, {
    stdio: "inherit",
    env: { ...process.env, SYNAPSE_TERMINAL_AGENT_WRAPPER_ACTIVE: "1" },
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(realPath),
  })
  if (provider === "claude" && child.pid) reportAgentProcessStarted(child.pid)
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

export function createTerminalAgentUnixShim(): string {
  return `#!/bin/sh\nexec "$SYNAPSE_TERMINAL_AGENT_NODE" "$SYNAPSE_TERMINAL_AGENT_WRAPPER" claude "$@"\n`
}

export function createTerminalAgentWindowsShim(): string {
  return `@echo off\r\n"%SYNAPSE_TERMINAL_AGENT_NODE%" "%SYNAPSE_TERMINAL_AGENT_WRAPPER%" claude %*\r\n`
}
