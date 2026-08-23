import { execFile } from "node:child_process"
import { readdir, readFile, readlink } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { clearDevProcessState, readDevProcessState, writeDevProcessState } from "./dev-state.mjs"

const execFileAsync = promisify(execFile)
const currentFilePath = fileURLToPath(import.meta.url)
const defaultWorkspaceRoot = path.resolve(path.dirname(currentFilePath), "../..")
const DEV_SCRIPT_NAMES = ["dev:document", "dev:desktop", "dev:server"]
const DEV_PORTS_BY_SCRIPT = {
  "dev:document": [19773],
  "dev:desktop": [19731],
  "dev:server": [],
}
const DEV_PORTS = Object.values(DEV_PORTS_BY_SCRIPT).flat()

const RELATIVE_DEV_COMMAND_MATCHERS = [
  /scripts[/\\]dev[/\\]dev\.mjs/u,
  /scripts[/\\]dev[/\\]run-server-with-env\.mjs.*run dev/u,
  /dev-renderer/u,
  /dev-electron-app/u,
  /tsc.*tsconfig\.electron\.json.*--watch/u,
  /vite\.js.*strictPort/u,
  /vitepress.*dev/u,
  /nest.*start.*--watch/u,
  /admin[/\\]vite\.config\.ts/u,
  /dashboard[/\\].*vite\.js.*--port 3000/u,
  /max.*dev.*--port 3000/u,
  /nodemon/u,
  /electron[/\\]cli\.js \./u,
  /\belectron \./u,
  /pnpm(?:\.cjs)?.*\bdev(?::(?:document|desktop|server|renderer|electron:build|electron:app|api|admin|dashboard))?\b/u,
]

const WORKSPACE_DEV_COMMAND_MATCHERS = [
  ...RELATIVE_DEV_COMMAND_MATCHERS,
  /server[/\\]dist[/\\]main(?:\s|$)/u,
  /electron[/\\]dist[/\\]Electron\.app.* \./u,
]

const DEV_COMMAND_MATCHERS_BY_SCRIPT = {
  "dev:document": [
    /vitepress.*dev/u,
    /pnpm(?:\.cjs)?.*@synapse[/\\]document.*\brun dev\b/u,
    /pnpm(?:\.cjs)?.*\bdev:document\b/u,
  ],
  "dev:desktop": [
    /scripts[/\\]dev[/\\]dev\.mjs/u,
    /dev-renderer/u,
    /dev-electron-app/u,
    /tsc.*tsconfig\.electron\.json.*--watch/u,
    /vite\.js.*strictPort/u,
    /electron[/\\]cli\.js \./u,
    /\belectron \./u,
    /electron[/\\]dist[/\\]Electron\.app.* \./u,
    /pnpm(?:\.cjs)?.*@synapse[/\\]desktop.*\brun dev\b/u,
    /pnpm(?:\.cjs)?.*\bdev:desktop\b/u,
    /pnpm(?:\.cjs)?.*\bdev:(?:renderer|electron:build|electron:app)\b/u,
  ],
  "dev:server": [
    /scripts[/\\]dev[/\\]run-server-with-env\.mjs.*run dev/u,
    /nest.*start.*--watch/u,
    /admin[/\\]vite\.config\.ts/u,
    /dashboard[/\\].*vite\.js.*--port 3000/u,
    /max.*dev.*--port 3000/u,
    /nodemon/u,
    /server[/\\]dist[/\\]main(?:\s|$)/u,
    /pnpm(?:\.cjs)?.*@synapse[/\\]server.*\brun dev\b/u,
    /pnpm(?:\.cjs)?.*@synapse[/\\]dashboard.*\brun dev\b/u,
    /pnpm(?:\.cjs)?.*\bdev:(?:server|api|admin|dashboard)\b/u,
  ],
}

function normalizePathForMatch(value) {
  return path.resolve(value).replaceAll("\\", "/")
}

function pathIsInside(childPath, parentPath) {
  if (typeof childPath !== "string" || childPath.length === 0) return false

  const child = normalizePathForMatch(childPath)
  const parent = normalizePathForMatch(parentPath)
  return child === parent || child.startsWith(`${parent}/`)
}

function commandContainsWorkspace(commandLine, workspaceRoot) {
  return commandLine.replaceAll("\\", "/").includes(normalizePathForMatch(workspaceRoot))
}

function commandLooksLikeDevProcess(commandLine) {
  return WORKSPACE_DEV_COMMAND_MATCHERS.some((pattern) => pattern.test(commandLine))
}

