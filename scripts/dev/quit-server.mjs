import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { runCommand } from "./process-utils.mjs"
import { resolveLocalComposeEnvironment } from "./run-server-with-env.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export async function quitServer({ run = runCommand, env = process.env, cwd = repoRoot } = {}) {
  const stopped = await run(process.execPath, [path.join(repoRoot, "scripts/dev/quit-processes.mjs"), "dev:server"], { cwd, env })
  if (stopped.signal || stopped.code !== 0) return stopped
  return run("docker", ["compose", "--env-file", "server/.env.local", "-f", "server/compose.yml", "-f", "server/compose.dev.yml", "down"], {
    cwd, env: resolveLocalComposeEnvironment(env),
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await quitServer()
    process.exitCode = result.signal ? 1 : result.code
  } catch (error) {
    console.error("[quit:server] Failed to stop local services.", error)
    process.exitCode = 1
  }
}
