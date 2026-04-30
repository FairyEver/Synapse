import { runPnpm } from "./process-utils.mjs"

async function runCleanup(scriptName) {
  try {
    return await runPnpm(["run", scriptName])
  } catch (error) {
    console.error(`[quit] Failed to start ${scriptName}.`, error)
    return { code: 1, signal: null }
  }
}

const dockerResult = await runCleanup("quit:docker")
const processResult = await runCleanup("quit:processes")

if (dockerResult.signal || processResult.signal) {
  process.exit(1)
}

process.exit(dockerResult.code || processResult.code || 0)
