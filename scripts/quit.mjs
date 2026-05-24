import { runPnpm } from "./process-utils.mjs"

async function runCleanup(scriptName) {
  try {
    return await runPnpm(["run", scriptName])
  } catch (error) {
    console.error(`[quit] Failed to start ${scriptName}.`, error)
    return { code: 1, signal: null }
  }
}

const serverResult = await runCleanup("quit:server")
const desktopResult = await runCleanup("quit:desktop")
const websiteResult = await runCleanup("quit:website")

if (serverResult.signal || desktopResult.signal || websiteResult.signal) {
  process.exit(1)
}

process.exit(serverResult.code || desktopResult.code || websiteResult.code || 0)