function commandMatchesDevScripts(commandLine, targetScripts) {
  if (!Array.isArray(targetScripts) || targetScripts.length === 0) {
    return commandLooksLikeDevProcess(commandLine)
  }

  return targetScripts.some((scriptName) =>
    DEV_COMMAND_MATCHERS_BY_SCRIPT[scriptName]?.some((pattern) => pattern.test(commandLine)),
  )
}

function parseTargetScripts(args) {
  const targetScripts = args.filter((value) => DEV_SCRIPT_NAMES.includes(value))

  if (targetScripts.length !== args.length) {
    const invalid = args.filter((value) => !DEV_SCRIPT_NAMES.includes(value)).join(", ")
    throw new Error(`Unknown dev script target: ${invalid}`)
  }

  return targetScripts
}

function filterRemainingDevProcessState(entries, targetScripts) {
  if (!Array.isArray(targetScripts) || targetScripts.length === 0) return []

  return entries.filter((entry) => !targetScripts.includes(entry.scriptName))
}

function matchesSynapseDevProcess(processInfo, options = {}) {
  const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot
  const targetScripts = options.targetScripts ?? []
  const commandLine = processInfo.commandLine ?? ""
  const cwd = processInfo.cwd

  if (!Number.isInteger(processInfo.pid) || processInfo.pid <= 0) return false
  if (processInfo.pid === process.pid) return false
  if (!commandLine || commandLine.includes("quit-processes.mjs")) return false
  if (commandContainsWorkspace(commandLine, workspaceRoot)) {
    return commandMatchesDevScripts(commandLine, targetScripts)
  }

  if (pathIsInside(cwd, workspaceRoot)) {
    return commandMatchesDevScripts(commandLine, targetScripts)
  }

  return false
}

function filterSynapseDevProcessRows(rows, options = {}) {
  const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot
  return rows.filter((row) => matchesSynapseDevProcess(row, {
    ...options,
    workspaceRoot,
  }))
}

async function findMatchingProcesses(options = {}) {
  const tracked = await findTrackedProcesses(options)
  const scanned = await findScannedProcesses(options)
  const portProcesses = await findPortProcesses(options)

  return { tracked, scanned, portProcesses }
}

async function findScannedProcesses(options = {}) {
  const platform = options.platform ?? process.platform

  if (platform === "win32") {
    return findWindowsProcesses(options)
  }

  if (platform === "linux") {
    return findLinuxProcesses(options)
  }

  if (platform === "darwin") {
    return findMacProcesses(options)
  }

  return []
}

async function findTrackedProcesses(options = {}) {
  const entries = await readDevProcessState(options.statePath)
  const targetScripts = options.targetScripts ?? []

  if (targetScripts.length === 0) return entries

  return entries.filter((entry) => targetScripts.includes(entry.scriptName))
}

async function findWindowsProcesses(options = {}) {
  const script = [
    "Get-CimInstance Win32_Process",
    "Select-Object ProcessId,CommandLine",
    "ConvertTo-Json -Compress",
  ].join(" | ")
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ])
  const parsed = stdout.trim() ? JSON.parse(stdout) : []
  const rows = Array.isArray(parsed) ? parsed : [parsed]

  return filterSynapseDevProcessRows(rows
    .map((row) => ({
      pid: Number(row.ProcessId),
      pgid: Number(row.ProcessId),
      commandLine: typeof row.CommandLine === "string" ? row.CommandLine : "",
    })), options)
}

async function findLinuxProcesses(options = {}) {
  const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot
  const entries = await readdir("/proc", { withFileTypes: true })
  const rows = []

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    const pid = Number(entry.name)
    if (pid === process.pid) continue

    try {
      const raw = await readFile(`/proc/${entry.name}/cmdline`, "utf8")
      const commandLine = raw.split("\0").filter(Boolean).join(" ")
      if (!commandLooksLikeDevProcess(commandLine)) continue

      let cwd
      try {
        cwd = await readlink(`/proc/${entry.name}/cwd`)
      } catch {
        cwd = undefined
      }

      const row = { pid, pgid: pid, commandLine, cwd }
      if (matchesSynapseDevProcess(row, { ...options, workspaceRoot })) {
        rows.push(row)
      }
    } catch {
      // Process may have exited while scanning.
    }
  }

  return rows
}

function parsePsRows(output) {
  return output
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u)
      if (!match) return null

      return {
        pid: Number.parseInt(match[1], 10),
        ppid: Number.parseInt(match[2], 10),
        pgid: Number.parseInt(match[3], 10),
        commandLine: match[4],
      }
    })
    .filter(Boolean)
}

