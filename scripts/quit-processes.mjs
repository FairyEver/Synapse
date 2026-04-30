import { execFile } from "node:child_process"
import { readdir, readFile } from "node:fs/promises"
import { promisify } from "node:util"
import { clearDevProcessState, readDevProcessState } from "./dev-state.mjs"

const execFileAsync = promisify(execFile)
const MATCHERS = [
  /scripts[/\\]dev\.mjs/u,
  /dev-renderer/u,
  /dev-electron-app/u,
  /tsc.*tsconfig\.electron\.json.*--watch/u,
  /vite\.js.*strictPort/u,
  /vitepress.*dev/u,
  /nest.*start.*--watch/u,
  /admin[/\\]vite\.config\.ts/u,
  /Synapse.*Electron/u,
  /electron \./u,
]

function matchesSynapseDevProcess(commandLine) {
  return MATCHERS.some((pattern) => pattern.test(commandLine))
}

async function findMatchingProcesses() {
  const tracked = await findTrackedProcesses()

  if (process.platform === "win32") {
    return [...tracked, ...await findWindowsProcesses()]
  }

  if (process.platform === "linux") {
    return [...tracked, ...await findLinuxProcesses()]
  }

  return tracked
}

async function findTrackedProcesses() {
  const entries = await readDevProcessState()
  return entries
    .map((entry) => ({
      pid: Number.isInteger(entry.processGroupPid) ? entry.processGroupPid : entry.pid,
      commandLine: entry.scriptName ?? "tracked dev process",
    }))
    .filter((entry) => Number.isInteger(entry.pid) && entry.pid !== 0)
}

async function findWindowsProcesses() {
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

  return rows
    .map((row) => ({
      pid: Number(row.ProcessId),
      commandLine: typeof row.CommandLine === "string" ? row.CommandLine : "",
    }))
    .filter((row) =>
      Number.isInteger(row.pid)
      && row.pid > 0
      && row.pid !== process.pid
      && matchesSynapseDevProcess(row.commandLine))
}

async function findLinuxProcesses() {
  const entries = await readdir("/proc", { withFileTypes: true })
  const rows = []

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    const pid = Number(entry.name)
    if (pid === process.pid) continue

    try {
      const raw = await readFile(`/proc/${entry.name}/cmdline`, "utf8")
      const commandLine = raw.split("\0").filter(Boolean).join(" ")
      if (matchesSynapseDevProcess(commandLine)) {
        rows.push({ pid, commandLine })
      }
    } catch {
      // Process may have exited while scanning.
    }
  }

  return rows
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

const processes = await findMatchingProcesses()
const uniquePids = [...new Set(processes.map((item) => item.pid))]
const results = await Promise.all(uniquePids.map(terminateProcess))
const killedCount = results.filter(Boolean).length

await clearDevProcessState()
console.log(killedCount > 0 ? `Stopped ${killedCount} process(es).` : "Done.")
