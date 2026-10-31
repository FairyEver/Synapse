import { runPnpm } from "./process-utils.mjs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "../..")

async function runCleanup(scriptName) {
  try {
    return await runPnpm(["run", scriptName], { cwd: repoRoot })
  } catch (error) {
    console.error(`[quit] Failed to start ${scriptName}.`, error)
    return { code: 1, signal: null }
  }
}

const serverResult = await runCleanup("quit:server")
const desktopResult = await runCleanup("quit:desktop")
const documentResult = await runCleanup("quit:document")
const dashboardV2Result = await runCleanup("quit:dashboard-v2")

if (serverResult.signal || desktopResult.signal || documentResult.signal || dashboardV2Result.signal) {
  process.exit(1)
}

process.exit(serverResult.code || desktopResult.code || documentResult.code || dashboardV2Result.code || 0)