async function readProcessCwd(pid) {
  try {
    const { stdout } = await execFileAsync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"])
    const cwdLine = stdout.split("\n").find((line) => line.startsWith("n"))
    return cwdLine?.slice(1)
  } catch {
    return undefined
  }
}

async function findMacProcesses(options = {}) {
  const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,pgid=,command="])
  const rows = parsePsRows(stdout)
  const matched = []

  for (const row of rows) {
    if (!commandLooksLikeDevProcess(row.commandLine)) continue

    const processInfo = commandContainsWorkspace(row.commandLine, workspaceRoot)
      ? row
      : { ...row, cwd: await readProcessCwd(row.pid) }

    if (matchesSynapseDevProcess(processInfo, { ...options, workspaceRoot })) {
      matched.push(processInfo)
    }
  }

  return matched
}

async function findPortProcesses(options = {}) {
  const platform = options.platform ?? process.platform
  const targetScripts = options.targetScripts ?? []
  const ports = options.ports ?? (targetScripts.length > 0
    ? targetScripts.flatMap((scriptName) => DEV_PORTS_BY_SCRIPT[scriptName] ?? [])
    : DEV_PORTS)

  if (ports.length === 0) return []

  if (platform === "win32") {
    const portList = ports.join(",")
    const script = [
      `Get-NetTCPConnection -State Listen -LocalPort ${portList}`,
      "Select-Object -ExpandProperty OwningProcess",
      "Sort-Object -Unique",
      "ConvertTo-Json -Compress",
    ].join(" | ")
    try {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script,
      ])
      const parsed = stdout.trim() ? JSON.parse(stdout) : []
      const pids = Array.isArray(parsed) ? parsed : [parsed]
      return pids
        .map((pid) => Number(pid))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
        .map((pid) => ({ pid, pgid: pid, commandLine: "project port listener" }))
    } catch {
      return []
    }
  }

  const args = ["-nP", ...ports.map((port) => `-iTCP:${port}`), "-sTCP:LISTEN", "-t"]
  try {
    const { stdout } = await execFileAsync("lsof", args)
    return [...new Set(stdout.split(/\s+/u)
      .map((value) => Number.parseInt(value, 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid))]
      .map((pid) => ({ pid, pgid: pid, commandLine: "project port listener" }))
  } catch {
    return []
  }
}

function buildTerminationTargets(trackedEntries, processRows, currentPid = process.pid) {
  const targets = []

  for (const entry of trackedEntries) {
    const target = Number.isInteger(entry.processGroupPid) && entry.processGroupPid !== 0
      ? entry.processGroupPid
      : entry.pid
    if (Number.isInteger(target) && target !== 0 && Math.abs(target) !== currentPid) {
      targets.push(target)
    }
  }

  for (const row of processRows) {
    if (Number.isInteger(row.pid) && row.pid > 0 && row.pid !== currentPid) {
      targets.push(row.pid)
    }
  }

  return [...new Set(targets)]
}

async function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function terminateProcess(pid) {
  try {
    process.kill(pid, "SIGTERM")
  } catch {
    return false
  }

  await new Promise((resolve) => setTimeout(resolve, 750))
  if (!await isAlive(pid)) return true

  try {
    process.kill(pid, "SIGKILL")
    return true
  } catch {
    return false
  }
}

async function updateDevProcessStateAfterQuit(targetScripts) {
  if (targetScripts.length === 0) {
    await clearDevProcessState()
    return
  }

  const remainingEntries = filterRemainingDevProcessState(await readDevProcessState(), targetScripts)
  if (remainingEntries.length === 0) {
    await clearDevProcessState()
    return
  }

  await writeDevProcessState(remainingEntries)
}

async function main() {
  const targetScripts = parseTargetScripts(process.argv.slice(2))
  const { tracked, scanned, portProcesses } = await findMatchingProcesses({ targetScripts })
  const targets = buildTerminationTargets(tracked, [...scanned, ...portProcesses])
  const results = await Promise.all(targets.map(terminateProcess))
  const stoppedCount = results.filter(Boolean).length

  await updateDevProcessStateAfterQuit(targetScripts)
  console.log(stoppedCount > 0 ? `Stopped ${stoppedCount} process(es).` : "Done.")
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  await main()
}

export {
  buildTerminationTargets,
  commandMatchesDevScripts,
  commandLooksLikeDevProcess,
  filterRemainingDevProcessState,
  filterSynapseDevProcessRows,
  findMatchingProcesses,
  matchesSynapseDevProcess,
  parsePsRows,
  parseTargetScripts,
}
