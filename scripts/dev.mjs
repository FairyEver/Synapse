import { runPnpm, pnpmCommand } from "./process-utils.mjs"
import { spawn } from "node:child_process"
import { clearDevProcessState, writeDevProcessState } from "./dev-state.mjs"

const longRunningScripts = ["dev:website", "dev:desktop", "dev:server"]
const children = new Set()
const childScripts = new Map()
let shuttingDown = false
let persistQueue = Promise.resolve()

async function runSetup(scriptName) {
  const result = await runPnpm(["run", scriptName])
  if (result.signal || result.code !== 0) {
    process.exit(result.code || 1)
  }
}

function startScript(scriptName) {
  const useProcessGroup = process.platform !== "win32"
  const child = spawn(pnpmCommand, ["run", scriptName], {
    detached: useProcessGroup,
    stdio: "inherit",
    env: process.env,
  })

  children.add(child)
  childScripts.set(child, scriptName)
  persistChildren()
  child.on("exit", (code, signal) => {
    children.delete(child)
    childScripts.delete(child)
    persistChildren()
    if (shuttingDown) return
    shuttingDown = true
    stopChildren()
    process.exit(signal ? 1 : code ?? 0)
  })
  child.on("error", (error) => {
    console.error(`[dev] Failed to start ${scriptName}.`, error)
    if (shuttingDown) return
    shuttingDown = true
    stopChildren()
    process.exit(1)
  })
}

function persistChildren() {
  const entries = Array.from(children)
    .filter((child) => child.pid)
    .map((child) => ({
      pid: child.pid,
      processGroupPid: process.platform === "win32" ? child.pid : -child.pid,
      scriptName: childScripts.get(child),
    }))

  persistQueue = persistQueue
    .then(() => writeDevProcessState(entries))
    .catch((error) => {
      console.warn("[dev] Failed to persist dev process state.", error)
    })
}

function stopChildren() {
  for (const child of children) {
    const pid = child.pid
    if (!pid) continue
    try {
      process.kill(
        process.platform === "win32" ? pid : -pid,
        process.platform === "win32" ? undefined : "SIGTERM",
      )
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
        console.warn("[dev] Failed to stop child process.", error)
      }
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) return
    shuttingDown = true
    stopChildren()
  })
}

await runSetup("dev:db")
await runSetup("dev:prisma")
await clearDevProcessState()
longRunningScripts.forEach(startScript)
